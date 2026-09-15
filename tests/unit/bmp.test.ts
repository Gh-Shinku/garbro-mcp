import {
	paletteTriples,
	readBmpImage,
	RGB555_MASKS,
	RGB565_MASKS,
	toBgra32,
	writeBmp1,
	writeBmp4,
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";
import { describe, expect, it } from "vitest";

/** The rows of a buffer swapped round, for the bitmaps that store them bottom up. */
function swappedRows(pixels: Buffer, rowBytes: number): Buffer {
	const rows: Buffer[] = [];
	for (let row = pixels.length / rowBytes - 1; row >= 0; row -= 1) {
		rows.push(pixels.subarray(row * rowBytes, (row + 1) * rowBytes));
	}
	return Buffer.concat(rows);
}

/** A bitmap with one field of its header changed, for the cases a reader has to refuse. */
function patched(bmp: Buffer, offset: number, bytes: number[]): Buffer {
	const copy = Buffer.from(bmp);
	for (const [index, value] of bytes.entries()) copy[offset + index] = value;
	return copy;
}

const BGR_2X2 = Buffer.from([
	0x01, 0x02, 0x03, 0xff, 0x11, 0x12, 0x13, 0xff, 0x21, 0x22, 0x23, 0xff, 0x31,
	0x32, 0x33, 0xff,
]);

describe("bitmap reader", () => {
	it("reads back the pixels of a thirty two bit bitmap", () => {
		const image = readBmpImage(writeBmp32(2, 2, BGR_2X2));
		expect(image).toBeDefined();
		expect(image).toMatchObject({ width: 2, height: 2, bitsPerPixel: 32 });
		expect(image?.pixels.equals(BGR_2X2)).toBe(true);
		expect(image?.palette.length).toBe(0);
		expect(image?.masks).toBeUndefined();
	});

	it("takes the row padding out of a twenty four bit bitmap", () => {
		// Three pixels to a row is nine bytes, which a bitmap pads out to twelve.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x11, 0x12, 0x13,
			0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
		]);
		const bmp = writeBmp24(3, 2, pixels);
		expect(bmp.readUInt32LE(34)).toBe(24);
		const image = readBmpImage(bmp);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 24 });
		expect(image?.pixels.equals(pixels)).toBe(true);
	});

	it("reads the four bit palette the way a bitmap stores it", () => {
		// The writer takes red, green, blue triples and stores them the other way round.
		const palette = Buffer.from([10, 20, 30, 40, 50, 60]);
		const pixels = Buffer.from([0x12, 0x34]);
		const image = readBmpImage(writeBmp4(3, 1, pixels, palette));
		expect(image).toMatchObject({ width: 3, height: 1, bitsPerPixel: 4 });
		expect(image?.pixels.equals(pixels)).toBe(true);
		expect(image?.palette.subarray(0, 8)).toEqual(
			Buffer.from([30, 20, 10, 0, 60, 50, 40, 0]),
		);
	});

	it("reads the grey palette of an eight bit bitmap", () => {
		const pixels = Buffer.from([0, 1, 2, 3, 4]);
		const image = readBmpImage(writeBmp8(5, 1, pixels));
		expect(image).toMatchObject({ width: 5, height: 1, bitsPerPixel: 8 });
		expect(image?.pixels.equals(pixels)).toBe(true);
		expect(image?.palette.length).toBe(256 * 4);
		expect(image?.palette.subarray(0, 4)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
		);
		expect(image?.palette.subarray(255 * 4, 255 * 4 + 4)).toEqual(
			Buffer.from([0xff, 0xff, 0xff, 0x00]),
		);
	});

	it("reads a palette a caller supplied verbatim", () => {
		// The writer copies the entries it is given and pads the rest of the two hundred and fifty six out.
		const palette = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const image = readBmpImage(
			writeBmp8Palette(2, 1, Buffer.from([1, 0]), palette),
		);
		expect(image?.palette.length).toBe(256 * 4);
		expect(image?.palette.subarray(0, 8)).toEqual(palette);
	});

	it("reads a two colour bitmap", () => {
		// Ten pixels to a row are two bytes, which the writer pads out to four.
		const pixels = Buffer.from([0b10110010, 0b01000000]);
		// The two colour writer stores the three colour bytes of an entry and leaves its fourth alone.
		const palette = Buffer.from([9, 8, 7, 0, 5, 4, 3, 0]);
		const image = readBmpImage(writeBmp1(10, 1, pixels, palette));
		expect(image).toMatchObject({ width: 10, height: 1, bitsPerPixel: 1 });
		expect(image?.pixels.equals(pixels)).toBe(true);
		expect(image?.palette.equals(palette)).toBe(true);
	});

	it("reads the masks of a sixteen bit bitmap", () => {
		const pixels = Buffer.from([0x1f, 0x00, 0xe0, 0x03]);
		const image = readBmpImage(writeBmp16(2, 1, pixels));
		expect(image).toMatchObject({ width: 2, height: 1, bitsPerPixel: 16 });
		expect(image?.pixels.equals(pixels)).toBe(true);
		expect(image?.masks).toEqual(RGB555_MASKS);
		expect(
			readBmpImage(writeBmp16(2, 1, pixels, false, RGB565_MASKS))?.masks,
		).toEqual(RGB565_MASKS);
	});

	it("turns bottom up rows the right way", () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
		]);
		// The writer that is told its rows are already bottom up stores them as they stand, so reading the
		// bitmap back reports them the way round a reader of it would see them.
		const bmp = writeBmp24(2, 2, pixels, true);
		expect(bmp.readInt32LE(22)).toBe(2);
		const image = readBmpImage(bmp);
		expect(image?.pixels.equals(swappedRows(pixels, 6))).toBe(true);
	});

	it("refuses what its own writers could not have written", () => {
		const bmp = writeBmp24(2, 2, Buffer.alloc(12, 0x40));
		expect(readBmpImage(Buffer.alloc(0))).toBeUndefined();
		expect(readBmpImage(Buffer.alloc(54))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 0, [0x58, 0x42]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 14, [28, 0, 0, 0]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 18, [0, 0, 0, 0]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 22, [0, 0, 0, 0]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 26, [2, 0]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 28, [3, 0]))).toBeUndefined();
		// A run length bitmap carries its own decoder, which this reader does not have.
		expect(readBmpImage(patched(bmp, 30, [1, 0, 0, 0]))).toBeUndefined();
		expect(readBmpImage(patched(bmp, 30, [3, 0, 0, 0]))).toBeUndefined();
		// The pixel data has to fit inside the bitmap it claims to be.
		expect(readBmpImage(patched(bmp, 10, [0x00, 0x10, 0x00, 0x00]))).toBe(
			undefined,
		);
		// Two entries to a colour is all a four bit bitmap can name.
		expect(
			readBmpImage(
				patched(
					writeBmp4(1, 1, Buffer.from([0]), Buffer.alloc(48)),
					46,
					[17, 0, 0, 0],
				),
			),
		).toBeUndefined();
	});

	it("reads a bitmap whose header is longer than the one it writes", () => {
		// A fifty six byte header still puts its pixels where `bfOffBits` says it does.
		const written = writeBmp24(2, 1, Buffer.alloc(6, 0x20));
		const body = written.subarray(54);
		const header: Buffer = Buffer.alloc(70, 0x00);
		written.subarray(0, 54).copy(header, 0);
		header.writeUInt32LE(56, 14);
		header.writeUInt32LE(70, 10);
		header.writeUInt32LE(70 + body.length, 2);
		const image = readBmpImage(Buffer.concat([header, body]));
		expect(image).toMatchObject({ width: 2, height: 1, bitsPerPixel: 24 });
		expect(image?.pixels.equals(Buffer.alloc(6, 0x20))).toBe(true);
		// How much room a bitmap says its image takes up is its own business, as it is for a decoder.
		const wrongSize = Buffer.from(Buffer.concat([header, body]));
		wrongSize.writeUInt32LE(0xff, 34);
		expect(readBmpImage(wrongSize)?.pixels.equals(Buffer.alloc(6, 0x20))).toBe(
			true,
		);
	});
});

