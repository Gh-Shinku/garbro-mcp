// Format reference: GARbro "Legacy/System98/ImageG.cs", class `GFormat` (a 4 bit indexed bitmap using the
// shared bit-packed decoder in that same file). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { GraBaseReader, horizontalGeometry } from "./gra-reader.js";

const HEADER_SIZE = 0xa;
const WIDTH_OFFSET = 6;
const HEIGHT_OFFSET = 8;
/** `ReadMetaData` rejects anything shorter, which is the header plus three stream bytes. */
const MIN_LENGTH = 61;
const PALETTE_OFFSET = 0x0a;
const COLORS = 16;
const PALETTE_BYTES = COLORS * 3;
const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_BYTES;
const MAX_WIDTH = 640;
const MAX_HEIGHT = 400;

interface GLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` rejects short files and takes big endian dimensions, then applies the PC-98 screen bounds
 * and a requirement that the width be a multiple of eight.
 */
async function readLayout(source: ByteSource): Promise<GLayout | undefined> {
	if (source.size < BigInt(MIN_LENGTH)) return undefined;
	try {
		const header = Buffer.from(
			await source.readAt(0n, Math.min(HEADER_SIZE, Number(source.size))),
		);
		const width = header.readUInt16BE(WIDTH_OFFSET);
		const height = header.readUInt16BE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		if ((width & 7) !== 0) return undefined;
		if (width > MAX_WIDTH || height > MAX_HEIGHT) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const system98GImageDescriptor: FormatDescriptor = {
	id: "system98-g-image",
	name: "System-98 engine image format",
	extensions: ["g"],
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
			source: "Legacy/System98/ImageG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const system98GImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: system98GImageDescriptor,
	// The header is too weak to distinguish arbitrary files without the reference extension.
	detection: { signatures: [], extensionOnly: true },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System98 G image");
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System98 G image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// `ReadPalette` throws when the colours are missing and the reference does not guard the call. The
		// sixty one byte minimum guarantees them for this format, but the sibling formats that read a
		// palette at offset four have no such gate, so the check is kept here as the shared pattern.
		if (stored.length < PIXEL_OFFSET)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated System98 G palette");
		const palette = stored.subarray(PALETTE_OFFSET, PIXEL_OFFSET);
		const reader = new GraBaseReader(
			stored,
			PIXEL_OFFSET,
			horizontalGeometry(layout.width, layout.height),
		);
		const pixels = Buffer.from(reader.unpackBits());
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
