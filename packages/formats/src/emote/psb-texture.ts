// Port of GARbro "ArcFormats/Emote/ArcPSB.cs" (class `PsbTextureDecoder`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the E-mote engine, of the places of a
// chunk of the container and of the kind of the picture the archive names.
//
// The reference stands of the **full** picture of the engine (the counts the archive names as the counts of
// the picture) and hands over the **cut** picture (the counts it names beside them), so a row of the picture
// of this port stands of the count of the places of a colour of the cut picture, every row standing of the
// places of the full picture behind it.

import { GarbroError } from "@garbro-mcp/core";
import { writeBmp32 } from "../shared/bmp.js";
import { unpackDxt5 } from "../shared/dxt.js";

/** The kinds of picture of the engine the reference reads. */
export const PSB_TEXTURE_RGBA8 = "RGBA8";
export const PSB_TEXTURE_L8 = "L8";
export const PSB_TEXTURE_A8L8 = "A8L8";
export const PSB_TEXTURE_RGBA4444 = "RGBA4444";
export const PSB_TEXTURE_RL = "RL";
export const PSB_TEXTURE_DXT5 = "DXT5";

/** The places of the file of a picture of the engine, of the counts the archive names. */
export interface PsbTextureInfo {
	texType: string;
	/** The count of the places of a row of the full picture of the engine. */
	fullWidth: number;
	fullHeight: number;
	/** The count of the places of a row of the picture handed over. */
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `PsbTextureDecoder.GetImageData`: the places of a picture of the engine, of the kind of the picture. */
export function decodePsbTexture(
	data: Buffer,
	info: PsbTextureInfo,
): Buffer | undefined {
	const { width, height, fullWidth } = info;
	if (width <= 0 || height <= 0 || fullWidth <= 0) return undefined;
	const stride = width * 4;
	const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
	switch (info.texType) {
		case PSB_TEXTURE_RGBA8:
			readRgba8(data, pixels, info);
			break;
		case PSB_TEXTURE_L8:
			readL8(data, pixels, info);
			break;
		case PSB_TEXTURE_A8L8:
			readA8L8(data, pixels, info);
			break;
		case PSB_TEXTURE_RGBA4444:
			readRgba4444(data, pixels, info);
			break;
		case PSB_TEXTURE_RL:
			readRle(data, pixels);
			break;
		case PSB_TEXTURE_DXT5:
			return writeBmp32(width, height, unpackDxt5(data, width, height));
		default:
			return undefined;
	}
	return writeBmp32(width, height, pixels);
}

/** `ReadRgba8`: every place of a colour of the picture stands of four places of the file. */
function readRgba8(data: Buffer, pixels: Buffer, info: PsbTextureInfo): void {
	const sourceStride = info.fullWidth * 4;
	for (let row = 0; row < info.height; row += 1) {
		const from = row * sourceStride;
		data.copy(pixels, row * info.width * 4, from, from + info.width * 4);
	}
}

/** `ReadL8`: one place of grey of the file stands of every place of a colour of the picture. */
function readL8(data: Buffer, pixels: Buffer, info: PsbTextureInfo): void {
	for (let row = 0; row < info.height; row += 1) {
		for (let column = 0; column < info.width; column += 1) {
			const grey = data[row * info.fullWidth + column] ?? 0;
			const at = (row * info.width + column) * 4;
			pixels[at] = grey;
			pixels[at + 1] = grey;
			pixels[at + 2] = grey;
			pixels[at + 3] = 0xff;
		}
	}
}

/** `ReadA8L8`: two places of the file stand of every place of a colour of the picture. */
function readA8L8(data: Buffer, pixels: Buffer, info: PsbTextureInfo): void {
	for (let row = 0; row < info.height; row += 1) {
		for (let column = 0; column < info.width; column += 1) {
			const from = (row * info.fullWidth + column) * 2;
			const grey = data[from] ?? 0;
			const alpha = data[from + 1] ?? 0;
			const at = (row * info.width + column) * 4;
			pixels[at] = grey;
			pixels[at + 1] = grey;
			pixels[at + 2] = grey;
			pixels[at + 3] = alpha;
		}
	}
}

/** `ReadRgba4444`: every place of a colour of the picture stands of four places of half a place each. */
function readRgba4444(
	data: Buffer,
	pixels: Buffer,
	info: PsbTextureInfo,
): void {
	for (let row = 0; row < info.height; row += 1) {
		for (let column = 0; column < info.width; column += 1) {
			const value = data.readUInt16LE((row * info.fullWidth + column) * 2);
			const at = (row * info.width + column) * 4;
			// The reference stands of a count of the places of the file of the count of the places of a
			// colour: the whole of the count times two hundred and fifty five, of the count taken off.
			pixels[at] = (((value & 0x000f) * 0xff) / 0x000f) | 0;
			pixels[at + 1] = (((value & 0x00f0) * 0xff) / 0x00f0) | 0;
			pixels[at + 2] = (((value & 0x0f00) * 0xff) / 0x0f00) | 0;
			pixels[at + 3] = (((value & 0xf000) * 0xff) / 0xf000) | 0;
		}
	}
}

/**
 * `ReadRle`: a place of the file stands of counts of the places of a colour of the picture. A place of a
 * count of the high place at nought stands of the places of the file themselves; a place of a count of the
 * high place at one stands of one place of a colour, which stands again and again.
 */
function readRle(data: Buffer, pixels: Buffer): void {
	let at = 0;
	let from = 0;
	while (at < pixels.length && from < data.length) {
		const count = data[from] ?? 0;
		from += 1;
		if (0 === (count & 0x80)) {
			const run = 4 * (count + 1);
			const take = Math.min(run, pixels.length - at, data.length - from);
			data.copy(pixels, at, from, from + take);
			at += take;
			from += take;
		} else {
			const run = 4 * ((count & 0x7f) + 3);
			const pixel = data.subarray(from, from + 4);
			from += 4;
			if (pixel.length < 4) return;
			for (let step = 0; step < run && at < pixels.length; step += 1) {
				pixels[at] = pixel[step % 4] ?? 0;
				at += 1;
			}
		}
	}
	if (at < pixels.length) {
		throw invalidPicture(
			"The picture of the engine stands short of its own counts",
		);
	}
}
