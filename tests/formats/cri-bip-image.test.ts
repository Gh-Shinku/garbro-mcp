// The composition of a tiled PS2 bitmap, against portable network graphics written by hand: the tiles of
// the fixture are the graphics this test asks for, so the places of the picture are the ones the fixture
// names rather than a recording of what the composition did.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { criBipImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	compositeBipPicture,
	readBipLayout,
} from "../../packages/formats/src/cri/bip-image.js";
import { pngFile } from "../helpers/png.js";

/** A graph of four places of two by two places, of an alpha of its own. */
function tileA(): Buffer {
	return pngFile({
		width: 2,
		height: 2,
		colourType: 6,
		rows: [
			[1, 2, 3, 4, 5, 6, 7, 8],
			[9, 10, 11, 12, 13, 14, 15, 16],
		],
	});
}

/** A graph of three places of two by two places, of no alpha of its own. */
function tileB(): Buffer {
	return pngFile({
		width: 2,
		height: 2,
		colourType: 2,
		rows: [
			[0x20, 0x21, 0x22, 0x23, 0x24, 0x25],
			[0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b],
		],
	});
}

/** The head of the stream of a tile: the mark, the count of the stream and the kinds of it. */
function tileStream(
	png: Buffer,
	input: { alpha: number; x: number; y: number },
): Buffer {
	const head = Buffer.alloc(0x7c, 0);
	head.write("PNGFILE2", 0, "latin1");
	head.writeInt32LE(0x7c + png.length, 0x18);
	head.writeInt32LE(input.alpha, 0x68);
	head.writeInt32LE(input.x, 0x6c);
	head.writeInt32LE(input.y, 0x70);
	return Buffer.concat([head, png]);
}

/** A picture of the engine: the head, the list of the tiles and the streams of them. */
function buildBip(input: {
	kind?: number;
	tiles: readonly {
		left: number;
		top: number;
		width: number;
		height: number;
		stream: Buffer;
	}[];
	width: number;
	height: number;
	flag?: number;
	count?: number;
	indexOffset?: number;
}): Buffer {
	const kind = input.kind ?? 5;
	const headerEnd = kind * 4;
	const indexOffset = input.indexOffset ?? headerEnd;
	const boxAt = indexOffset + 2 + 2 + 4;
	const listEnd = boxAt + 4 + input.tiles.length * 0x1c;
	const dataOffset = listEnd;
	const head = Buffer.alloc(headerEnd, 0);
	head.writeInt32LE(kind, 0);
	head.writeUInt32LE(indexOffset, 4);
	head.writeUInt32LE(dataOffset - 8, headerEnd - 4);
	const index = Buffer.alloc(listEnd - indexOffset, 0);
	index.writeInt16LE(input.count ?? input.tiles.length, 0);
	index.writeInt16LE(input.flag ?? 0, 2);
	index.writeUInt16LE(input.width, boxAt - indexOffset);
	index.writeUInt16LE(input.height, boxAt - indexOffset + 2);
	input.tiles.forEach((tile, at) => {
		const base = boxAt - indexOffset + 4 + at * 0x1c;
		index.writeUInt16LE(tile.left, base + 8);
		index.writeUInt16LE(tile.top, base + 10);
		index.writeUInt16LE(tile.width, base + 0x10);
		index.writeUInt16LE(tile.height, base + 0x12);
		index.writeUInt32LE(0, base + 0x18);
	});
	const streams: Buffer[] = [];
	let at = 0;
	input.tiles.forEach((tile, which) => {
		index.writeUInt32LE(at, boxAt - indexOffset + 4 + which * 0x1c + 0x18);
		streams.push(tile.stream);
		at += tile.stream.length;
	});
	return Buffer.concat([head, index, ...streams]);
}

/** The places of a picture of four places, as the test asks for them. */
function bgra(
	...places: readonly (readonly [number, number, number, number])[]
): number[] {
	const out: number[] = [];
	for (const [b, g, r, a] of places) out.push(b, g, r, a);
	return out;
}

const NONE = [0, 0, 0, 0] as const;

