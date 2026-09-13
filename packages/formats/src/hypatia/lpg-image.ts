// Format reference: GARbro "ArcFormats/Hypatia/ImageLPG.cs", class `LpgFormat` (in GameRes.Formats.Kogado).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The reference's signature: a single byte of one. */
const SIGNATURE = Buffer.from([0x01]);
const HEADER_SIZE = 0x1c;
/** Both depths keep a two hundred and fifty six entry palette of three byte triples. */
const PALETTE_OFFSET = HEADER_SIZE;
const PALETTE_ENTRIES = 256;
const PALETTE_BYTES = PALETTE_ENTRIES * 3;
const DATA_OFFSET = PALETTE_OFFSET + PALETTE_BYTES;
const MAX_DIMENSION = 0x8000;
/** The extension the format gates on, since its signature is a single byte. */
const REQUIRED_EXTENSION = "lpg";

interface LpgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * The reference checks the extension first and then reads a header whose only used fields are the depth at
 * offset four and the two dimensions at 0x10 and 0x14; everything else in the twenty eight bytes is never
 * looked at.
 */
async function readFields(source: ByteSource): Promise<LpgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if ((head[0] ?? 0) !== SIGNATURE[0]) return undefined;
		const bitsPerPixel = head.readInt32LE(4);
		const width = head.readUInt32LE(0x10);
		const height = head.readUInt32LE(0x14);
		// Only two depths are legal, and a dimension of zero is as unacceptable as one past 32768.
		if (
			(bitsPerPixel !== 32 && bitsPerPixel !== 24) ||
			width === 0 ||
			width > MAX_DIMENSION ||
			height === 0 ||
			height > MAX_DIMENSION
		)
			return undefined;
		return { width, height, bitsPerPixel };
	} catch {
		return undefined;
	}
}

/** The extension gate the reference applies before reading anything. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<LpgLayout | undefined> {
	if (sourceExtension(sourcePath) !== REQUIRED_EXTENSION) return undefined;
	return readFields(source);
}

/**
 * `ReadPalette` reads two hundred and fifty six triples in the internal red-green-blue order, and a bitmap
 * wants blue-green-red with a fourth byte, so the port swaps as it goes.
 */
function readPalette(stored: Buffer): Buffer {
	if (stored.length < DATA_OFFSET)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated LPG palette");
	const palette: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const src = PALETTE_OFFSET + index * 3;
		palette[index * 4] = stored[src + 2] ?? 0;
		palette[index * 4 + 1] = stored[src + 1] ?? 0;
		palette[index * 4 + 2] = stored[src] ?? 0;
	}
	return palette;
}

export const lpgImageDescriptor: FormatDescriptor = {
	id: "hypatia-lpg-image",
	name: "Kogado Studio image",
	extensions: [REQUIRED_EXTENSION],
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
			source: "ArcFormats/Hypatia/ImageLPG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lpgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lpgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kogado LPG image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header and a palette the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: unknown, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kogado LPG image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const palette = readPalette(stored);
		// `CreateFlipped` is a bitmap's own convention, so the data is bottom up and the height is positive.
		if (layout.bitsPerPixel === 32) {
			// A thirty two bit image stores two bytes a pixel: a palette index and an alpha value, expanded
			// here into the four the bitmap wants. The reference reads both without a length check, so a
			// stream that ends inside a pixel throws.
			const pixels: Buffer = Buffer.alloc(
				layout.width * layout.height * 4,
				0x00,
			);
			let position = DATA_OFFSET;
			for (let dst = 0; dst < pixels.length; dst += 4) {
				if (position + 1 >= stored.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated LPG pixels");
				const index = (stored[position] ?? 0) * 4;
				pixels[dst] = palette[index] ?? 0;
				pixels[dst + 1] = palette[index + 1] ?? 0;
				pixels[dst + 2] = palette[index + 2] ?? 0;
				pixels[dst + 3] = stored[position + 1] ?? 0;
				position += 2;
			}
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, true),
			]);
		}
		// The twenty four bit branch is the reference's own surprise: it allocates one byte a pixel, not three,
		// and wraps the result as eight bit indexed with the palette. The port reproduces that, which means a
		// twenty four bit file extracts as an index map of its first width times height bytes.
		const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
		stored.copy(
			pixels,
			0,
			DATA_OFFSET,
			Math.min(stored.length, DATA_OFFSET + pixels.length),
		);
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, true),
		]);
	},
});