describe("bitmap expansion", () => {
	it("widens the channels of a sixteen bit bitmap by repeating their high bits", () => {
		// The widest red a five bit channel holds, which thirty one widened by its own high bits fills out.
		const red = readBmpImage(
			writeBmp16(1, 1, Buffer.from([0x00, 0x7c]), false, RGB555_MASKS),
		);
		expect(red && toBgra32(red)?.subarray(0, 4)).toEqual(
			Buffer.from([0x00, 0x00, 0xff, 0x00]),
		);
		// Twenty of thirty one is a hundred and sixty five of two hundred and fifty five.
		const middle = readBmpImage(
			writeBmp16(1, 1, Buffer.from([0x00, 0x50]), false, RGB555_MASKS),
		);
		expect(middle && toBgra32(middle)?.subarray(0, 4)).toEqual(
			Buffer.from([0x00, 0x00, 0xa5, 0x00]),
		);
		// The low five bits are the blue channel, which comes first in the pixels of a bitmap.
		const blue = readBmpImage(
			writeBmp16(1, 1, Buffer.from([0x1f, 0x00]), false, RGB555_MASKS),
		);
		expect(blue && toBgra32(blue)?.subarray(0, 4)).toEqual(
			Buffer.from([0xff, 0x00, 0x00, 0x00]),
		);
		// The six green bits of the other layout widen the same way.
		const green = readBmpImage(
			writeBmp16(1, 1, Buffer.from([0xe0, 0x07]), false, RGB565_MASKS),
		);
		expect(green && toBgra32(green)?.subarray(0, 4)).toEqual(
			Buffer.from([0x00, 0xff, 0x00, 0x00]),
		);
	});

	it("takes an indexed bitmap through its colour map", () => {
		const entries: Buffer = Buffer.alloc(16 * 4);
		entries[4] = 0x30;
		entries[5] = 0x20;
		entries[6] = 0x10;
		const image = readBmpImage(
			writeBmp4(2, 1, Buffer.from([0x10]), paletteTriples(entries)),
		);
		expect(image && toBgra32(image)?.subarray(0, 4)).toEqual(
			Buffer.from([0x30, 0x20, 0x10, 0x00]),
		);
	});

	it("leaves the fourth byte of a bitmap without alpha alone", () => {
		const image = readBmpImage(writeBmp24(1, 1, Buffer.from([1, 2, 3])));
		expect(image && toBgra32(image)?.subarray(0, 4)).toEqual(
			Buffer.from([1, 2, 3, 0x00]),
		);
	});
});

