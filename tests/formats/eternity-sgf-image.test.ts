import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeSgfColours,
	eternitySgfImageFormat,
	readSgfLayout,
	unpackSgfPicture,
} from "../../packages/formats/src/eternity/sgf-image.js";
import type { SgfLayout } from "../../packages/formats/src/eternity/sgf-image.js";

const HEADER_SIZE = 0x20;
const DATA_OFFSET = 0x40;

/**
 * The words a stream of literals is made of. The reader takes a word whenever its mask reaches one: the
 * first word answers "a byte follows" once per bit from the lowest up, the second says "a literal" in the
 * same way, and the fifth holds four literal bytes, lowest first.
 */
function literalWords(bytes: number[]): Buffer {
	const out: Buffer[] = [];
	for (let call = 0; call < bytes.length; call += 1) {
		if (0 === call % 32) {
			out.push(Buffer.alloc(4)); // no bit set: every answer carries a byte
			out.push(Buffer.alloc(4)); // no bit set: every answer is a literal
		}
		if (0 === call % 4) {
			const word = Buffer.alloc(4);
			for (let k = 0; k < 4; k += 1) word[k] = (bytes[call + k] ?? 0) & 0xff;
			out.push(word);
		}
	}
	return Buffer.concat(out);
}

/** One colour block: its length word, the four seed bytes, then the words of its answers. */
function colourBlock(seed: [number, number, number], bytes: number[]): Buffer {
	const body = Buffer.concat([
		Buffer.from([seed[0], seed[1], seed[2], 0]),
		literalWords(bytes),
	]);
	const head = Buffer.alloc(4);
	head.writeUInt32LE(4 + body.length, 0);
	return Buffer.concat([head, body]);
}

function buildFile(options: {
	width: number;
	height: number;
	blockSize: number;
	data: Buffer;
	alpha?: Buffer;
}): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("SG", 0, "latin1");
	header.writeUInt16LE(100, 2);
	header.writeUInt16LE(options.width, 4);
	header.writeUInt16LE(options.height, 6);
	header.writeInt32LE(options.alpha ? 1 : 0, 8);
	header.writeUInt16LE(options.blockSize, 0x0c);
	header.writeUInt32LE(DATA_OFFSET, 0x14);
	const alphaOffset = options.alpha ? DATA_OFFSET + options.data.length : 0;
	header.writeUInt32LE(alphaOffset, 0x1c);
	return Buffer.concat([
		header,
		Buffer.alloc(DATA_OFFSET - HEADER_SIZE, 0x00),
		options.data,
		options.alpha ?? Buffer.alloc(0),
	]);
}

/** An `A ` alpha section holding one block of literals, one value for every pixel, bottom row first. */
function alphaSection(values: number[]): Buffer {
	const block = Buffer.alloc(8 + literalWords(values).length, 0x00);
	block[4] = values[0] ?? 0;
	literalWords(values).copy(block, 8);
	block.writeUInt32LE(block.length, 0);
	const section = Buffer.alloc(0x14, 0x00);
	section.writeUInt16LE(0x2041, 0); // 'A '
	section.writeUInt16LE(0x40, 8); // a block size above the height: one block
	section.writeUInt32LE(0x14, 0x10); // where the first block starts
	return Buffer.concat([section, block]);
}

function layoutOf(file: Buffer): SgfLayout {
	const layout = readSgfLayout(file);
	if (!layout) throw new Error("no layout");
	return layout;
}

/** The pixel data of a bitmap, which starts right behind the header when there is no colour map. */
function bitmapPixels(bmp: Buffer): Buffer {
	return bmp.subarray(0x36);
}

