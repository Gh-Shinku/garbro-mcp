// Format reference: GARbro "Legacy/Desire/ImageDPC.cs", class `DpcFormat` (a 4 bit indexed bitmap using the
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
	sourceExtension,
} from "../shared/fixed-archive.js";
import { GraBaseReader, horizontalGeometry } from "../system98/gra-reader.js";

const HEADER_OFFSET = 0x20;
const PALETTE_OFFSET = 0x28;
const COLORS = 16;
/** Each colour is one little endian word; the pixel stream starts at the same offset. */
const PALETTE_BYTES = COLORS * 2;
const MAX_ORIGIN = 2048;

interface DpcLayout {
	width: number;
	height: number;
	left: number;
	top: number;
}

/**
 * `ReadMetaData` gates on the extension before reading anything, then takes the source rectangle at offset
 * 0x20 and requires it to lie inside a 2048 square canvas. There is no multiple of eight rule here.
 */
async function readFields(source: ByteSource): Promise<DpcLayout | undefined> {
	const needed = HEADER_OFFSET + 8;
	if (source.size < BigInt(needed)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(BigInt(HEADER_OFFSET), 8));
		const left = header.readInt16LE(0);
		const top = header.readInt16LE(2);
		const width = header.readUInt16LE(4);
		const height = header.readUInt16LE(6);
		if (width === 0 || height === 0) return undefined;
		if (left < 0 || left + width > MAX_ORIGIN) return undefined;
		if (top < 0 || top + height > MAX_ORIGIN) return undefined;
		return { width, height, left, top };
	} catch {
		return undefined;
	}
}

/** Detection adds the extension gate the reference applies before it reads anything. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<DpcLayout | undefined> {
	if (sourceExtension(sourcePath) !== "dpc") return undefined;
	return readFields(source);
}

/**
 * Converts the sixteen packed words into RGB triples. Every channel is a nibble widened by `0x11`, and the
 * low bit of each word is an alpha flag that a four bit bitmap cannot carry, so it is dropped.
 */
function readPalette(stored: Buffer): Buffer {
	const palette = Buffer.alloc(COLORS * 3);
	for (let i = 0; i < COLORS; i += 1) {
		const word = stored.readUInt16LE(PALETTE_OFFSET + i * 2);
		palette[i * 3] = (((word >> 7) & 0xf) * 0x11) & 0xff;
		palette[i * 3 + 1] = (((word >> 12) & 0xf) * 0x11) & 0xff;
		palette[i * 3 + 2] = (((word >> 2) & 0xf) * 0x11) & 0xff;
	}
	return palette;
}

export const dpcImageDescriptor: FormatDescriptor = {
	id: "desire-dpc-image",
	name: "Desire image format",
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
			source: "Legacy/Desire/ImageDPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dpcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dpcImageDescriptor,
	// The reference declares no signature; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Desire DPC image");
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
				offsetX: layout.left,
				offsetY: layout.top,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Desire DPC image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored.length < PALETTE_OFFSET + PALETTE_BYTES)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Desire DPC palette");
		const palette = readPalette(stored);
		// The palette is read first, then the stream is re-read from the same offset: the sixteen words are
		// also the first thirty two bytes of compressed data, which is a quirk of the reference worth
		// keeping, since the decoder really does start there.
		const reader = new GraBaseReader(
			stored,
			PALETTE_OFFSET,
			horizontalGeometry(layout.width, layout.height),
		);
		const pixels = Buffer.from(reader.unpackBits());
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
