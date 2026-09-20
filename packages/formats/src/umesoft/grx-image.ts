// Format reference: GARBro "ArcFormats/UMeSoft/ImageGRX.cs", classes `GrxFormat` and `Reader`, which the
// multi-frame formats of the same engine wrap around a picture of their own.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB555_MASKS,
	RGB565_MASKS,
	writeBmp8,
	writeBmp16,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four bytes of the signature, which the reference packs into a word. */
export const GRX_SIGNATURE = Buffer.from([0x47, 0x52, 0x58, 0x1a]);
/** Where the fields behind the signature stand, both here and in the formats that wrap this one. */
export const GRX_INFO_OFFSET = 4;
const HEADER_SIZE = 0x10;
/** The depths the reference knows, and the ones it refuses with an exception. */
const DEPTH_GREY = 8;
const DEPTH_555 = 15;
const DEPTH_565 = 16;
const DEPTH_24 = 24;
const DEPTH_32 = 32;
/** The places a run is copied from, counted in rows of the picture and then in pixels of them. */
const OFFSET_ROWS = [
	0, -1, -1, -1, 0, -2, -2, -2, 0, -4, -4, -4, -2, -2, -4, -4,
];
const OFFSET_PIXELS = [0, 0, -1, 1, -2, 0, -2, 2, -4, 0, -4, 4, -4, 4, -2, 2];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Whether the pixels stand in the stream as they are or are walked as runs. */
	packed: boolean;
	alpha: boolean;
	alphaOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The bitmap of a picture the reader has unpacked, at the depth the reader has settled on. */
export function writeGrxBitmap(
	width: number,
	height: number,
	pixels: Buffer,
	outputDepth: number,
): Buffer {
	if (DEPTH_GREY === outputDepth)
		return writeBmp8(width, height, pixels, false);
	if (DEPTH_555 === outputDepth) {
		return writeBmp16(width, height, pixels, false, RGB555_MASKS);
	}
	if (DEPTH_565 === outputDepth) {
		return writeBmp16(width, height, pixels, false, RGB565_MASKS);
	}
	return writeBmp32(width, height, pixels, false);
}

/**
 * `GrxFormat.ReadInfo`: whether the pixels are packed, whether the picture carries a plane of alpha behind
 * them, the depth, the measurements and where that plane stands. The depth has to be one the reader knows,
 * and a picture of no width or height is turned away rather than read.
 */
export function readGrxInfo(data: Buffer, at: number): GrxLayout | undefined {
	if (data.length < at + 12) return undefined;
	const packed = 0 !== (data[at] ?? 0);
	const alpha = 0 !== (data[at + 1] ?? 0);
	const bitsPerPixel = data.readUInt16LE(at + 2);
	const width = data.readUInt16LE(at + 4);
	const height = data.readUInt16LE(at + 6);
	const alphaOffset = data.readInt32LE(at + 8);
	if (0 === width || 0 === height) return undefined;
	if (
		DEPTH_GREY !== bitsPerPixel &&
		DEPTH_555 !== bitsPerPixel &&
		DEPTH_565 !== bitsPerPixel &&
		DEPTH_24 !== bitsPerPixel &&
		DEPTH_32 !== bitsPerPixel
	) {
		return undefined;
	}
	return { width, height, bitsPerPixel, packed, alpha, alphaOffset };
}

/** `GrxFormat.ReadMetaData`: the signature and then the fields of the picture. */
export function readGrxLayout(data: Buffer): GrxLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, GRX_SIGNATURE.length).equals(GRX_SIGNATURE)) {
		return undefined;
	}
	return readGrxInfo(data, GRX_INFO_OFFSET);
}

/** How many bytes a pixel of the picture takes in the stream, and how many the reader writes it out with. */
export function grxPixelSizes(layout: GrxLayout): {
	source: number;
	destination: number;
} {
	const source = Math.trunc((layout.bitsPerPixel + 7) / 8);
	if (DEPTH_24 === layout.bitsPerPixel || DEPTH_32 === layout.bitsPerPixel) {
		return { source, destination: 4 };
	}
	return { source, destination: source };
}

