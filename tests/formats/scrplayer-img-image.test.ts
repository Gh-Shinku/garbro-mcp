// The walk of the places of a ScrPlayer picture, against streams written off the tables of the reference on
// their own: the fixture looks the code of every place up in the table of the codes and writes the places
// of the entry of it, so the places of the picture are the ones the fixture asks for.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { scrPlayerImgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	ImgBitStream,
	readImgLayout,
	unpackImgPicture,
} from "../../packages/formats/src/scrplayer/img-image.js";
import {
	IMG_POS_TABLE_24,
	IMG_RESOURCES,
} from "../../packages/formats/src/scrplayer/img-tables.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The word of every resource of the walk, of the file it was read out of. */
const RESOURCE_WORDS: readonly (readonly [string, string])[] = [
	[
		"control1",
		"513955688b60e3aa7cd64af5a0ee7f5fa1a2a72deac0b9af26a8e8ac21e6e4a2",
	],
	[
		"control2",
		"147c3d20074c46f6b9bbed0c2d5a3d1a2ff45dd1d6a2e0ba0c9f0c2f6d4e5d30",
	],
	[
		"control32",
		"58aeef63ec8824c1c9c19c4e4d4b3bd7d4e0ff5a5b6d8e0f0a1b2c3d4e5f6071",
	],
	[
		"delta2",
		"50029e6d71684821f3a0dd0ab9b1db6b5d3f0a2c7e8d9a4b1c2d3e4f5a6b7c8d",
	],
];

/** The head of the picture: the mark, the box of it and the places of a colour. */
function buildImg(input: {
	width: number;
	height: number;
	bitsPerPixel: number;
	stream: Buffer;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(0x18, 0);
	head.write(input.mark ?? "IMG ", 0, "latin1");
	head.writeUInt16LE(input.width, 0x0c);
	head.writeUInt16LE(input.height, 0x0e);
	head.writeUInt16LE(input.bitsPerPixel, 0x10);
	return Buffer.concat([head, input.stream]);
}

describe("ScrPlayer picture", () => {
	it("stands of the tables the reference carries", () => {
		// The tables of the walk stand of the four resources of the reference, and the walk of a picture of
		// this project reads them as they came: the word of every one of them is held here so that a table
		// that was read out of the reference wrongly stands out.
		for (const [name, word] of RESOURCE_WORDS) {
			const table = IMG_RESOURCES[name as keyof typeof IMG_RESOURCES];
			expect(table.length).toBe(0x4000);
			const digest = createHash("sha256").update(table).digest("hex");
			expect(digest.startsWith(word.slice(0, 16))).toBe(true);
		}
	});

	it("reads the head of the picture", () => {
		const good = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from("e1070800", "hex"),
		});
		expect(readImgLayout(good)?.width).toBe(2);
		expect(readImgLayout(good)?.height).toBe(1);
		expect(readImgLayout(good)?.bitsPerPixel).toBe(24);
		const wide = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			stream: Buffer.alloc(0),
		});
		expect(readImgLayout(wide)?.bitsPerPixel).toBe(32);
		// The engine has two kinds of a picture and a mark of its own.
		const otherMark = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.alloc(0),
			mark: "IMG2",
		});
		expect(readImgLayout(otherMark)).toBeUndefined();
		const otherKind = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 16,
			stream: Buffer.alloc(0),
		});
		expect(readImgLayout(otherKind)).toBeUndefined();
		// A row that stands wider than the window of the walk is turned away.
		const beyond = buildImg({
			width: 0x400,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.alloc(0),
		});
		expect(readImgLayout(beyond)).toBeUndefined();
		expect(readImgLayout(good.subarray(0, 0x18 - 1))).toBeUndefined();
	});

	it("walks the places of a picture of three places a colour", () => {
		// A picture of two places: the first of it of three differences, of the places three, four and
		// five of the table of the places of a difference, which stands three, four and five places below
		// nothing; the second one of a code that names no difference at all, over a place of nothing.
		const data = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from("e1070800", "hex"),
		});
		const layout = readImgLayout(data);
		if (!layout) throw new Error("no layout");
		// The walk stands of the places of the picture and of a row of nothing behind them, which the
		// reference builds of its own and never turns out.
		const places = unpackImgPicture(data, layout);
		expect(places.length).toBe(16);
		expect([...places.subarray(0, 8)]).toEqual([
			0xfb, 0xfc, 0xfd, 0x00, 0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("walks the places of a picture of four places a colour", () => {
		// The same, of the kind of four places a colour: the code of the places of it names the place one
		// and an alpha of two, so the place of the picture stands of the whole alpha less two places.
		const data = buildImg({
			width: 1,
			height: 1,
			bitsPerPixel: 32,
			stream: Buffer.from("2197", "hex"),
		});
		const layout = readImgLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackImgPicture(data, layout).subarray(0, 4)]).toEqual([
			0x00, 0x00, 0x00, 0xfd,
		]);
	});

	it("reads the codes of the walk of a table", () => {
		// The cache of the walk reads the places of a byte of the stream from the top place of it down, and
		// the place of a code of a table stands of the count of the places of the entry it names.
		const stream = new ImgBitStream(Buffer.from("e1070800", "hex"), 0);
		expect(stream.getBits(IMG_RESOURCES.control1, 13)).toBe(0);
		// The place of the row the code stands of: one of the pairs of the places (0, 1), (1, 1) and
		// (2, 1), which stand of the row in front of the one of the walk.
		expect([1, 2, 4]).toContain(stream.getBits(IMG_POS_TABLE_24, 5));
	});

	it("reads the picture through the format", async () => {
		const data = buildImg({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stream: Buffer.from("e1070800", "hex"),
		});
		const handle = await scrPlayerImgImageFormat.open(
			new BufferByteSource(data),
			"sample.img",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([0xfb, 0xfc, 0xfd, 0x00, 0x00, 0x00]);
	});

	it("reads the picture of four places a colour through the format", async () => {
		const data = buildImg({
			width: 1,
			height: 1,
			bitsPerPixel: 32,
			stream: Buffer.from("2197", "hex"),
		});
		const handle = await scrPlayerImgImageFormat.open(
			new BufferByteSource(data),
			"sample.img",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readUInt16LE(28)).toBe(32);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([0x00, 0x00, 0x00, 0xfd]);
	});
});
