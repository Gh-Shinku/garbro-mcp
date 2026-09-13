// Format reference: GARbro "Legacy/Ucom/ImageUG.cs", class `UgFormat` (a 4 bit indexed bitmap whose
// scanlines are vertical, decoded by the `UgReader` subclass in the same file). GARbro commit
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
import { UgGraReader } from "./ug-reader.js";

const HEADER_SIZE = 8;
const PALETTE_OFFSET = 8;
const COLORS = 16;
/** Each colour is one word, and the stream starts right after the last of them. */
const PALETTE_BYTES = COLORS * 2;
const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_BYTES;
const MAX_WIDTH = 640;
const MAX_HEIGHT = 512;
/** One column unit covers eight pixels. */
const COLUMN_SHIFT = 3;

interface UgLayout {
	width: number;
	height: number;
	left: number;
	top: number;
}

/**
 * `ReadMetaData` gates on the extension, then builds the size from a source rectangle: the width is one
 * eight-pixel column per unit of `right - left`, and the height is the inclusive span of rows. The
 * comparison against zero is signed, so a rectangle whose right edge precedes its left edge is declined.
 */
async function readFields(source: ByteSource): Promise<UgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const left = header.readUInt16LE(0);
		const top = header.readUInt16LE(2);
		const right = header.readUInt16LE(4);
		const bottom = header.readUInt16LE(6);
		const width = (right - left + 1) << COLUMN_SHIFT;
		const height = bottom - top + 1;
		if (width <= 0 || height <= 0) return undefined;
		if (width > MAX_WIDTH || height > MAX_HEIGHT) return undefined;
		return { width, height, left, top };
	} catch {
		return undefined;
	}
}

/** The reference's own palette reader: blue in the low nibble, then red, then green. */
function readPalette(stored: Buffer): Buffer {
	const palette = Buffer.alloc(COLORS * 3);
	for (let i = 0; i < COLORS; i += 1) {
		const word = stored.readUInt16LE(PALETTE_OFFSET + i * 2);
		palette[i * 3] = (((word >> 4) & 0xf) * 0x11) & 0xff;
		palette[i * 3 + 1] = (((word >> 8) & 0xf) * 0x11) & 0xff;
		palette[i * 3 + 2] = ((word & 0xf) * 0x11) & 0xff;
	}
	return palette;
}

export const ugImageDescriptor: FormatDescriptor = {
	id: "ucom-ug-image",
	name: "Ucom image format",
	extensions: ["ug"],
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
			source: "Legacy/Ucom/ImageUG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ugImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ugImageDescriptor,
	// The reference declares no signature; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "ug") return false;
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ucom UG image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ucom UG image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// `Unpack` reads the palette and then reseeks to the stream offset, so both live in this range.
		if (stored.length < PIXEL_OFFSET)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Ucom UG palette");
		const palette = readPalette(stored);
		const reader = new UgGraReader(
			stored,
			PIXEL_OFFSET,
			layout.width,
			layout.height,
		);
		const pixels = Buffer.from(reader.unpackBits());
		// `ImageData.Create` keeps the stored order, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
