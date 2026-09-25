import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	kgImageFormat,
	readKgLayout,
	unpackKg,
} from "../../packages/formats/src/abogado/kg-image.js";

const HEAD_SIZE = 0x30;
const PALETTE_AT = 0x400;
const DATA_AT = 0x800;
const ALPHA_AT = 0xc00;

/** One decision of a channel: how many bits it takes and what they hold. */
type Item = readonly [number, number];

/** The bits of a channel's walk, most significant first, as its own reader takes them. */
function bitStream(items: readonly Item[]): Buffer {
	const bits: number[] = [];
	for (const [count, value] of items) {
		for (let at = count - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	}
	while (bits.length % 8 !== 0) bits.push(0);
	const bytes = Buffer.alloc(bits.length / 8, 0x00);
	for (const [index, bit] of bits.entries()) {
		if (bit)
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (0x80 >> (index & 7));
	}
	return bytes;
}

/** The bits of every channel of a picture, one behind the other in one stream, as the reader walks them. */
function channelsStream(channels: readonly Item[][]): Buffer {
	return bitStream(channels.flat());
}

/** A picture of this engine: the head, the colour map behind it, then the channels of the picture. */
function buildKg(options: {
	width: number;
	height: number;
	layout: number;
	depth: number;
	channels: readonly Item[][];
	palette?: Buffer;
	alpha?: readonly Item[];
	alphaOffset?: number;
}): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("KG", 0, "latin1");
	head[2] = options.layout;
	head[3] = options.depth;
	head.writeUInt16LE(options.width, 4);
	head.writeUInt16LE(options.height, 6);
	head.writeInt32LE(options.palette ? PALETTE_AT : 0, 0x0c);
	head.writeInt32LE(DATA_AT, 0x10);
	if (2 === options.layout) {
		head.writeInt32LE(options.alphaOffset ?? 0, 0x2c);
	}
	const data = Buffer.alloc(ALPHA_AT + 0x100, 0x00);
	head.copy(data, 0);
	if (options.palette) options.palette.copy(data, PALETTE_AT);
	channelsStream(options.channels).copy(data, DATA_AT);
	if (options.alpha) bitStream(options.alpha).copy(data, ALPHA_AT);
	return data;
}

/** A colour map as the file stores it, four bytes to a colour, blue first as a bitmap keeps it. */
function buildPalette(colours: readonly [number, number, number][]): Buffer {
	const palette = Buffer.alloc(0x400, 0x00);
	for (const [index, colour] of colours.entries()) {
		palette[index * 4] = colour[0];
		palette[index * 4 + 1] = colour[1];
		palette[index * 4 + 2] = colour[2];
	}
	return palette;
}

/** A byte of its own behind a control bit that says the pixel follows one. */
function literal(value: number): Item[] {
	return [
		[1, 0],
		[1, 1],
		[8, value],
	];
}

/** A byte predicted out of the dictionary of the byte before it, named by three bits. */
function predicted(index: number): Item[] {
	return [
		[1, 0],
		[1, 0],
		[3, index],
	];
}

