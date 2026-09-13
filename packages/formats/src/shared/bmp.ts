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
 * Reads the dimensions a bitmap header declares. The reference readers all go through GARbro's
 * `Bmp.ReadMetaData`, which requires a `BM` tag, a DIB header of at least forty bytes and non-zero
 * dimensions and bit depth; a `bfSize` that cannot describe the file it came from is rejected here too.
 * Returns the fields the image ports report, with `fileSize` being the bitmap's own length.
 */
export function readBmpMetaData(
	bmp: Buffer,
):
	| { width: number; height: number; bitsPerPixel: number; fileSize: number }
	| undefined {
	if (bmp.length < BMP_HEADER_SIZE) return undefined;
	if (bmp.subarray(0, 2).toString("latin1") !== "BM") return undefined;
	const fileSize = bmp.readUInt32LE(2);
	if (fileSize < BMP_HEADER_SIZE || fileSize > bmp.length) return undefined;
	if (bmp.readUInt32LE(14) < 40) return undefined;
	const width = bmp.readInt32LE(18);
	const signedHeight = bmp.readInt32LE(22);
	if (width <= 0 || signedHeight === 0) return undefined;
	const bitsPerPixel = bmp.readUInt16LE(28);
	if (bitsPerPixel === 0) return undefined;
	return {
		width,
		height: Math.abs(signedHeight),
		bitsPerPixel,
		fileSize,
	};
}

/**
 * Wraps 16 bit pixels in a bitmap using `BI_BITFIELDS` with the VGA 555 masks, which is how GARbro
 * writes `Bgr555` data: the three masks follow the forty byte DIB header, so the pixel data starts at
 * offset 66. Rows are aligned to four bytes like every other bitmap here.
 */
export function writeBmp16(
	width: number,
	height: number,
	pixels: Buffer,
	bottomUp = false,
): Buffer {
	const stride = (width * 2 + 3) & ~3;
	const imageSize = stride * height;
	const dataOffset = BMP_HEADER_SIZE + 12;
	const header = writeHeader(
		width,
		height,
		16,
		dataOffset,
		imageSize,
		0,
		bottomUp,
	);
	// `BI_BITFIELDS` tells readers to look for the colour masks that follow.
	header.writeUInt32LE(3, 30);
	const masks: Buffer = Buffer.alloc(12);
	masks.writeUInt32LE(0x7c00, 0);
	masks.writeUInt32LE(0x03e0, 4);
	masks.writeUInt32LE(0x001f, 8);
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * width * 2, (row + 1) * width * 2);
		rows.push(line);
	}
	return Buffer.concat([header, masks, ...rows]);
}

/**
 * Wraps eight bit pixels in a bitmap with a caller supplied palette, which the Logg images carry. The
 * palette is copied verbatim and zero padded to 256 entries, so whatever byte order the reference passes
 * through reaches the bitmap unchanged; rows are padded the same way as in `writeBmp8`.
 */
export function writeBmp8Palette(
	width: number,
	height: number,
	pixels: Buffer,
	palette: Buffer,
	bottomUp = false,
): Buffer {
	const stride = (width + 3) & ~3;
	const imageSize = stride * height;
	const dataOffset = BMP_HEADER_SIZE + GREY_PALETTE_SIZE;
	const entries = Buffer.alloc(GREY_PALETTE_SIZE);
	palette.copy(entries, 0, 0, Math.min(palette.length, GREY_PALETTE_SIZE));
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * width, row * width + width);
		rows.push(line);
	}
	return Buffer.concat([
		writeHeader(width, height, 8, dataOffset, imageSize, 256, bottomUp),
		entries,
		...rows,
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