/** The depth the port writes out, which is four bytes to the pixel for a picture of three or four. */
export function grxOutputDepth(layout: GrxLayout): number {
	return grxPixelSizes(layout).destination * 8;
}

/**
 * The depth a picture is written out at: a plane of alpha takes the fourth byte of a picture of three or four
 * bytes to the pixel and widens a picture of two, while the plane of a picture of one, or of the high colour
 * kind with a spare bit, is unpacked and then left behind, which is what the reference does as well.
 */
export function grxReportedDepth(layout: GrxLayout): number {
	if (
		layout.alpha &&
		(DEPTH_565 === layout.bitsPerPixel || layout.bitsPerPixel >= DEPTH_24)
	) {
		return 32;
	}
	return grxOutputDepth(layout);
}

/** Where the reader stands in the stream: the reference seeks rather than walking a buffer. */
interface Cursor {
	at: number;
}

/** A read of the stream, which has to be answered in full or the reference throws. */
function readInto(
	data: Buffer,
	cursor: Cursor,
	target: Buffer,
	destination: number,
	length: number,
): void {
	if (cursor.at + length > data.length) {
		throw invalidPicture("U-Me Soft picture is cut short of its stream");
	}
	if (destination + length > target.length) {
		throw invalidPicture("U-Me Soft picture writes past its own end");
	}
	data.copy(target, destination, cursor.at, cursor.at + length);
	cursor.at += length;
}

/**
 * `Reader.UnpackColorData`: a row of the picture is a walk of runs, each of them behind a control byte. The
 * lowest two bits of the byte hold a count and the bit worth four says there is a byte behind it holding the
 * rest of it, so a count is one more than those bits say. The four highest bits then say what the run is:
 *
 * | flags | what the run is |
 * | --- | --- |
 * | none of them | a run of pixels that stand in the stream themselves |
 * | the bit worth eight | the same |
 * | the bit worth eight, with the four highest bits | a run copied from a place behind, a whole run at a time |
 * | the four highest bits alone | the same, copied a pixel at a time |
 * | none of the four highest, without the bit worth eight | a run repeating the pixel the stream brings |
 *
 * A place behind is given by the two tables above: the first counts rows of the picture and the second pixels
 * of them, so a place of nothing is the pixel behind, one of the third kind is the pixel behind and one along,
 * and one of the ninth is four rows above. A run may reach past the row it stands in and into the one behind,
 * which is what the reference does; a place that reaches before the start of the picture, a copy that reaches
 * past its end and a stream that runs out inside it are all refused, where the reference's own reader throws.
 * The four highest bits of the bits worth eight stand for a whole run copied at once, which the reference
 * takes as a block and the port takes byte by byte in order, the same way.
 */
