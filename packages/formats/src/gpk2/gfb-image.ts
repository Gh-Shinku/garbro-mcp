// Format reference: GARbro "ArcFormats/Gpk2/ImageGFB.cs", classes `GfbFormat` and `GfbMetaData` (a GPK2
// picture of eight, sixteen, twenty four or thirty two bit pixels, sometimes behind the engine's LZSS).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	writeBmp8,
	writeBmp8Palette,
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

/** 'GFB ', the word the reference registers. */
const SIGNATURE = Buffer.from("GFB ", "latin1");
const HEADER_SIZE = 0x40;
const PACKED_SIZE_FIELD = 0x0c;
const UNPACKED_SIZE_FIELD = 0x10;
const DATA_OFFSET_FIELD = 0x14;
const WIDTH_FIELD = 0x1c;
const HEIGHT_FIELD = 0x20;
const DEPTH_FIELD = 0x26;
const DEPTHS = [8, 16, 24, 32];
const PALETTE_LIMIT = 0x400;
const PALETTE_ENTRIES = 0x100;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GfbLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	packedSize: number;
	unpackedSize: number;
	dataOffset: number;
	/** The palette behind the head, or nothing when the picture is grey or has none. */
	paletteLength: number;
	/** The bytes of a row of the reader's own buffer, which may be padded. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GfbFormat.ReadMetaData`: the width and the height stand at `0x1C` and `0x20` as words, the depth at
 * `0x26` as a word, the packed and the unpacked sizes at `0x0C` and `0x10`, and the offset of the stream at
 * `0x14`. An eight bit picture whose stream does not begin right behind the head carries a palette there,
 * of up to `0x400` bytes. The row of the reader's buffer is the unpacked size shared between the rows.
 */
export function readGfbLayout(
	data: Buffer,
	fileLength = data.length,
): GfbLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readUInt16LE(DEPTH_FIELD);
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD);
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	const dataOffset = data.readInt32LE(DATA_OFFSET_FIELD);
	if (width === 0 || height === 0 || !DEPTHS.includes(bitsPerPixel)) {
		return undefined;
	}
	if (packedSize < 0 || unpackedSize <= 0 || unpackedSize > LIMIT) {
		return undefined;
	}
	if (dataOffset < HEADER_SIZE || dataOffset >= fileLength) return undefined;
	const rowBytes = width * (bitsPerPixel >> 3);
	if (unpackedSize % height !== 0 || unpackedSize < rowBytes * height) {
		return undefined;
	}
	const stride = unpackedSize / height;
	let paletteLength = 0;
	if (8 === bitsPerPixel && HEADER_SIZE !== dataOffset) {
		paletteLength = Math.min(PALETTE_LIMIT, dataOffset - HEADER_SIZE);
	}
	return {
		width,
		height,
		bitsPerPixel,
		packedSize,
		unpackedSize,
		dataOffset,
		paletteLength,
		stride,
	};
}

/**
 * `GfbFormat.ReadPalette`: up to `0x400` bytes of a palette, whose entry size is a two hundred and fifty
 * sixth of what it holds and whose blue, green and red bytes are taken as they stand. It is spread over two
 * hundred and fifty six entries again so that a bitmap writer can take it as it is.
 */
export function readGfbPalette(data: Buffer, paletteLength: number): Buffer {
	if (paletteLength <= 0) return Buffer.alloc(0);
	const raw = data.subarray(HEADER_SIZE, HEADER_SIZE + paletteLength);
	if (raw.length !== paletteLength) {
		throw invalidPicture("GPK2 picture is cut short of its palette");
	}
	const colorSize = Math.floor(paletteLength / PALETTE_ENTRIES);
	if (colorSize < 3) {
		throw invalidPicture(
			"GPK2 picture holds a palette of fewer than three bytes an entry",
		);
	}
	const palette = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const at = index * colorSize;
		palette[index * 4] = raw[at] ?? 0;
		palette[index * 4 + 1] = raw[at + 1] ?? 0;
		palette[index * 4 + 2] = raw[at + 2] ?? 0;
	}
	return palette;
}

/** The pixels: the engine's LZSS where the head declares a packed size, and as they stand otherwise. */
export function unpackGfb(data: Buffer, layout: GfbLayout): Buffer {
	if (layout.dataOffset >= data.length) {
		throw invalidPicture("GPK2 picture is cut short of its stream");
	}
	const stored = data.subarray(layout.dataOffset);
	if (0 !== layout.packedSize) {
		return inflateLzss(stored, { outputLength: layout.unpackedSize });
	}
	const pixels = Buffer.alloc(layout.unpackedSize, 0x00);
	stored.copy(pixels, 0, 0, Math.min(stored.length, pixels.length));
	return pixels;
}

/** The rows of the reader's own buffer, which may be padded, taken out into the tight pixels a writer wants. */
function compactRows(
	pixels: Buffer,
	height: number,
	stride: number,
	rowBytes: number,
): Buffer {
	const tight = Buffer.alloc(height * rowBytes, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(tight, row * rowBytes, row * stride, row * stride + rowBytes);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<GfbLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readGfbLayout(header, Number(source.size));
	} catch {
		return undefined;
	}
}

export const gpk2GfbImageDescriptor: FormatDescriptor = {
	id: "gpk2-gfb-image",
	name: "GPK2 image format",
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
			source: "ArcFormats/Gpk2/ImageGFB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gpk2GfbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gpk2GfbImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a GPK2 picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.unpackedSize),
				compressed: layout.packedSize !== 0,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					packedSize: layout.packedSize,
					unpackedSize: layout.unpackedSize,
				},
			}),
			// The pixels are unfolded from the engine's LZSS and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.packedSize !== 0 ? "lzss" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a GPK2 picture");
		}
		const stored = await readStored(source);
		const pixels = unpackGfb(stored, layout);
		const rowBytes = layout.width * (layout.bitsPerPixel >> 3);
		const tight = compactRows(pixels, layout.height, layout.stride, rowBytes);
		const palette = readGfbPalette(stored, layout.paletteLength);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		switch (layout.bitsPerPixel) {
			case 32:
				return Readable.from([
					writeBmp32(layout.width, layout.height, tight, true),
				]);
			case 24:
				return Readable.from([
					writeBmp24(layout.width, layout.height, tight, true),
				]);
			case 16:
				return Readable.from([
					writeBmp16(layout.width, layout.height, tight, true, RGB565_MASKS),
				]);
			default:
				// An eight bit picture without a palette of its own is handed out as a grey one.
				return Readable.from([
					palette.length > 0
						? writeBmp8Palette(
								layout.width,
								layout.height,
								tight,
								palette,
								true,
							)
						: writeBmp8(layout.width, layout.height, tight, true),
				]);
		}
	},
});
