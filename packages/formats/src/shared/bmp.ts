// Bitmap writers shared by the image ports that store raw pixels instead of a container.
// The GARbro references report those pixels through `ImageData.Create`, i.e. top down, so the bitmaps
// written here use a negative height and keep the stored byte order.

const BMP_HEADER_SIZE = 54;
const GREY_PALETTE_SIZE = 256 * 4;

export function writeHeader(
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
	const fileSize = bmp.readUInt32LE(2);
	if (fileSize < BMP_HEADER_SIZE || fileSize > bmp.length) return undefined;
	const fields = readBmpHeaderFields(bmp);
	if (!fields) return undefined;
	return { ...fields, fileSize };
}

/**
 * The header checks alone, for callers that hold a bitmap's header without the whole file — a decompressed
 * prefix, for instance, whose `bfSize` still describes the image it came from and so cannot be compared with
 * the buffer it is in. Same requirements as above otherwise: a `BM` tag, a DIB header of at least forty bytes,
 * a positive width, a non-zero height and a non-zero bit depth.
 */
export function readBmpHeaderFields(
	bmp: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	if (bmp.length < BMP_HEADER_SIZE) return undefined;
	if (bmp.subarray(0, 2).toString("latin1") !== "BM") return undefined;
	if (bmp.readUInt32LE(14) < 40) return undefined;
	const width = bmp.readInt32LE(18);
	const signedHeight = bmp.readInt32LE(22);
	if (width <= 0 || signedHeight === 0) return undefined;
	const bitsPerPixel = bmp.readUInt16LE(28);
	if (bitsPerPixel === 0) return undefined;
	return { width, height: Math.abs(signedHeight), bitsPerPixel };
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
	masks: BitmapMasks = RGB555_MASKS,
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
	const maskBytes: Buffer = Buffer.alloc(12);
	maskBytes.writeUInt32LE(masks.red, 0);
	maskBytes.writeUInt32LE(masks.green, 4);
	maskBytes.writeUInt32LE(masks.blue, 8);
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * width * 2, (row + 1) * width * 2);
		rows.push(line);
	}
	return Buffer.concat([header, maskBytes, ...rows]);
}

/**
 * The colour masks a sixteen bit bitmap declares. Five bits per channel is the layout GARbro's own writers
 * use, while several legacy engines store six green bits instead, so the caller picks.
 */
export interface BitmapMasks {
	red: number;
	green: number;
	blue: number;
}

/** Five bits per channel, the layout the existing ports and GARbro itself use. */
export const RGB555_MASKS: BitmapMasks = {
	red: 0x7c00,
	green: 0x03e0,
	blue: 0x001f,
};

/** Six green bits, as stored by the Project-Myu reader and other legacy engines. */
export const RGB565_MASKS: BitmapMasks = {
	red: 0xf800,
	green: 0x07e0,
	blue: 0x001f,
};

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
 * Wraps twenty four bit pixels in a bitmap. The stored order is already BGR, which is also what a 24 bit
 * bitmap holds, so the only change is that rows are aligned to four bytes and padded. `ImageData.Create`
 * readers keep their rows top down, while `CreateFlipped` readers store them bottom up and pass `bottomUp`.
 */
export function writeBmp24(
	width: number,
	height: number,
	pixels: Buffer,
	bottomUp = false,
): Buffer {
	const sourceStride = width * 3;
	const stride = (sourceStride + 3) & ~3;
	const imageSize = stride * height;
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * sourceStride, row * sourceStride + sourceStride);
		rows.push(line);
	}
	return Buffer.concat([
		writeHeader(width, height, 24, BMP_HEADER_SIZE, imageSize, 0, bottomUp),
		...rows,
	]);
}

/**
 * Wraps four bit pixels in a palette bitmap. The stored pixels are already packed two per byte with a
 * stride of half the width rounded up, so the only change is that bitmap rows are aligned to four bytes
 * and therefore padded. `palette` holds up to sixteen RGB triples, which become the bitmap's sixteen
 * entries; the reference formats that use this writer all declare sixteen colours. As with the other
 * writers, `bottomUp` is for readers that use `ImageData.CreateFlipped`.
 */
