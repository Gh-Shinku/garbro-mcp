// Shapes shared by the pictures of the KaGuYa script engine animation resources.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";

/**
 * The rows of a picture of a frame stand bottom up in the file, which `ImageData.CreateFlipped` turns over: the
 * last row of the file is the first row of the picture.
 */
export function flipAnRows(
	pixels: Buffer,
	width: number,
	height: number,
	places: number,
): Buffer {
	const stride = width * places;
	const rows = Buffer.alloc(stride * height);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(
			rows,
			row * stride,
			(height - 1 - row) * stride,
			(height - row) * stride,
		);
	}
	return rows;
}

/**
 * The bitmap a picture of a frame of an animation resource stands of, of one, three or four places of a colour to
 * a pixel, with the rows of the file turned over. One place of a colour stands of a picture of grey, which the
 * engine reads as `Gray8`; a count the engine knows not stands of no bitmap.
 */
export function anFrameBitmap(
	width: number,
	height: number,
	pixels: Buffer,
	places: number,
): Buffer | undefined {
	const rows = flipAnRows(pixels, width, height, places);
	if (4 === places) return writeBmp32(width, height, rows);
	if (3 === places) return writeBmp24(width, height, rows);
	if (1 === places) {
		return writeBmp8Palette(width, height, rows, greyColourMap());
	}
	return undefined;
}

/** The colour map of a picture of one place of a colour, which the engine reads as a picture of grey. */
export function greyColourMap(): Buffer {
	const entries = Buffer.alloc(256 * 4);
	for (let level = 0; level < 256; level += 1) {
		entries[level * 4] = level;
		entries[level * 4 + 1] = level;
		entries[level * 4 + 2] = level;
	}
	return entries;
}