/** A run copied from a place of the channel, named by its code and a length of two bits. */
function copyFrom(code: number, count: number): Item[] {
	return [
		[1, 1],
		[1, 1],
		[2, code],
		[2, count],
	];
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await kgImageFormat.open(
		new BufferByteSource(data),
		"picture.kg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("AbogadoPowers image", () => {
	it("draws the three channels of a picture of twenty four bits", () => {
		// Two rows of two pixels: every channel stands its first two bytes as they are and reads the two
		// behind them whole.
		const channel = (
			first: number,
			second: number,
			third: number,
			fourth: number,
		): Item[] => [
			[8, first],
			[8, second],
			...literal(third),
			...literal(fourth),
		];
		const data = buildKg({
			width: 2,
			height: 2,
			layout: 0,
			depth: 2,
			channels: [
				channel(0x01, 0x02, 0x03, 0x04),
				channel(0x11, 0x12, 0x13, 0x14),
				channel(0x21, 0x22, 0x23, 0x24),
			],
		});
		const layout = readKgLayout(data);
		if (!layout) throw new Error("no layout");
		// Every channel fills its own byte of every pixel in the order it is read - blue first, as the format
		// the reference declares for the picture keeps them - and the flip into the bitmap waits for that.
		expect([...unpackKg(data, layout).pixels]).toEqual([
			0x01, 0x11, 0x21, 0x02, 0x12, 0x22, 0x03, 0x13, 0x23, 0x04, 0x14, 0x24,
		]);
	});

	it("predicts a byte out of the dictionary of the one before it", () => {
		// Four pixels of one channel: two bytes as they are, then a byte out of the dictionary of the first
		// pixel - whose list starts as the eight bytes of its own index - and one byte of its own.
		const data = buildKg({
			width: 4,
			height: 1,
			layout: 0,
			depth: 1,
			channels: [[[8, 0x00], [8, 0x00], ...predicted(5), ...literal(0x09)]],
			palette: buildPalette([]),
		});
		const layout = readKgLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackKg(data, layout).pixels]).toEqual([0, 0, 5, 9]);
	});

	it("copies a run from the place its code names", () => {
		// One byte back - which the code of three names - and then the row behind, whose code is nothing.
		const data = buildKg({
			width: 4,
			height: 2,
			layout: 0,
			depth: 1,
			channels: [
				[
					[8, 0x11],
					[8, 0x22],
					...copyFrom(3, 1),
					...copyFrom(1, 1),
					...copyFrom(0, 1),
					...literal(0x33),
					...literal(0x34),
					...literal(0x44),
				],
			],
			palette: buildPalette([]),
		});
		const layout = readKgLayout(data);
		if (!layout) throw new Error("no layout");
		// The first row copies the byte two places back and then the byte three places back - which at the
		// place it stands at is the row behind; the second row copies that same place, then reads three bytes
		// of their own.
		expect([...unpackKg(data, layout).pixels]).toEqual([
			0x11, 0x22, 0x11, 0x11, 0x11, 0x33, 0x34, 0x44,
		]);
	});

	it("hands an eight bit picture over through its colour map", async () => {
		const palette = buildPalette([
			[0x01, 0x02, 0x03],
			[0x11, 0x22, 0x33],
		]);
		const data = buildKg({
			width: 2,
			height: 1,
			layout: 0,
			depth: 1,
			channels: [
				[
					[8, 0x00],
					[8, 0x01],
				],
			],
			palette,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 2)]).toEqual([0, 1]);
		// The colour map of this engine stands as the file stores it, which a bitmap keeps as it is.
		expect([...bmp.palette.subarray(4, 8)]).toEqual([0x11, 0x22, 0x33, 0x00]);
	});

	it("draws the alpha channel of a picture into the fourth byte of every pixel", async () => {
		const channels: Item[][] = [
			[
				[8, 0x01],
				[8, 0x02],
			],
			[
				[8, 0x11],
				[8, 0x12],
			],
			[
				[8, 0x21],
				[8, 0x22],
			],
		];
		const data = buildKg({
			width: 2,
			height: 1,
			layout: 2,
			depth: 2,
			channels,
			alpha: [
				[8, 0x40],
				[8, 0x80],
			],
			alphaOffset: ALPHA_AT,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(32);
		expect([...bmp.pixels.subarray(0, 8)]).toEqual([
			0x01, 0x11, 0x21, 0x40, 0x02, 0x12, 0x22, 0x80,
		]);

		// A picture whose alpha channel cannot be read is handed over without it, as the reference does.
		const withoutAlpha = buildKg({
			width: 2,
			height: 1,
			layout: 2,
			depth: 2,
			channels,
			alphaOffset: ALPHA_AT + 0x100,
		});
		const plain = readBmpImage(await extract(withoutAlpha));
		if (!plain) throw new Error("no bitmap");
		expect(plain.bitsPerPixel).toBe(32);
		expect([...plain.pixels.subarray(3, 4)]).toEqual([0x00]);
	});

	it("turns away a word, a place and a depth it does not name", async () => {
		const data = buildKg({
			width: 2,
			height: 1,
			layout: 0,
			depth: 1,
			channels: [
				[
					[8, 0x00],
					[8, 0x01],
				],
			],
			palette: buildPalette([]),
		});
		expect(readKgLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			dataOffset: DATA_AT,
		});
		const elsewhere = Buffer.from(data);
		elsewhere.write("XX", 0, "latin1");
		expect(readKgLayout(elsewhere)).toBeUndefined();
		const wrongDepth = Buffer.from(data);
		wrongDepth[3] = 3;
		expect(readKgLayout(wrongDepth)).toBeUndefined();
		const beyond = Buffer.from(data);
		beyond.writeInt32LE(0x10000, 0x10);
		expect(
			await kgImageFormat.detect(new BufferByteSource(beyond), "a.kg"),
		).toBe(false);
		await expect(
			kgImageFormat.open(new BufferByteSource(elsewhere), "a.kg"),
		).rejects.toThrow(GarbroError);
	});
});
