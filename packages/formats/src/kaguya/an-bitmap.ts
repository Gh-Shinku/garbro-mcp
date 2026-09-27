// Shapes shared by the pictures of the KaGuYa script engine animation resources.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