describe("bitmap reader with the older header", () => {
	/**
	 * A bitmap with the twelve byte header: words to a measurement and three bytes to a colour. The colour map
	 * is padded out to the number of colours the depth allows, which is what such a header implies.
	 */
	function coreHeaderBmp(
		width: number,
		height: number,
		bitsPerPixel: number,
		palette: number[],
		pixels: number[],
		pad = true,
	): Buffer {
		const colors = 1 << bitsPerPixel;
		const entries: Buffer = pad
			? Buffer.from([
					...palette,
					...new Array(Math.max(0, colors * 3 - palette.length)).fill(0),
				])
			: Buffer.from(palette);
		const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
		const stride = (rowBytes + 3) & ~3;
		const header: Buffer = Buffer.alloc(14 + 12, 0x00);
		header.write("BM", 0, "latin1");
		header.writeUInt32LE(header.length + entries.length + stride * height, 2);
		header.writeUInt32LE(header.length + entries.length, 10);
		header.writeUInt32LE(12, 14);
		header.writeUInt16LE(width, 18);
		header.writeUInt16LE(height, 20);
		header.writeUInt16LE(1, 22);
		header.writeUInt16LE(bitsPerPixel, 24);
		const rows: Buffer[] = [];
		for (let row = 0; row < height; row += 1) {
			const line: Buffer = Buffer.alloc(stride, 0x00);
			for (let i = 0; i < rowBytes; i += 1) {
				line[i] = pixels[row * rowBytes + i] ?? 0;
			}
			rows.push(line);
		}
		return Buffer.concat([header, entries, ...rows]);
	}

	it("reads a palette bitmap stored with three byte colours", () => {
		// Two rows of two pixels, stored bottom up as the older header requires.
		const bmp = coreHeaderBmp(2, 2, 8, [10, 20, 30, 40, 50, 60], [1, 2, 3, 4]);
		const image = readBmpImage(bmp);
		expect(image).toMatchObject({ width: 2, height: 2, bitsPerPixel: 8 });
		// The rows come back top down and without the padding the file stores them with: what the file stored
		// last is the first row of the picture.
		expect(image?.pixels.subarray(0, 4)).toEqual(Buffer.from([3, 4, 1, 2]));
		expect(image?.palette.subarray(0, 8)).toEqual(
			Buffer.from([10, 20, 30, 0, 40, 50, 60, 0]),
		);
		// The colour map of two hundred and fifty six entries the depth allows is what a full header needs.
		expect(image?.palette.length).toBe(256 * 4);
	});

	it("reads one bit pixels stored with the older header", () => {
		const bmp = coreHeaderBmp(
			9,
			1,
			1,
			[1, 2, 3, 4, 5, 6],
			[0b11000000, 0b10000000],
		);
		const image = readBmpImage(bmp);
		expect(image).toMatchObject({ width: 9, height: 1, bitsPerPixel: 1 });
		expect(image?.pixels.subarray(0, 2)).toEqual(
			Buffer.from([0b11000000, 0b10000000]),
		);
	});

	it("refuses an older header whose colours do not fit", () => {
		const bmp = coreHeaderBmp(2, 1, 8, [1, 2, 3], [0, 1], false);
		expect(readBmpImage(bmp)).toBeUndefined();
	});
});
