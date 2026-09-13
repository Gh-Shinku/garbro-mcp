// Bitmap writers shared by the image ports that store raw pixels instead of a container.
// The GARbro references report those pixels through `ImageData.Create`, i.e. top down, so the bitmaps
// written here use a negative height and keep the stored byte order.

const BMP_HEADER_SIZE = 54;
const GREY_PALETTE_SIZE = 256 * 4;

function writeHeader(
	width: number,
	height: number,
	bitsPerPixel: number,
	dataOffset: number,
	imageSize: number,
	paletteEntries: number,
	bottomUp: boolean,
): Buffer {
	const header = Buffer.alloc(BMP_HEADER_SIZE);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(dataOffset + imageSize, 2);
	header.writeUInt32LE(dataOffset, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	// A negative height records a top down image; a positive one keeps bottom up rows.
	header.writeInt32LE(bottomUp ? height : -height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(bitsPerPixel, 28);
	header.writeUInt32LE(0, 30);
	header.writeUInt32LE(imageSize, 34);
	header.writeUInt32LE(paletteEntries, 46);
	return header;
}

/**
 * Wraps BGRA pixels in a 32 bit bitmap. The GARbro `ImageData.Create` readers store their rows top
 * down, which a negative height records; `ImageData.CreateFlipped` readers store them bottom up and
 * pass `bottomUp`.
 */
export function writeBmp32(
	width: number,
	height: number,
	pixels: Buffer,
	bottomUp = false,
): Buffer {
	return Buffer.concat([
		writeHeader(width, height, 32, BMP_HEADER_SIZE, pixels.length, 0, bottomUp),
		pixels,
	]);
}

/**
 * Wraps eight bit pixels in a grey bitmap. Bitmap rows are aligned to four bytes, so every row is
 * padded with zeros to `width` rounded up to a multiple of four; that padding is the only difference
 * from the stored pixels. As with `writeBmp32`, the stored rows are top down by default and
 * `ImageData.CreateFlipped` readers pass `bottomUp`.
 */
export function writeBmp8(
	width: number,
	height: number,
	pixels: Buffer,
	bottomUp = false,
): Buffer {
	const stride = (width + 3) & ~3;
	const imageSize = stride * height;
	const dataOffset = BMP_HEADER_SIZE + GREY_PALETTE_SIZE;
	const palette = Buffer.alloc(GREY_PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = i;
		palette[i * 4 + 2] = i;
	}
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * width, row * width + width);
		rows.push(line);
	}
	return Buffer.concat([
		writeHeader(width, height, 8, dataOffset, imageSize, 256, bottomUp),
		palette,
		...rows,
	]);
}
