import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	czImageFormat,
	readCzLayout,
	unpackCz,
} from "../../packages/formats/src/key/cz-image.js";

const HEADER = 0x10;
const WIDE_HEADER = 0x1c;
const PALETTE_SIZE = 0x400;
const PART_TABLE_ENTRY = 8;

/** One pair of a part: a byte, and the control that says whether it stands for a copy. */
function literal(value: number): Buffer {
	return Buffer.from([value, 0x00]);
}

/** A pair that names the range standing at a byte of the part, counted from 0x101 in whole pairs. */
function copy(from: number): Buffer {
	const word = from / 2 + 0x101;
	return Buffer.from([word & 0xff, word >> 8]);
}

/**
 * A picture of this engine: the head - which says where it ends - the colour map of an eight bit one, then
 * either the pixels as they stand or a table of parts with their bytes behind it.
 */
function buildCz(options: {
	version: number;
	width: number;
	height: number;
	bits: number;
	stored?: Buffer;
	parts?: readonly Buffer[];
	palette?: Buffer;
	wide?: boolean;
}): Buffer {
	const headerLength = options.wide ? WIDE_HEADER : HEADER;
	const parts = options.parts ?? [];
	const table = Buffer.alloc(4 + parts.length * PART_TABLE_ENTRY, 0x00);
	table.writeInt32LE(parts.length, 0);
	for (const [number, part] of parts.entries()) {
		// The stored length of a part is written in whole pairs.
		table.writeInt32LE(part.length / 2, 4 + number * PART_TABLE_ENTRY);
		table.writeInt32LE(part.length, 8 + number * PART_TABLE_ENTRY);
	}
	const head = Buffer.alloc(headerLength, 0x00);
	head.write(`CZ${options.version}`, 0, "latin1");
	head.writeUInt32LE(headerLength, 4);
	head.writeUInt16LE(options.width, 8);
	head.writeUInt16LE(options.height, 0x0a);
	head.writeUInt16LE(options.bits, 0x0c);
	if (options.wide) {
		head.writeInt16LE(-4, 0x10);
		head.writeInt16LE(7, 0x12);
	}
	const pieces: Buffer[] = [head];
	if (options.palette) pieces.push(options.palette);
	if (options.stored) pieces.push(options.stored);
	if (parts.length > 0) pieces.push(table, ...parts);
	return Buffer.concat(pieces);
}