describe("Eternity engine image format", () => {
	it("rejects files that are not pictures of this kind", () => {
		expect(readSgfLayout(Buffer.alloc(0x10, 0x00))).toBeUndefined();
		const wrongMarker = buildFile({
			width: 1,
			height: 1,
			blockSize: 1,
			data: colourBlock([0, 0, 0], [1, 2, 3]),
		});
		wrongMarker.write("XX", 0, "latin1");
		expect(readSgfLayout(wrongMarker)).toBeUndefined();
		const wrongVersion = buildFile({
			width: 1,
			height: 1,
			blockSize: 1,
			data: colourBlock([0, 0, 0], [1, 2, 3]),
		});
		wrongVersion.writeUInt16LE(101, 2);
		expect(readSgfLayout(wrongVersion)).toBeUndefined();
	});

	it("reads the header fields", () => {
		const file = buildFile({
			width: 0x140,
			height: 0xc8,
			blockSize: 4,
			data: colourBlock([0, 0, 0], [1, 2, 3]),
			alpha: alphaSection([9, 9]),
		});
		const layout = layoutOf(file);
		expect(layout.width).toBe(0x140);
		expect(layout.height).toBe(0xc8);
		expect(layout.blockSize).toBe(4);
		expect(layout.hasAlpha).toBe(true);
		expect(layout.dataOffset).toBe(DATA_OFFSET);
	});

	it("walks a block of literals and starts every row over", () => {
		// Two rows of two pixels: twelve answers, all of them literals, so the stored bytes are the
		// picture. The row restart only re-reads the first pixel of the row it just wrote.
		const bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
		const file = buildFile({
			width: 2,
			height: 2,
			blockSize: 4,
			data: colourBlock([0x30, 0x40, 0x50], bytes),
		});
		const colours = decodeSgfColours(file, layoutOf(file));
		expect(colours).toEqual(Buffer.from(bytes));
	});

	it("walks the differences of a block", () => {
		// One pixel: the first answer of each channel. The first word says every answer carries a byte,
		// the second says every one of them is a difference, the third says every difference goes up,
		// and the fourth holds three nibbles: one for a step of one, two, and fifteen.
		const seed = [10, 20, 30];
		const words = Buffer.alloc(16, 0x00);
		// The words sit in the order the reader takes them: the answers, the kinds of answer, the
		// directions, then the nibbles.
		words.writeUInt32LE(0x00000007, 4); // three differences, then nothing more
		words.writeUInt32LE(0x00000f10, 12); // nibbles 0, 1 and 15
		const body = Buffer.concat([
			Buffer.from([seed[0] ?? 0, seed[1] ?? 0, seed[2] ?? 0, 0]),
			words,
		]);
		const head = Buffer.alloc(4);
		head.writeUInt32LE(4 + body.length, 0);
		const file = buildFile({
			width: 1,
			height: 1,
			blockSize: 1,
			data: Buffer.concat([head, body]),
		});
		const colours = decodeSgfColours(file, layoutOf(file));
		expect([...colours]).toEqual([11, 22, 46]);
	});

	it("keeps a channel where the first word says so", () => {
		// The lowest bit of the first word is set, so the blue channel of the first pixel keeps the seed
		// and no byte is read for it; the green and red channels are literals.
		const seed = [77, 20, 30];
		const words = Buffer.alloc(12, 0x00);
		words.writeUInt32LE(0x00000001, 0); // the first answer keeps the channel
		words.writeUInt32LE(0x00000000, 4); // the second word still says "a literal"
		words[8] = 0x88; // the literal of the green channel
		words[9] = 0x99; // and of the red channel
		const body = Buffer.concat([
			Buffer.from([seed[0] ?? 0, seed[1] ?? 0, seed[2] ?? 0, 0]),
			words,
		]);
		const head = Buffer.alloc(4);
		head.writeUInt32LE(4 + body.length, 0);
		const file = buildFile({
			width: 1,
			height: 1,
			blockSize: 1,
			data: Buffer.concat([head, body]),
		});
		const colours = decodeSgfColours(file, layoutOf(file));
		expect([...colours]).toEqual([77, 0x88, 0x99]);
	});

	it("follows the block length to the next block", () => {
		// Two blocks of two rows each, with a seed and a literal stream of their own: the length word of
		// the first block is what tells the reader where the second one starts.
		const first = colourBlock([1, 2, 3], [11, 12, 13, 14, 15, 16]);
		const second = colourBlock([4, 5, 6], [21, 22, 23, 24, 25, 26]);
		const file = buildFile({
			width: 1,
			height: 4,
			blockSize: 2,
			data: Buffer.concat([first, second]),
		});
		const colours = decodeSgfColours(file, layoutOf(file));
		expect([...colours]).toEqual([
			11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26,
		]);
	});

	it("reads an alpha section from the bottom row up", () => {
		// One column of two pixels. The alpha reader fills its array from the last row backwards, so the
		// first value it decodes belongs to the bottom pixel, and the array it leaves behind is top down.
		const file = buildFile({
			width: 1,
			height: 2,
			blockSize: 2,
			data: colourBlock([1, 2, 3], [10, 20, 30, 40, 50, 60]),
			alpha: alphaSection([0xb0, 0xa0]),
		});
		const bmp = unpackSgfPicture(file, layoutOf(file));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		const pixels = bmp.subarray(0x36);
		// BGRA, top row first: the top pixel carries the second alpha value.
		expect([...pixels]).toEqual([10, 20, 30, 0xa0, 40, 50, 60, 0xb0]);
	});

	it("leaves an alpha section of the bitmap kind unread", () => {
		const section = Buffer.alloc(0x20, 0x00);
		section.writeUInt16LE(0x4d42, 0); // 'BM'
		const file = buildFile({
			width: 1,
			height: 1,
			blockSize: 1,
			data: colourBlock([1, 2, 3], [10, 20, 30]),
			alpha: section,
		});
		// The reference's `ReadBmpSection` returns nothing, so the picture is left with three channels.
		const bmp = unpackSgfPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		// A row of one three byte pixel is padded to four bytes.
		expect([...bitmapPixels(bmp)]).toEqual([10, 20, 30, 0]);
	});

	it("refuses a picture that declares no block size", () => {
		const file = buildFile({
			width: 1,
			height: 1,
			blockSize: 0,
			data: colourBlock([1, 2, 3], [10, 20, 30]),
		});
		expect(() => decodeSgfColours(file, layoutOf(file))).toThrow(GarbroError);
	});

	it("refuses a stream that ends early", () => {
		const file = buildFile({
			width: 4,
			height: 4,
			blockSize: 1,
			data: colourBlock([1, 2, 3], [10, 20, 30]),
		});
		expect(() => decodeSgfColours(file, layoutOf(file))).toThrow(GarbroError);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const file = buildFile({
			width: 2,
			height: 2,
			blockSize: 2,
			data: colourBlock([1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
		});
		await expect(
			eternitySgfImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		await expect(
			eternitySgfImageFormat.detect(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
			),
		).resolves.toBe(false);
		const archive = await eternitySgfImageFormat.open(
			new BufferByteSource(file),
			"picture.sgf",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual(["picture.bmp"]);
		expect(archive.metadata.width).toBe(2);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await archive.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect([...bitmapPixels(bmp)]).toEqual([
			1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0,
		]);
		await expect(
			eternitySgfImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"picture.sgf",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