function unpackColorData(
	data: Buffer,
	layout: GrxLayout,
	target: Buffer,
	sourcePixelSize: number,
	destinationPixelSize: number,
	cursor: Cursor,
): void {
	const stride = (layout.width * destinationPixelSize + 3) & ~3;
	const delta = stride - layout.width * destinationPixelSize;
	const offsetStep: number[] = [];
	for (let index = 0; index < 16; index += 1) {
		offsetStep[index] =
			(OFFSET_ROWS[index] ?? 0) * stride +
			(OFFSET_PIXELS[index] ?? 0) * destinationPixelSize;
	}
	let dst = 0;
	for (let row = 0; row < layout.height; row += 1) {
		let left = layout.width;
		while (left > 0) {
			if (cursor.at >= data.length) {
				throw invalidPicture("U-Me Soft picture is cut short of its stream");
			}
			const flag = data[cursor.at++] ?? 0;
			let count = flag & 3;
			if (0 !== (flag & 4)) {
				if (cursor.at >= data.length) {
					throw invalidPicture("U-Me Soft picture is cut short of its stream");
				}
				count |= (data[cursor.at++] ?? 0) << 2;
			}
			count += 1;
			left -= count;
			if (0 === (flag & 0xf0)) {
				if (0 !== (flag & 8)) {
					if (sourcePixelSize === destinationPixelSize) {
						const bytes = count * destinationPixelSize;
						readInto(data, cursor, target, dst, bytes);
						dst += bytes;
					} else {
						for (let index = 0; index < count; index += 1) {
							readInto(data, cursor, target, dst, sourcePixelSize);
							dst += destinationPixelSize;
						}
					}
				} else {
					readInto(data, cursor, target, dst, sourcePixelSize);
					count -= 1;
					dst += destinationPixelSize;
					for (
						let index = count * destinationPixelSize;
						index > 0;
						index -= 1
					) {
						if (dst >= target.length) {
							throw invalidPicture("U-Me Soft picture writes past its own end");
						}
						target[dst] = target[dst - destinationPixelSize] ?? 0;
						dst += 1;
					}
				}
			} else {
				const src = dst + (offsetStep[flag >> 4] ?? 0);
				if (0 === (flag & 8)) {
					for (let index = 0; index < count; index += 1) {
						if (src < 0) {
							throw invalidPicture(
								"U-Me Soft picture copies from before its start",
							);
						}
						if (src + sourcePixelSize > target.length) {
							throw invalidPicture("U-Me Soft picture reads past its own end");
						}
						if (dst + sourcePixelSize > target.length) {
							throw invalidPicture("U-Me Soft picture writes past its own end");
						}
						for (let byte = 0; byte < sourcePixelSize; byte += 1) {
							target[dst + byte] = target[src + byte] ?? 0;
						}
						dst += destinationPixelSize;
					}
				} else {
					const bytes = count * destinationPixelSize;
					if (src < 0) {
						throw invalidPicture(
							"U-Me Soft picture copies from before its start",
						);
					}
					if (src + bytes > target.length) {
						throw invalidPicture("U-Me Soft picture reads past its own end");
					}
					if (!copyOverlapped(target, src, dst, bytes)) {
						throw invalidPicture("U-Me Soft picture writes past its own end");
					}
					dst += bytes;
				}
			}
		}
		dst += delta;
	}
}

/**
 * `Reader.Unpack`: the pixels stand either in the stream as they are or behind the walk above, and a picture
 * with a plane of alpha unpacks that plane the same way from where the header says it stands. A picture of
 * three or four bytes to the pixel takes that plane as the fourth byte of every pixel, which makes it a
 * picture of four; a picture of two bytes takes the plane with it as well, widening each pixel to four and
 * stretching its three colours over the whole of a byte; the plane of any other depth is unpacked and then
 * left behind, which is what the reference does as well.
 */