describe("PS2 tiled bitmap", () => {
	it("reads the head of the picture and the list of its tiles", () => {
		const data = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 4,
			height: 3,
		});
		const layout = readBipLayout(data);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(3);
		expect(layout?.tiles.length).toBe(1);
		expect(layout?.tiles[0]?.left).toBe(0);
		expect(layout?.tiles[0]?.width).toBe(2);
		expect(layout?.tiles[0]?.offset).toBe(0x14 + 0x08 + 0x04 + 0x1c);
	});

	it("grows the box of the picture to hold the tiles that stand past it", () => {
		// The reference reads the box of the list and widens it as it reads the tiles: the box of the head
		// stands behind the places of every tile of it.
		const data = buildBip({
			tiles: [
				{
					left: 2,
					top: 1,
					width: 2,
					height: 2,
					stream: tileStream(tileB(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 2,
			height: 2,
		});
		const layout = readBipLayout(data);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(3);
	});

	it("turns away what is not one of its pictures", () => {
		const good = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 4,
			height: 3,
		});
		expect(readBipLayout(good)).toBeDefined();
		// The head stands of five words or of ten of them.
		const badKind = Buffer.from(good);
		badKind.writeInt32LE(4, 0);
		expect(readBipLayout(badKind)).toBeUndefined();
		// The list of the tiles stands behind the head and in front of the places of them.
		const badIndex = Buffer.from(good);
		badIndex.writeUInt32LE(0x40, 4);
		expect(readBipLayout(badIndex)).toBeUndefined();
		const flag = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 4,
			height: 3,
			flag: 1,
		});
		expect(readBipLayout(flag)).toBeUndefined();
		const noTiles = buildBip({ tiles: [], width: 4, height: 3, count: 0 });
		expect(readBipLayout(noTiles)).toBeUndefined();
		const noBox = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 0,
			height: 3,
		});
		expect(readBipLayout(noBox)).toBeUndefined();
		expect(readBipLayout(good.subarray(0, 3))).toBeUndefined();
	});

	it("lays the graphics of the tiles down at the places they name", async () => {
		const data = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
				{
					left: 2,
					top: 1,
					width: 2,
					height: 2,
					stream: tileStream(tileB(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 4,
			height: 3,
		});
		const layout = readBipLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = await compositeBipPicture(data, layout);
		expect([...pixels]).toEqual(
			bgra(
				// The head of the tile names no alpha, so every place of the graphic stands of a full one.
				[3, 2, 1, 0xff],
				[7, 6, 5, 0xff],
				NONE,
				NONE,
				[11, 10, 9, 0xff],
				[15, 14, 13, 0xff],
				[0x22, 0x21, 0x20, 0xff],
				[0x25, 0x24, 0x23, 0xff],
				NONE,
				NONE,
				[0x28, 0x27, 0x26, 0xff],
				[0x2b, 0x2a, 0x29, 0xff],
			),
		);
	});

	it("stands of the alpha of the graphic where the head of the tile names one", async () => {
		// The alpha of a place of the graphic stands of a place of one hundred and twenty eight of the
		// place of two hundred and fifty five, so four stands at seven, eight at fifteen, twelve at twenty
		// three and sixteen at thirty one.
		const data = buildBip({
			tiles: [
				{
					left: 1,
					top: 1,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 1, x: 0, y: 1 }),
				},
			],
			width: 4,
			height: 4,
		});
		const layout = readBipLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = await compositeBipPicture(data, layout);
		// The place of the tile within its own box stands at one behind that of the tile itself.
		expect([...pixels.subarray(0, 16)]).toEqual([
			...bgra(NONE, NONE, NONE, NONE),
		]);
		expect([...pixels.subarray(32, 48)]).toEqual([
			...bgra(NONE, [3, 2, 1, 7], [7, 6, 5, 15], NONE),
		]);
		expect([...pixels.subarray(48, 64)]).toEqual([
			...bgra(NONE, [11, 10, 9, 23], [15, 14, 13, 31], NONE),
		]);
	});

	it("turns away a tile whose stream is no graphic of its kind", async () => {
		const data = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: Buffer.alloc(0x7c, 0),
				},
			],
			width: 4,
			height: 3,
		});
		const layout = readBipLayout(data);
		if (!layout) throw new Error("no layout");
		await expect(compositeBipPicture(data, layout)).rejects.toThrow(
			"no kind of its own",
		);
	});

	it("reads the picture through the format", async () => {
		const data = buildBip({
			tiles: [
				{
					left: 0,
					top: 0,
					width: 2,
					height: 2,
					stream: tileStream(tileA(), { alpha: 0, x: 0, y: 0 }),
				},
			],
			width: 4,
			height: 3,
		});
		const handle = await criBipImageFormat.open(
			new BufferByteSource(data),
			"sample.bip",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(4);
		expect(bmp.readInt32LE(22)).toBe(-3);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect([...bmp.subarray(0x36, 0x46)]).toEqual(
			bgra([3, 2, 1, 0xff], [7, 6, 5, 0xff], NONE, NONE),
		);
	});
});
