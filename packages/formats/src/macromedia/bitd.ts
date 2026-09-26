// The counts of the places of a picture of the engine of the Macromedia Director engine (`BITD`), of the
// reference `ArcFormats/Macromedia/ImageBITD.cs` (`BitdDecoder`) over the counts of the walk of the engine of
// `ArcFormats/Macromedia/Palettes.cs`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Every picture of the engine stands of the counts of the places of the picture of the engine of the counts
// of the walk of the engine itself: the counts of the places of the picture of the engine of every count of
// the places of the picture stand of a count of the counts of the engine of the counts of the walk of the
// engine, and the counts of the places of the picture of the engine of the counts of the engine of the walk of
// the engine stand of the counts of the places of the picture of the engine of every count of the places of
// the picture of the engine at the places of the counts of the walk of the engine of the counts of them.

import { GarbroError } from "@garbro-mcp/core";
import { writeBmp32, writeBmp8Palette } from "../shared/bmp.js";

/** The counts of the places of a picture of the engine of the counts of the walk of the engine of them. */
export interface DirectorBitmapInfo {
	width: number;
	height: number;
	bitsPerPixel: number;
	depthType: number;
}

/** The counts of the places of a picture of the engine of the counts of the walk of the engine of them. */
export interface DirectorPicture {
	width: number;
	height: number;
	/** The counts of the places of a colour of the walk of the engine of every count of the places of it. */
	bitsPerPixel: number;
	pixels: Buffer;
	/** The counts of the places of the picture of the engine of the engine of the counts of them. */
	alpha?: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The counts of the places of the picture of the engine of a count of the places of the picture of it. */
export function directorStride(width: number, bitsPerPixel: number): number {
	return ((((width * bitsPerPixel + 7) >> 3) + 1) & ~1) >>> 0;
}

/**
 * The counts of the places of a picture of the engine of a count of the places of the picture of the engine
 * (`BitdDecoder.UnpackScanLine`): a count of the counts of the places of the picture of the engine of the
 * count of the walk of the engine, of the counts of the places of the picture of the engine of the counts of
 * them.
 */
export function unpackDirectorScanLine(
	data: Uint8Array,
	at: number,
	stride: number,
): { line: Buffer; at: number } | undefined {
	const line = Buffer.alloc(stride);
	let x = 0;
	let position = at;
	while (x < stride) {
		if (position >= data.length) break;
		const byte = data[position++] ?? 0;
		let count = byte > 0x7f ? 0x100 - byte : byte;
		count += 1;
		if (x + count > stride)
			throw invalidPicture(
				"The counts of the places of the picture stand behind it",
			);
		if (byte > 0x7f) {
			if (position >= data.length)
				throw invalidPicture(
					"The counts of the places of the picture stand behind it",
				);
			const place = data[position++] ?? 0;
			for (let index = 0; index < count; index += 1) line[x++] = place;
		} else {
			for (let index = 0; index < count; index += 1) {
				if (position >= data.length)
					throw invalidPicture(
						"The counts of the places of the picture stand behind it",
					);
				line[x++] = data[position++] ?? 0;
			}
		}
	}
	return { line, at: position };
}

/**
 * The counts of the places of a picture of the engine (`BitdDecoder.GetImageData`): the counts of the walk
 * of the engine of the counts of the places of the picture of the engine of the places of the picture of the
 * engine.
 */
export function unpackDirectorBitmap(
	data: Uint8Array,
	info: DirectorBitmapInfo,
): { pixels: Buffer; stride: number } | undefined {
	const stride = directorStride(info.width, info.bitsPerPixel);
	const size = stride * info.height;
	if (info.width <= 0 || info.height <= 0 || stride <= 0) return undefined;
	if (size > 0x10000000) return undefined;
	const pixels = Buffer.alloc(size);
	if (info.bitsPerPixel > 8) {
		// The counts of the places of the picture of the engine of the counts of the engine of the walk of the
		// engine stand of the counts of the walk of the engine of the places of the picture of the engine of
		// every count of the places of the picture of the engine, of the counts of the engine itself: the
		// places of the counts of the walk of the engine of the places of the picture of the engine stand of
		// the counts of the engine of the walk of the engine of the places of the picture of the engine of the
		// counts of them.
		const channels = Math.trunc(info.bitsPerPixel / 8);
		let at = 0;
		for (let line = 0; line < size; line += stride) {
			const scan = unpackDirectorScanLine(data, at, stride);
			if (!scan) return undefined;
			at = scan.at;
			let dst = line;
			for (let index = 0; index < info.width; index += 1) {
				for (
					let src = info.width * (channels - 1);
					src >= 0;
					src -= info.width
				) {
					pixels[dst++] = scan.line[index + src] ?? 0;
				}
			}
		}
		return { pixels, stride };
	}
	if (size !== data.length) {
		// The counts of the places of the picture of the engine of the counts of the walk of the engine stand
		// of the counts of the walk of the engine of the places of the picture of the engine of every count of
		// the places of the picture of the engine.
		let at = 0;
		for (let line = 0; line < size; line += stride) {
			const scan = unpackDirectorScanLine(data, at, stride);
			if (!scan) return undefined;
			at = scan.at;
			scan.line.copy(pixels, line);
		}
		return { pixels, stride };
	}
	Buffer.from(data.subarray(0, size)).copy(pixels, 0, 0, size);
	return { pixels, stride };
}

/**
 * The counts of the places of the picture of the engine of the engine of the counts of the places of the
 * picture of the engine (`DxrOpener.ReadAlphaChannel`): the counts of the walk of the engine of the places of
 * the picture of the engine of the counts of the engine of the walk of the engine itself, of every count of
 * the places of the picture of the engine.
 */
export function unpackDirectorAlpha(
	data: Uint8Array,
	width: number,
	height: number,
): Buffer | undefined {
	const stride = directorStride(width, 8);
	const size = stride * height;
	if (size > 0x10000000) return undefined;
	const alpha = Buffer.alloc(size);
	let at = 0;
	for (let line = 0; line < size; line += stride) {
		const scan = unpackDirectorScanLine(data, at, stride);
		if (!scan) return undefined;
		at = scan.at;
		scan.line.copy(alpha, line);
	}
	return alpha;
}

/** The counts of the places of the picture of the engine of the engine of the counts of the walk of it. */
export function readDirectorPalette(data: Uint8Array): Buffer | undefined {
	if (0 === data.length % 6) {
		const entries = Buffer.alloc((data.length / 6) * 4);
		for (let at = 0; at < data.length; at += 6) {
			const entry = (at / 6) * 4;
			// The counts of the places of the picture of the engine of the counts of the walk of the engine
			// of the places of the picture of the engine stand of the counts of the engine of the walk of the
			// engine itself: the counts of the places of the picture of the engine, of the counts of the
			// places of the picture of the engine of the counts of them and of the counts of the places of
			// the picture of the engine of the counts of the walk of the engine of its own.
			entries[entry] = data[at + 4] ?? 0;
			entries[entry + 1] = data[at + 2] ?? 0;
			entries[entry + 2] = data[at] ?? 0;
			entries[entry + 3] = 0;
		}
		return entries;
	}
	return undefined;
}

/**
 * The counts of the places of the picture of the engine of the engine of the counts of them: the counts of
 * the places of the picture of the engine of the counts of the walk of the engine of the places of the counts
 * of the engine of the walk of the engine itself, of the counts of the places of the picture of the engine of
 * the counts of them.
 */
export function directorPicture(
	picture: DirectorPicture,
	palette?: Buffer,
): {
	bitsPerPixel: number;
	palette?: Buffer | undefined;
	pixels: Uint8Array;
} {
	const { width, height, bitsPerPixel, alpha } = picture;
	const stride = directorStride(width, bitsPerPixel);
	if (bitsPerPixel <= 8) {
		const indices = Buffer.alloc(width * height);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const place =
					picture.pixels[y * stride + ((x * bitsPerPixel) >> 3)] ?? 0;
				indices[y * width + x] =
					8 === bitsPerPixel
						? place
						: 4 === bitsPerPixel
							? 0 === (x & 1)
								? place & 0x0f
								: place >> 4
							: 0 === (x & 3)
								? (place >> 6) & 3
								: 1 === (x & 3)
									? (place >> 4) & 3
									: 2 === (x & 3)
										? (place >> 2) & 3
										: place & 3;
			}
		}
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// places of the picture of the engine of the counts of them stand of the counts of the places of the
		// picture of the engine of the engine of the counts of the places of the picture of the engine of the
		// counts of the engine itself.
		if (!alpha) return { bitsPerPixel: 8, palette, pixels: indices };
		// The counts of the places of the picture of the engine of the counts of the engine of the walk of the
		// engine itself stand of the counts of the places of the picture of the engine of the counts of them,
		// of the counts of the places of the picture of the engine of the counts of the picture of the engine
		// of the counts of the places of the picture of the engine.
		const bgra = Buffer.alloc(width * height * 4);
		const alphaStride = directorStride(width, 8);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const dst = (y * width + x) * 4;
				const at = (indices[y * width + x] ?? 0) * 4;
				bgra[dst] = palette?.[at] ?? 0;
				bgra[dst + 1] = palette?.[at + 1] ?? 0;
				bgra[dst + 2] = palette?.[at + 2] ?? 0;
				bgra[dst + 3] = alpha[y * alphaStride + x] ?? 0;
			}
		}
		return { bitsPerPixel: 32, pixels: bgra };
	}
	// The counts of the places of the picture of the engine of the counts of the engine of the walk of the
	// engine itself, of the counts of the places of the picture of the engine of the counts of them.
	const bgra = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const dst = (y * width + x) * 4;
			if (16 === bitsPerPixel) {
				const place = picture.pixels.readUInt16LE(y * stride + x * 2);
				bgra[dst] = ((place & 0x001f) * 0xff) / 0x1f;
				bgra[dst + 1] = ((place & 0x07e0) * 0xff) / 0x7e0;
				bgra[dst + 2] = ((place & 0xf800) * 0xff) / 0xf800;
				bgra[dst + 3] = 0;
			} else {
				const src = y * stride + x * 4;
				bgra[dst] = picture.pixels[src] ?? 0;
				bgra[dst + 1] = picture.pixels[src + 1] ?? 0;
				bgra[dst + 2] = picture.pixels[src + 2] ?? 0;
				bgra[dst + 3] = picture.pixels[src + 3] ?? 0;
			}
		}
	}
	if (alpha) {
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// places of the picture of the engine of the counts of the engine of the walk of the engine itself
		// stand of the counts of the places of the picture of the engine of the counts of them.
		const alphaStride = directorStride(width, 8);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				bgra[(y * width + x) * 4 + 3] = alpha[y * alphaStride + x] ?? 0;
			}
		}
	}
	return { bitsPerPixel: 32, pixels: bgra };
}

/** The counts of the places of the picture of the engine of the counts of them, of a bitmap of the engine. */
export function directorBmp(
	picture: {
		bitsPerPixel: number;
		palette?: Buffer | undefined;
		pixels: Uint8Array;
	},
	width: number,
	height: number,
): Buffer {
	if (8 === picture.bitsPerPixel && picture.palette)
		return writeBmp8Palette(
			width,
			height,
			Buffer.from(picture.pixels),
			picture.palette,
		);
	return writeBmp32(width, height, Buffer.from(picture.pixels));
}