export function unpackGrx(
	data: Buffer,
	layout: GrxLayout,
	from: number,
): { pixels: Buffer; outputDepth: number } {
	const { source, destination } = grxPixelSizes(layout);
	const alignedWidth = (layout.width + 3) & ~3;
	const stride = alignedWidth * destination;
	/** The length a row of the walk takes, which is the width of the picture up to a whole four bytes. */
	const walked = (layout.width * destination + 3) & ~3;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const cursor: Cursor = { at: from + HEADER_SIZE };
	if (!layout.packed) {
		const room = Math.max(0, Math.min(pixels.length, data.length - cursor.at));
		data.copy(pixels, 0, cursor.at, cursor.at + room);
	} else {
		unpackColorData(data, layout, pixels, source, destination, cursor);
	}
	if (!layout.alpha || layout.alphaOffset <= 0) {
		// The pixels of a picture that stands in the file as they are take the length of a whole row; the walk
		// writes its rows one behind the other with the length it counts, whatever the buffer holds.
		return {
			pixels: packGrx(
				pixels,
				layout,
				destination,
				layout.packed ? walked : stride,
			),
			outputDepth: destination * 8,
		};
	}
	const plane: Buffer = Buffer.alloc(alignedWidth * layout.height, 0x00);
	cursor.at = from + HEADER_SIZE + layout.alphaOffset;
	unpackColorData(data, layout, plane, 1, 1, cursor);
	if (layout.bitsPerPixel >= DEPTH_24) {
		let dst = 3;
		let src = 0;
		for (let row = 0; row < layout.height; row += 1) {
			for (let index = 0; index < alignedWidth; index += 1) {
				pixels[dst] = plane[src++] ?? 0;
				dst += 4;
			}
		}
		// The plane of alpha takes the fourth byte of a pixel the whole width of a row away, so the rows of
		// the picture stand that far apart from here on.
		return {
			pixels: packGrx(pixels, layout, 4, alignedWidth * 4),
			outputDepth: 32,
		};
	}
	if (DEPTH_565 === layout.bitsPerPixel) {
		return applyGrxAlpha16(layout, pixels, plane);
	}
	return {
		pixels: packGrx(
			pixels,
			layout,
			destination,
			layout.packed ? walked : stride,
		),
		outputDepth: destination * 8,
	};
}

/** `Reader.ApplyAlpha16bpp`: every pixel widens to four bytes, its colours stretched over the whole byte. */
function applyGrxAlpha16(
	layout: GrxLayout,
	pixels: Buffer,
	plane: Buffer,
): { pixels: Buffer; outputDepth: number } {
	const alignedWidth = (layout.width + 3) & ~3;
	const stride = alignedWidth * 4;
	const out: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let src = 0;
	let dst = 0;
	let alpha = 0;
	for (let row = 0; row < layout.height; row += 1) {
		for (let index = 0; index < layout.width; index += 1) {
			const pixel = pixels.readUInt16LE(src + index * 2);
			out[dst] = Math.trunc(((pixel & 0x001f) * 0xff) / 0x001f) & 0xff;
			out[dst + 1] = Math.trunc(((pixel & 0x07e0) * 0xff) / 0x07e0) & 0xff;
			out[dst + 2] = Math.trunc(((pixel & 0xf800) * 0xff) / 0xf800) & 0xff;
			out[dst + 3] = plane[alpha + index] ?? 0;
			dst += 4;
		}
		src += alignedWidth * 2;
		alpha += alignedWidth;
		dst += (alignedWidth - layout.width) * 4;
	}
	return { pixels: packGrx(out, layout, 4, alignedWidth * 4), outputDepth: 32 };
}

function packGrx(
	pixels: Buffer,
	layout: GrxLayout,
	bytesPerPixel: number,
	sourceStride: number,
): Buffer {
	const tight = layout.width * bytesPerPixel;
	if (sourceStride === tight) return pixels.subarray(0, tight * layout.height);
	const out: Buffer = Buffer.alloc(tight * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		pixels.copy(
			out,
			row * tight,
			row * sourceStride,
			row * sourceStride + tight,
		);
	}
	return out;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const umesoftGrxImageDescriptor: FormatDescriptor = {
	id: "umesoft-grx-image",
	name: "U-Me Soft image format",
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
			source: "ArcFormats/UMeSoft/ImageGRX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const umesoftGrxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umesoftGrxImageDescriptor,
	detection: { signatures: [{ bytes: GRX_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readGrxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGrxLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a U-Me Soft picture");
		}
		const depth = grxReportedDepth(layout);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: layout.packed,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: depth,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: layout.packed ? "grx" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: depth,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGrxLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a U-Me Soft picture");
		}
		const size = layout.width * layout.height * 4;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`U-Me Soft picture of ${size} bytes is too large`,
			);
		}
		const { pixels, outputDepth } = unpackGrx(stored, layout, 0);
		return Readable.from([
			writeGrxBitmap(layout.width, layout.height, pixels, outputDepth),
		]);
	},
});
