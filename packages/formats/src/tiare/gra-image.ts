// Format reference: GARbro "Legacy/Tiare/ImageGRA.cs", class `GraFormat` (a 4 bit indexed bitmap using the
// shared bit-packed decoder from Legacy/System98/ImageG.cs). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { GraBaseReader, horizontalGeometry } from "../system98/gra-reader.js";

/** `ReadMetaData` reads this much before it starts looking for the string delimiter. */
const HEADER_SIZE = 0x30;
const DELIMITER = 0x1a;
/** The byte three past the description's zero terminator must be this. */
const BPP_MARKER = 4;
const COLORS = 16;
const PALETTE_BYTES = COLORS * 3;
/** A set high bit in the flags byte means the file carries no palette of its own. */
const NO_PALETTE_FLAG = 0x80;

/** The fallback palette, in the reference's order: eight dim colours then eight bright ones. */
const DEFAULT_PALETTE = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x00, 0x77, 0x77, 0x00, 0x00, 0x77, 0x00, 0x77, 0x00,
	0x77, 0x00, 0x00, 0x77, 0x77, 0x77, 0x77, 0x00, 0x77, 0x77, 0x77, 0x00, 0x00,
	0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00,
	0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0xff,
]);

interface TiareLayout {
	width: number;
	height: number;
	/** The byte found after the description's terminator; its high bit selects the palette. */
	flags: number;
	/** Absolute offset of the colour table or, when there is none, of the stream. */
	dataOffset: number;
}

async function readUInt16BE(
	source: ByteSource,
	offset: number,
): Promise<number> {
	const bytes = Buffer.from(await source.readAt(BigInt(offset), 2));
	return bytes.readUInt16BE(0);
}

/**
 * Finds the `0x1A` delimiter in the first forty eight bytes, walks past the description to its terminator,
 * checks the byte three places further on, and then reads the skip, width and height from wherever the
 * description left the cursor. The cursor can pass the end of the forty eight byte window, in which case
 * the remaining fields come from the body of the file.
 */
async function readLayout(
	source: ByteSource,
): Promise<TiareLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored.length < HEADER_SIZE) return undefined;
		const header = stored.subarray(0, HEADER_SIZE);
		let pos = header.indexOf(DELIMITER);
		if (pos === -1) return undefined;
		pos += 1;
		// The reference's loop increments past every byte it tests, so a terminator ends it one past
		// itself; running out of window leaves the cursor at the window end.
		while (pos < HEADER_SIZE) {
			const value = header[pos] ?? 0;
			pos += 1;
			if (value === 0) break;
		}
		if (pos + 3 >= HEADER_SIZE) return undefined;
		if (header[pos + 3] !== BPP_MARKER) return undefined;
		const flags = header[pos] ?? 0;
		let cursor = pos + 8;
		const skip = await readUInt16BE(source, cursor);
		cursor += 2;
		if (skip !== 0) cursor += skip;
		const width = await readUInt16BE(source, cursor);
		cursor += 2;
		const height = await readUInt16BE(source, cursor);
		cursor += 2;
		if (width === 0 || height === 0) return undefined;
		return { width, height, flags, dataOffset: cursor };
	} catch {
		return undefined;
	}
}

export const tiareGraImageDescriptor: FormatDescriptor = {
	id: "tiare-gra-image",
	name: "Tiare image format",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Tiare/ImageGRA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tiareGraImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tiareGraImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tiare GRA image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
				} as Record<string, unknown>,
			}),
			// The stored pixels are packed four bits to a byte and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
				colors: COLORS,
				hasPalette: (layout.flags & NO_PALETTE_FLAG) === 0,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tiare GRA image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		let palette = DEFAULT_PALETTE;
		let pixelOffset = layout.dataOffset;
		if ((layout.flags & NO_PALETTE_FLAG) === 0) {
			if (stored.length < layout.dataOffset + PALETTE_BYTES)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Tiare GRA palette");
			palette = stored.subarray(
				layout.dataOffset,
				layout.dataOffset + PALETTE_BYTES,
			);
			pixelOffset = layout.dataOffset + PALETTE_BYTES;
		}
		const reader = new GraBaseReader(
			stored,
			pixelOffset,
			horizontalGeometry(layout.width, layout.height),
		);
		const pixels = Buffer.from(reader.unpackBits());
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
