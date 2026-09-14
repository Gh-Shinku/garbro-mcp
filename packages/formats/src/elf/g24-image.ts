// Format reference: GARbro "ArcFormats/elf/ImageG24.cs", classes `G24Format` and `Msk16Format` (two Ai5 engine
// images: a true colour picture whose depth its name decides, and a stored mask of eight levels).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	writeBmp8,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const MASK_HEADER_SIZE = 4;
const OFFSET_X_FIELD = 0;
const OFFSET_Y_FIELD = 2;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const MASK_WIDTH_FIELD = 0;
const MASK_HEIGHT_FIELD = 2;
const PIXEL_OFFSET = 8;
const MASK_PIXEL_OFFSET = 4;
const MAX_DIMENSION = 0x1000;
const POSITION_LIMIT = 0x800;
const DEFAULT_BITS_PER_PIXEL = 24;
/** The depths the reference's own reader knows a kind of bitmap for, told apart by the name of the file. */
const DEPTHS_BY_EXTENSION = new Map<string, number>([
	[".g16", 16],
	[".g32", 32],
]);
/** The eight levels a stored mask carries, scaled to the two hundred and fifty six of a grey bitmap. */
const MASK_LEVELS = 8;
const GREY_LEVELS = 0xff;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/** The depths the reference's reader knows, chosen by the end of the file's name, its case disregarded. */
function bitsPerPixelOf(sourcePath: string): number {
	const name = sourcePath.toLowerCase();
	for (const [extension, depth] of DEPTHS_BY_EXTENSION) {
		if (name.endsWith(extension)) return depth;
	}
	return DEFAULT_BITS_PER_PIXEL;
}

interface G24Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	bytesPerPixel: number;
	/** The length of a row as the picture stores it, aligned to four bytes. */
	stride: number;
}

/** The header of the true colour kind: the same eight bytes as the indexed picture, with its own reach. */
async function readG24Layout(
	source: ByteSource,
	sourcePath: string,
): Promise<G24Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		const offsetX = header.readInt16LE(OFFSET_X_FIELD);
		const offsetY = header.readInt16LE(OFFSET_Y_FIELD);
		const width = header.readInt16LE(WIDTH_FIELD);
		const height = header.readInt16LE(HEIGHT_FIELD);
		if (
			width <= 0 ||
			width > MAX_DIMENSION ||
			height <= 0 ||
			height > MAX_DIMENSION ||
			offsetX < 0 ||
			offsetX > POSITION_LIMIT ||
			offsetY < 0 ||
			offsetY > POSITION_LIMIT
		) {
			return undefined;
		}
		const bitsPerPixel = bitsPerPixelOf(sourcePath);
		const bytesPerPixel = bitsPerPixel / 8;
		return {
			width,
			height,
			offsetX,
			offsetY,
			bitsPerPixel,
			bytesPerPixel,
			stride: (width * bytesPerPixel + 3) & ~3,
		};
	} catch {
		return undefined;
	}
}

interface Msk16Layout {
	width: number;
	height: number;
}

/**
 * The stored mask: four bytes of measurements and then one byte per pixel, with the file's own length required
 * to be exactly the pixels and those four bytes. The reference reads its measurements from any name and then
 * asks for the extension, so a mask of another name is none of its own.
 */
async function readMsk16Layout(
	source: ByteSource,
	sourcePath: string,
): Promise<Msk16Layout | undefined> {
	if (!sourcePath.toLowerCase().endsWith(".msk")) return undefined;
	if (source.size < BigInt(MASK_HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, MASK_HEADER_SIZE));
		if (header.length < MASK_HEADER_SIZE) return undefined;
		const width = header.readInt16LE(MASK_WIDTH_FIELD);
		const height = header.readInt16LE(MASK_HEIGHT_FIELD);
		if (
			width <= 0 ||
			width > MAX_DIMENSION ||
			height <= 0 ||
			height > MAX_DIMENSION
		) {
			return undefined;
		}
		if (BigInt(width * height) + BigInt(MASK_HEADER_SIZE) !== source.size)
			return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const ai5G24ImageDescriptor: FormatDescriptor = {
	id: "ai5-g24-image",
	name: "Ai5 engine RGB image",
	extensions: ["g24", "g16", "g32"],
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
			source: "ArcFormats/elf/ImageG24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5G24ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5G24ImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readG24Layout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readG24Layout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 RGB image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readG24Layout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 RGB image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		// The reference reads through an LZSS stream into a buffer of a whole number of rows — each of them
		// aligned to four bytes, which are never part of the picture — and refuses anything shorter.
		const padded = inflateLzss(stored, {
			outputLength: layout.stride * layout.height,
		});
		if (padded.length !== layout.stride * layout.height) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Ai5 image pixels");
		}
		const rowBytes = layout.width * layout.bytesPerPixel;
		const pixels: Buffer = Buffer.alloc(rowBytes * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			padded.copy(
				pixels,
				row * rowBytes,
				row * layout.stride,
				row * layout.stride + rowBytes,
			);
		}
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		if (layout.bitsPerPixel === 16) {
			return Readable.from([
				writeBmp16(layout.width, layout.height, pixels, true),
			]);
		}
		if (layout.bitsPerPixel === 32) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, true),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});

export const ai5Msk16ImageDescriptor: FormatDescriptor = {
	id: "ai5-msk16-image",
	name: "Ai5 engine stored image mask",
	extensions: ["msk"],
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
			source: "ArcFormats/elf/ImageG24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5Msk16ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5Msk16ImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMsk16Layout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readMsk16Layout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 image mask");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readMsk16Layout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 image mask");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const count = layout.width * layout.height;
		const pixels: Buffer = Buffer.alloc(count, 0x00);
		for (let i = 0; i < count; i += 1) {
			// The reference scales eight levels to two hundred and fifty six in whole numbers and then hands
			// the result to a byte, so a level above the eighth wraps around rather than reaching white.
			pixels[i] =
				Math.trunc(
					((file[MASK_PIXEL_OFFSET + i] ?? 0) * GREY_LEVELS) / MASK_LEVELS,
				) & 0xff;
		}
		// `ImageData.Create` with no flip: the bitmap is top down with tight rows.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, false),
		]);
	},
});
