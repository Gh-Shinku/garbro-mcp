// The walk of the places of the second ScrPlayer picture, against streams written off the tables of the
// reference on their own: the fixture looks the code of every place up in the table of the codes and writes
// the places of the entry of it, so the places of the picture are the ones the fixture asks for. The second
// picture of the engine stands apart from the first of its tables in four places, and the walk of the
// places of a code of its own stands of the second table of the codes of it.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { scrPlayerImg2ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	Img2BitStream,
	readImg2Layout,
	unpackImg2Picture,
} from "../../packages/formats/src/scrplayer/i-image.js";
import {
	IMG2_POS_TABLE_24,
	IMG2_POS_TABLE_32,
	IMG2_RESOURCES,
} from "../../packages/formats/src/scrplayer/i-tables.js";
import { IMG_OFFSET_TABLE } from "../../packages/formats/src/scrplayer/img-tables.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The word of every resource of the walk, of the file it was read out of. */
const RESOURCE_WORDS: readonly (readonly [string, number, string])[] = [
	[
		"control1",
		0x4000,
		"a9dbabc113c77650b79959aec2a2263df19b39b1e5d565207cabe933dca3abf5",
	],
	[
		"control2",
		0x4000,
		"5712a36c57f8add1fc4641d477132d22c5ea4d74ace24efd4bb96db30a62fa03",
	],
	[
		"control32",
		0x400,
		"a09d530c406c320824fa2f96738397f99df96ebda4432b25b7c9a4db4d69c9e1",
	],
	[
		"colorBits1",
		0x800,
		"935058f3f82ef7250e359a9afd7ccac9d40370f6abcc3163630b445b9f9dee11",
	],
	[
		"colorBits2",
		0x800,
		"24ba37e1bbde4da5983a67d7783e70e161e6d4070b5ed5b8ecb12fbfcf0638c5",
	],
];