export function writeBmp4(
	width: number,
	height: number,
	pixels: Buffer,
	palette: Buffer,
	bottomUp = false,
): Buffer {
	const sourceStride = (width + 1) >> 1;
	const stride = (sourceStride + 3) & ~3;
	const imageSize = stride * height;
	const paletteSize = 16 * 4;
	const dataOffset = BMP_HEADER_SIZE + paletteSize;
	const entries = Buffer.alloc(paletteSize);
	for (let i = 0; i < 16; i += 1) {
		const source = i * 3;
		if (source + 2 >= palette.length) break;
		entries[i * 4] = palette[source + 2] ?? 0;
		entries[i * 4 + 1] = palette[source + 1] ?? 0;
		entries[i * 4 + 2] = palette[source] ?? 0;
	}
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line = Buffer.alloc(stride);
		pixels.copy(line, 0, row * sourceStride, row * sourceStride + sourceStride);
		rows.push(line);
	}
	const body = Buffer.concat(rows);
	return Buffer.concat([
		writeHeader(width, height, 4, dataOffset, imageSize, 16, bottomUp),
		entries,
		body,
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

/**
 * Wraps one bit pixels in a two colour bitmap. The caller's palette holds two entries in the same blue,
 * green, red order a bitmap stores them; the fourth byte of an entry is left at zero as a bitmap requires.
 * Rows are bit packed and padded to four bytes.
 */
export function writeBmp1(
	width: number,
	height: number,
	pixels: Buffer,
	palette: Buffer,
	bottomUp = false,
): Buffer {
	const sourceStride = (width + 7) >> 3;
	const stride = (sourceStride + 3) & ~3;
	const imageSize = stride * height;
	const paletteEntries = 2;
	const paletteSize = paletteEntries * 4;
	const dataOffset = BMP_HEADER_SIZE + paletteSize;
	const entries: Buffer = Buffer.alloc(paletteSize, 0x00);
	for (let i = 0; i < paletteEntries; i += 1) {
		const source = i * 4;
		if (source + 3 >= palette.length) break;
		entries[i * 4] = palette[source] ?? 0;
		entries[i * 4 + 1] = palette[source + 1] ?? 0;
		entries[i * 4 + 2] = palette[source + 2] ?? 0;
	}
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line: Buffer = Buffer.alloc(stride, 0x00);
		pixels.copy(line, 0, row * sourceStride, row * sourceStride + sourceStride);
		rows.push(line);
	}
	return Buffer.concat([
		writeHeader(
			width,
			height,
			1,
			dataOffset,
			imageSize,
			paletteEntries,
			bottomUp,
		),
		entries,
		Buffer.concat(rows),
	]);
}

/** A bitmap read back into the pieces the writers of this module take. */
export interface BmpImage {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The colour entries as the file stores them, four bytes each, empty when there is no palette. */
	palette: Buffer;
	/** The pixels with the row padding taken out, top down, in the order the matching writer takes them. */
	pixels: Buffer;
	/** The colour masks a sixteen bit bitmap declares, which the file always carries for that depth. */
	masks?: BitmapMasks;
}

const DIB_HEADER_SIZE = 40;
const SUPPORTED_DEPTHS = new Set([1, 4, 8, 16, 24, 32]);

/**
 * Reads a bitmap this module could have written back into its measurements, its palette and its pixels.
 * Only the two uncompressed layouts are read, `BI_RGB` and `BI_BITFIELDS`: a run length bitmap is not
 * something the writers here produce, and the ports that meet one carry their own decoder. Returns
 * nothing for anything the writers could not have written, which is what the ports report as a failure.
 *
 * The returned palette is the file's own four byte entries, which is the order `writeBmp8Palette` and
 * `writeBmp1` take; `writeBmp4` takes three byte triples instead and its callers convert.
 */
export function readBmpImage(bmp: Buffer): BmpImage | undefined {
	if (bmp.length < BMP_HEADER_SIZE) return undefined;
	if (bmp.subarray(0, 2).toString("latin1") !== "BM") return undefined;
	const dataOffset = bmp.readUInt32LE(10);
	const dibHeaderSize = bmp.readUInt32LE(14);
	if (dibHeaderSize < DIB_HEADER_SIZE || dataOffset < 14 + dibHeaderSize)
		return undefined;
	const width = bmp.readInt32LE(18);
	const signedHeight = bmp.readInt32LE(22);
	if (width <= 0 || signedHeight === 0) return undefined;
	const height = Math.abs(signedHeight);
	if (bmp.readUInt16LE(26) !== 1) return undefined;
	const bitsPerPixel = bmp.readUInt16LE(28);
	if (!SUPPORTED_DEPTHS.has(bitsPerPixel)) return undefined;
	const compression = bmp.readUInt32LE(30);
	if (compression !== 0 && compression !== 3) return undefined;
	if (compression === 3 && bitsPerPixel !== 16 && bitsPerPixel !== 32)
		return undefined;
	// A four byte entry to a colour, with the count falling back to the whole palette the depth allows.
	let palette: Buffer = Buffer.alloc(0);
	if (bitsPerPixel <= 8) {
		const declared = bmp.readUInt32LE(46);
		const colors = 0 === declared ? 1 << bitsPerPixel : declared;
		if (colors > 1 << bitsPerPixel) return undefined;
		const paletteOffset = 14 + dibHeaderSize;
		if (paletteOffset + colors * 4 > bmp.length) return undefined;
		palette = Buffer.from(
			bmp.subarray(paletteOffset, paletteOffset + colors * 4),
		);
	}
	let masks: BitmapMasks | undefined;
	if (3 === compression) {
		if (BMP_HEADER_SIZE + 12 > bmp.length) return undefined;
		masks = {
			red: bmp.readUInt32LE(BMP_HEADER_SIZE),
			green: bmp.readUInt32LE(BMP_HEADER_SIZE + 4),
			blue: bmp.readUInt32LE(BMP_HEADER_SIZE + 8),
		};
	}
	const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
	const stride = (rowBytes + 3) & ~3;
	const imageSize = stride * height;
	if (!Number.isSafeInteger(imageSize) || dataOffset + imageSize > bmp.length)
		return undefined;
	const pixels: Buffer = Buffer.alloc(rowBytes * height);
	// A positive height records bottom up rows, which the writers here only produce on request.
	const bottomUp = signedHeight > 0;
	for (let row = 0; row < height; row += 1) {
		const stored = bottomUp ? height - 1 - row : row;
		bmp.copy(
			pixels,
			row * rowBytes,
			dataOffset + stored * stride,
			dataOffset + stored * stride + rowBytes,
		);
	}
	const image: BmpImage = { width, height, bitsPerPixel, palette, pixels };
	if (masks) image.masks = masks;
	return image;
}

/** The three colour bytes of every palette entry, in the order `writeBmp4` takes them. */
export function paletteTriples(palette: Buffer): Buffer {
	const triples: Buffer = Buffer.alloc(Math.floor(palette.length / 4) * 3);
	for (let i = 0; i * 4 + 3 < palette.length; i += 1) {
		triples[i * 3] = palette[i * 4 + 2] ?? 0;
		triples[i * 3 + 1] = palette[i * 4 + 1] ?? 0;
		triples[i * 3 + 2] = palette[i * 4] ?? 0;
	}
	return triples;
}

/** Writes a bitmap this module read back, keeping the depth it was stored in. */
export function writeBmpImage(image: BmpImage): Buffer {
	const { width, height, bitsPerPixel, palette, pixels } = image;
	switch (bitsPerPixel) {
		case 1:
			return writeBmp1(width, height, pixels, palette);
		case 4:
			return writeBmp4(width, height, pixels, paletteTriples(palette));
		case 8:
			return writeBmp8Palette(width, height, pixels, palette);
		case 16:
			return writeBmp16(
				width,
				height,
				pixels,
				false,
				image.masks ?? RGB555_MASKS,
			);
		case 24:
			return writeBmp24(width, height, pixels);
		default:
			return writeBmp32(width, height, pixels);
	}
}

/**
 * Expands a bitmap this module read into the thirty two bit blue, green, red, alpha pixels GARbro's own
 * conversions produce: an indexed bitmap goes through its colour map, and a sixteen bit one has its five or
 * six bit channels widened by repeating their high bits. The fourth byte of a bitmap that has no alpha
 * channel is left at zero, which is what `PixelFormats.Bgr32` carries; a caller that goes on to write its own
 * alpha into it overwrites it either way.
 */
export function toBgra32(image: BmpImage): Buffer | undefined {
	const { width, height, bitsPerPixel, palette, pixels } = image;
	const count = width * height;
	const output: Buffer = Buffer.alloc(count * 4);
	const entry = (index: number, at: number): void => {
		output[at] = palette[index * 4] ?? 0;
		output[at + 1] = palette[index * 4 + 1] ?? 0;
		output[at + 2] = palette[index * 4 + 2] ?? 0;
	};
	switch (bitsPerPixel) {
		case 1:
		case 4:
		case 8: {
			const perByte = 8 / bitsPerPixel;
			const mask = (1 << bitsPerPixel) - 1;
			for (let i = 0; i < count; i += 1) {
				const byte = pixels[Math.floor(i / perByte)] ?? 0;
				const shift = 8 - bitsPerPixel * ((i % perByte) + 1);
				entry((byte >> shift) & mask, i * 4);
			}
			return output;
		}
		case 16: {
			const masks = image.masks ?? RGB555_MASKS;
			const red = channel(masks.red);
			const green = channel(masks.green);
			const blue = channel(masks.blue);
			for (let i = 0; i < count; i += 1) {
				const value = pixels.readUInt16LE(i * 2);
				output[i * 4] = widen((value & masks.blue) >>> blue.shift, blue.bits);
				output[i * 4 + 1] = widen(
					(value & masks.green) >>> green.shift,
					green.bits,
				);
				output[i * 4 + 2] = widen((value & masks.red) >>> red.shift, red.bits);
			}
			return output;
		}
		case 24:
			for (let i = 0; i < count; i += 1) {
				output[i * 4] = pixels[i * 3] ?? 0;
				output[i * 4 + 1] = pixels[i * 3 + 1] ?? 0;
				output[i * 4 + 2] = pixels[i * 3 + 2] ?? 0;
			}
			return output;
		case 32:
			for (let i = 0; i < count; i += 1) {
				output[i * 4] = pixels[i * 4] ?? 0;
				output[i * 4 + 1] = pixels[i * 4 + 1] ?? 0;
				output[i * 4 + 2] = pixels[i * 4 + 2] ?? 0;
			}
			return output;
		default:
			return undefined;
	}
}

/** Where a colour mask starts and how many bits it keeps, so a value can be moved into eight bits. */
function channel(mask: number): { shift: number; bits: number } {
	const shift = 31 - Math.clz32(mask & -mask);
	return { shift, bits: 32 - Math.clz32(mask) - shift };
}

/** Widens a channel value to eight bits by repeating its high bits, the way the framework's conversions do. */
function widen(value: number, bits: number): number {
	return (value << (8 - bits)) | (value >>> (2 * bits - 8));
}