/** A colour map as the file stores it, four bytes to a colour, red first. */
function buildPalette(colours: readonly [number, number, number][]): Buffer {
	const palette = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (const [index, colour] of colours.entries()) {
		palette[index * 4] = colour[0];
		palette[index * 4 + 1] = colour[1];
		palette[index * 4 + 2] = colour[2];
		palette[index * 4 + 3] = 0xff;
	}
	return palette;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await czImageFormat.open(
		new BufferByteSource(data),
		"picture.cz1",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Key compressed image", () => {
	it("hands the oldest version over as it stands, with its colour map", async () => {
		const palette = buildPalette([
			[0x01, 0x02, 0x03],
			[0x11, 0x22, 0x33],
		]);
		const data = buildCz({
			version: 0,
			width: 2,
			height: 1,
			bits: 8,
			stored: Buffer.from([0, 1]),
			palette,
			wide: true,
		});
		expect(readCzLayout(data)).toMatchObject({
			version: 0,
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			headerLength: WIDE_HEADER,
			offsetX: -4,
			offsetY: 7,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 2)]).toEqual([0, 1]);
		// The colour the file stores red first reaches the bitmap blue first.
		expect([...bmp.palette.subarray(4, 8)]).toEqual([0x33, 0x22, 0x11, 0xff]);
	});

	it("draws a part of bytes that stand as they are", () => {
		// Two pairs of a byte each, and a picture of two bytes to the pixel.
		const data = buildCz({
			version: 1,
			width: 1,
			height: 1,
			bits: 32,
			parts: [Buffer.concat([literal(0x41), literal(0x42)])],
		});
		const layout = readCzLayout(data);
		if (!layout) throw new Error("no layout");
		// The picture is stored red first and a bitmap keeps blue first, so the first and the third byte of
		// every pixel are exchanged - which for two bytes that stand as they are leaves the pixel as it is.
		expect([...unpackCz(data, layout).pixels]).toEqual([
			0x00, 0x42, 0x41, 0x00,
		]);
	});

	it("copies the range a pair names, and remembers what a range drew", () => {
		// Four bytes that stand as they are, then a pair that copies the range standing at the very front of
		// the part, and a second pair that copies the same range - which the remembered one hands over again.
		const part = Buffer.concat([
			literal(0x01),
			literal(0x02),
			literal(0x03),
			literal(0x04),
			copy(0),
			copy(0),
		]);
		const data = buildCz({
			version: 1,
			width: 2,
			height: 1,
			bits: 32,
			parts: [part],
		});
		const layout = readCzLayout(data);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackCz(data, layout);
		// Eight bytes: the four of the part itself and the four the two copies drew, red and blue exchanged.
		expect([...pixels]).toEqual([
			0x03, 0x02, 0x01, 0x04, 0x01, 0x02, 0x01, 0x02,
		]);
	});

	it("follows a copy whose range is itself a copy", () => {
		// Two bytes stand as they are, then a pair copies that range, and a pair behind it copies **that**
		// one: drawing the last of them takes a walk of two copies and the byte the chain ends at.
		const data = buildCz({
			version: 1,
			width: 2,
			height: 1,
			bits: 32,
			parts: [Buffer.concat([literal(0x31), literal(0x42), copy(0), copy(4)])],
		});
		const layout = readCzLayout(data);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackCz(data, layout);
		// One byte of its own, one behind it, then the two of the first copy and the three of the copy of it.
		expect([...pixels]).toEqual([
			0x31, 0x42, 0x31, 0x42, 0x31, 0x42, 0x31, 0x00,
		]);
	});

	it("adds the rows of the third and the second version", () => {
		// Six rows, so every second row is a key row of the picture's own: the two versions add the rest to
		// the row behind them, one byte at a time and one whole word at a time.
		const bytes = buildCz({
			version: 3,
			width: 1,
			height: 6,
			bits: 8,
			parts: [
				Buffer.concat([
					literal(0x01),
					literal(0x02),
					literal(0x03),
					literal(0x04),
					literal(0x05),
					literal(0x06),
				]),
			],
			palette: Buffer.alloc(PALETTE_SIZE, 0x00),
		});
		const byteLayout = readCzLayout(bytes);
		if (!byteLayout) throw new Error("no layout");
		// Every second row carries the row behind it added on, a byte at a time.
		expect([...unpackCz(bytes, byteLayout).pixels]).toEqual([
			0x01, 0x03, 0x03, 0x07, 0x05, 0x0b,
		]);

		// The same rows of a picture of thirty two bits, where the whole word is added rather than every
		// byte: the sum of the first two rows carries out of the word and is lost, which a byte at a time
		// would have left behind in the second byte.
		const word = (values: readonly number[]): Buffer =>
			Buffer.concat(values.map((value) => literal(value)));
		const words = buildCz({
			version: 2,
			width: 1,
			height: 6,
			bits: 32,
			parts: [
				Buffer.concat([
					word([0xff, 0xff, 0xff, 0xff]),
					word([0x02, 0x00, 0x00, 0x00]),
					word([0x01, 0x00, 0x00, 0x00]),
					word([0x00, 0x00, 0x00, 0x00]),
					word([0x00, 0x00, 0x00, 0x10]),
					word([0x01, 0x00, 0x00, 0x00]),
				]),
			],
		});
		const wordLayout = readCzLayout(words);
		if (!wordLayout) throw new Error("no layout");
		const worded = unpackCz(words, wordLayout).pixels;
		// The first two rows of the picture stand as the two words make them, the carry lost.
		expect([...worded.subarray(0, 4)]).toEqual([0xff, 0xff, 0xff, 0xff]);
		expect([...worded.subarray(4, 8)]).toEqual([0x00, 0x00, 0x01, 0x00]);
		expect([...worded.subarray(8, 12)]).toEqual([0x00, 0x00, 0x01, 0x00]);
		expect([...worded.subarray(12, 16)]).toEqual([0x00, 0x00, 0x01, 0x00]);
		expect([...worded.subarray(16, 20)]).toEqual([0x00, 0x00, 0x00, 0x10]);
		expect([...worded.subarray(20, 24)]).toEqual([0x00, 0x00, 0x01, 0x10]);
	});

	it("turns away a depth the reference cannot draw, and a part table that reaches past it", async () => {
		const twentyFour = buildCz({
			version: 1,
			width: 1,
			height: 1,
			bits: 24,
			parts: [Buffer.concat([literal(1), literal(2)])],
		});
		// The head is read, since the reference reads it too; the picture behind it is what is refused.
		expect(readCzLayout(twentyFour)?.bitsPerPixel).toBe(24);
		await expect(extract(twentyFour)).rejects.toThrow(/thirty two bit/);

		const parts = buildCz({
			version: 1,
			width: 4,
			height: 1,
			bits: 32,
			parts: [Buffer.concat([literal(1), literal(2), literal(3), literal(4)])],
		});
		// The table says the part is twice as long as the file holds.
		parts.writeInt32LE(0x100, 4);
		await expect(extract(parts)).rejects.toThrow(GarbroError);
	});

	it("turns away a word it does not know and a copy that names no range", async () => {
		const unknown = buildCz({
			version: 1,
			width: 1,
			height: 1,
			bits: 32,
			parts: [Buffer.concat([literal(1), literal(2)])],
		});
		unknown.write("XX1", 0, "latin1");
		expect(readCzLayout(unknown)).toBeUndefined();
		expect(
			await czImageFormat.detect(new BufferByteSource(unknown), "a.cz1"),
		).toBe(false);

		// A pair whose place stands before the part it was read from.
		const outside = buildCz({
			version: 1,
			width: 2,
			height: 1,
			bits: 32,
			// The last pair stands a couple of bytes before the part: its place is outside it.
			parts: [
				Buffer.concat([literal(1), literal(2), Buffer.from([0x00, 0x01])]),
			],
		});
		await expect(extract(outside)).rejects.toThrow(GarbroError);
	});
});