/** The head of the picture: the mark, the box of it and the places of a colour. */
function buildImg2(input: {
	width: number;
	height: number;
	bitsPerPixel: number;
	stream: Buffer;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(0x20, 0);
	head.write(input.mark ?? "IMG2", 0, "latin1");
	head.writeUInt16LE(input.width, 0x0c);
	head.writeUInt16LE(input.height, 0x0e);
	head.writeUInt16LE(input.bitsPerPixel, 0x10);
	return Buffer.concat([head, input.stream]);
}

/** The places of a picture the fixture wrote the stream of, of the walk of the reference. */
const TWO_PLACES = "771c0600";
const ONE_PLACE_32 = "43e38000";
const RUN_PLACES = "771c1a00";
const SECOND_TABLE = "6a7400";

describe("ScrPlayer second picture", () => {
	it("stands of the tables the reference carries", () => {
		// The tables of the walk stand of the five resources of the reference, and the walk of a picture of
		// this project reads them as they came: the word of every one of them is held here so that a table
		// that was read out of the reference wrongly stands out.
		for (const [name, places, word] of RESOURCE_WORDS) {
			const table = IMG2_RESOURCES[name as keyof typeof IMG2_RESOURCES];
			expect(table.length).toBe(places);
			const digest = createHash("sha256").update(table).digest("hex");
			expect(digest).toBe(word);
		}
	});

	it("reads the head of the picture", () => {
		const good = buildImg2({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from(TWO_PLACES, "hex"),
		});
		expect(readImg2Layout(good)?.width).toBe(2);
		expect(readImg2Layout(good)?.height).toBe(1);
		expect(readImg2Layout(good)?.bitsPerPixel).toBe(24);
		// The second picture of the engine stands of a mark of its own and of the same two kinds.
		const otherMark = buildImg2({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.alloc(0),
			mark: "IMG ",
		});
		expect(readImg2Layout(otherMark)).toBeUndefined();
		const otherKind = buildImg2({
			width: 2,
			height: 1,
			bitsPerPixel: 16,
			stream: Buffer.alloc(0),
		});
		expect(readImg2Layout(otherKind)).toBeUndefined();
		const empty = buildImg2({
			width: 0,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.alloc(0),
		});
		expect(readImg2Layout(empty)).toBeUndefined();
		expect(readImg2Layout(good.subarray(0, 0x20 - 1))).toBeUndefined();
	});

	it("reads the codes of the walk of a table", () => {
		// The cache of the walk reads the places of a byte of the stream from the lowest place of it up,
		// where the first picture of the engine reads them from the highest one down, and the place of a
		// code of a table stands of the count of the places of the entry it names.
		expect(new Img2BitStream(Buffer.from([0x01]), 0).peekBits(8)).toBe(0x01);
		expect(new Img2BitStream(Buffer.from([0x80]), 0).peekBits(8)).toBe(0x80);
		expect(new Img2BitStream(Buffer.from([0x80]), 0).peekBits(1)).toBe(0);
		const stream = new Img2BitStream(Buffer.from(TWO_PLACES, "hex"), 0);
		// The code of the first place of the picture: the table of the codes of the places of a picture
		// carries the place of the code zero, of the three colours of it that stand of a difference.
		expect(stream.getBits(IMG2_RESOURCES.control1, 13)).toBe(0);
		// The place of a code within the row stands of six places of the table of the places of a code,
		// where the first picture of the engine stands of five of them, and names the pair (0, 1) of the
		// places of the table the two pictures of the engine stand of.
		const place = stream.getBits(IMG2_POS_TABLE_24, 6);
		expect(place).toBe(1);
		expect(IMG_OFFSET_TABLE[2 * place]).toBe(0);
		expect(IMG_OFFSET_TABLE[2 * place + 1]).toBe(1);
		// A walk that stands past the places of its picture is turned away.
		const short = new Img2BitStream(Buffer.alloc(0), 0);
		expect(() => short.getBits(IMG2_RESOURCES.control1, 13)).toThrow();
	});

	it("walks the places of two pictures of three places a colour", () => {
		// A picture of two places: the first of it of three differences, of the places three, four and five
		// of the table of the places of a difference, which stands three, four and five places below
		// nothing; the second one of a code that names no difference at all, of a row of nothing.
		const data = buildImg2({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from(TWO_PLACES, "hex"),
		});
		const layout = readImg2Layout(data);
		if (!layout) throw new Error("no layout");
		// The walk stands of the places of the picture and of a row of nothing behind them, which the
		// reference builds of its own and never turns out.
		const places = unpackImg2Picture(data, layout);
		expect(places.length).toBe(16);
		expect([...places.subarray(0, 8)]).toEqual([
			0xfb, 0xfc, 0xfd, 0x00, 0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("walks the places of a picture of four places a colour", () => {
		// The same, of the kind of four places a colour: the code of the places of it names the place one
		// of the row and an alpha of its own, so the place of the picture stands of the whole alpha less
		// four places.
		const data = buildImg2({
			width: 1,
			height: 1,
			bitsPerPixel: 32,
			stream: Buffer.from(ONE_PLACE_32, "hex"),
		});
		const layout = readImg2Layout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackImg2Picture(data, layout).subarray(0, 4)]).toEqual([
			0xfb, 0xfc, 0xfd, 0xfb,
		]);
		// The code of the places of a picture of four places a colour stands of the table of the places of
		// a code of its own, of nine places.
		expect([...IMG2_POS_TABLE_32.slice(0, 4)]).toEqual([0, 0, 1, 0]);
	});

	it("walks a code of the places of the picture of the second table of them", () => {
		// The tables of the codes of the places of the picture carry the places of a code up to 0xB8 alone,
		// so a code of 0xD8 and above - a code of the places of the picture as they stand - stands of the
		// second table behind that one: here a code of 0xD9, of three places of their own, over a row of
		// nothing.
		const data = buildImg2({
			width: 4,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from(RUN_PLACES, "hex"),
		});
		const layout = readImg2Layout(data);
		if (!layout) throw new Error("no layout");
		const places = unpackImg2Picture(data, layout);
		expect([...places.subarray(0, 16)]).toEqual([
			0xfb, 0xfc, 0xfd, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("walks a place of a colour of the code of the second table", () => {
		// The same table, of a place of a colour: the code of the places of the picture stands of the place
		// 0xB8 of the first table and of the place zero of the second one, so the place of the picture
		// stands of the places one, a difference and two of the tables of the colours of a code.
		const data = buildImg2({
			width: 1,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from(SECOND_TABLE, "hex"),
		});
		const layout = readImg2Layout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackImg2Picture(data, layout).subarray(0, 4)]).toEqual([
			0xff, 0xfd, 0xfe, 0x00,
		]);
	});

	it("reads the picture through the format", async () => {
		const data = buildImg2({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from(TWO_PLACES, "hex"),
		});
		const source = new BufferByteSource(data);
		expect(await scrPlayerImg2ImageFormat.detect(source)).toBe(true);
		const handle = await scrPlayerImg2ImageFormat.open(source, "sample.i");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("image.bmp");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([0xfb, 0xfc, 0xfd, 0x00, 0x00, 0x00]);
	});

	it("reads the picture of four places a colour through the format", async () => {
		const data = buildImg2({
			width: 1,
			height: 1,
			bitsPerPixel: 32,
			stream: Buffer.from(ONE_PLACE_32, "hex"),
		});
		const source = new BufferByteSource(data);
		expect(await scrPlayerImg2ImageFormat.detect(source)).toBe(true);
		const handle = await scrPlayerImg2ImageFormat.open(source, "sample.i");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readUInt16LE(28)).toBe(32);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([0xfb, 0xfc, 0xfd, 0xfb]);
	});
});
