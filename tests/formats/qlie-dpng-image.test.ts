// The composition of a tiled QLIE picture, against portable network graphics written by hand: the tiles of
// the fixture are graphics of the places this test asks for, so the places of the picture are the ones the
// fixture names rather than a recording of what the composition did.
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { crc32 } from "@garbro-mcp/codecs";
import { qlieDpngImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	compositeDpngPicture,
	readDpngLayout,
	readDpngTiles,
} from "../../packages/formats/src/qlie/dpng-image.js";
import { PNG_SIGNATURE } from "../../packages/formats/src/shared/png.js";

/** One chunk of a portable network graphic: its count, its kind, the places of it and its own word. */
function chunk(kind: string, body: Buffer): Buffer {
	const length = Buffer.alloc(4, 0);
	length.writeUInt32BE(body.length, 0);
	const named = Buffer.concat([Buffer.from(kind, "latin1"), body]);
	const crc = Buffer.alloc(4, 0);
	crc.writeUInt32BE(crc32(named), 0);
	return Buffer.concat([length, named, crc]);
}

/** A portable network graphic of the rows of places this test asks for, of no walk of its own. */
function pngFile(input: {
	width: number;
	height: number;
	colourType: number;
	rows: readonly (readonly number[])[];
}): Buffer {
	const head = Buffer.alloc(13, 0);
	head.writeUInt32BE(input.width, 0);
	head.writeUInt32BE(input.height, 4);
	head[8] = 8;
	head[9] = input.colourType;
	const places: Buffer[] = [];
	for (const row of input.rows) places.push(Buffer.from([0, ...row]));
	const body = deflateSync(Buffer.concat(places));
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", head),
		chunk("IDAT", body),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** A graph of four places of two by two places, of the places of its own. */
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

/** The picture of the engine: the count of the tiles, the box and the tiles of it. */
function buildDpng(input: {
	tiles: readonly {
		x: number;
		y: number;
		width: number;
		height: number;
		png?: Buffer;
	}[];
	width: number;
	height: number;
}): Buffer {
	const head = Buffer.alloc(0x14, 0);
	head.write("DPNG", 0, "latin1");
	head.writeInt32LE(input.tiles.length, 8);
	head.writeUInt32LE(input.width, 0x0c);
	head.writeUInt32LE(input.height, 0x10);
	const parts: Buffer[] = [head];
	for (const tile of input.tiles) {
		const tileHead = Buffer.alloc(0x1c, 0);
		tileHead.writeInt32LE(tile.x, 0);
		tileHead.writeInt32LE(tile.y, 4);
		tileHead.writeInt32LE(tile.width, 8);
		tileHead.writeInt32LE(tile.height, 0x0c);
		tileHead.writeUInt32LE(tile.png?.length ?? 0, 0x10);
		parts.push(tileHead);
		if (tile.png) parts.push(tile.png);
	}
	return Buffer.concat(parts);
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

describe("QLIE tiled PNG picture", () => {
	it("reads the count of the tiles and the box of the picture", () => {
		const data = buildDpng({
			tiles: [{ x: 0, y: 0, width: 2, height: 2, png: tileA() }],
			width: 4,
			height: 3,
		});
		expect(readDpngLayout(data)).toEqual({
			tileCount: 1,
			width: 4,
			height: 3,
		});
		const tiles = readDpngTiles(data, { tileCount: 1, width: 4, height: 3 });
		expect(tiles.length).toBe(1);
		expect(tiles[0]?.x).toBe(0);
		expect(tiles[0]?.y).toBe(0);
		expect(tiles[0]?.width).toBe(2);
		expect(tiles[0]?.height).toBe(2);
		expect(tiles[0]?.offset).toBe(0x14 + 0x1c);
	});

	it("turns away what is not one of its pictures", () => {
		const good = buildDpng({
			tiles: [{ x: 0, y: 0, width: 2, height: 2, png: tileA() }],
			width: 4,
			height: 3,
		});
		expect(readDpngLayout(good)).toBeDefined();
		const noTiles = Buffer.from(good);
		noTiles.writeInt32LE(0, 8);
		expect(readDpngLayout(noTiles)).toBeUndefined();
		const noBox = Buffer.from(good);
		noBox.writeUInt32LE(0, 0x0c);
		expect(readDpngLayout(noBox)).toBeUndefined();
		const otherMark = Buffer.from(good);
		otherMark.write("PNGD", 0, "latin1");
		expect(readDpngLayout(otherMark)).toBeUndefined();
		expect(readDpngLayout(good.subarray(0, 0x10))).toBeUndefined();
	});

	it("lays the tiles of the picture down at the places they name", async () => {
		const data = buildDpng({
			tiles: [
				{ x: 0, y: 0, width: 2, height: 2, png: tileA() },
				{ x: 2, y: 1, width: 2, height: 2, png: tileB() },
			],
			width: 4,
			height: 3,
		});
		const layout = readDpngLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = await compositeDpngPicture(data, layout);
		expect([...pixels]).toEqual(
			bgra(
				// The graph of the first tile stands of four places, of an alpha of its own: the places of
				// the memory of a picture of it are blue, green, red and the alpha.
				[3, 2, 1, 4],
				[7, 6, 5, 8],
				NONE,
				NONE,
				[11, 10, 9, 12],
				[15, 14, 13, 16],
				// The second tile stands of three places, of the full alpha the composition adds to it.
				[0x22, 0x21, 0x20, 0xff],
				[0x25, 0x24, 0x23, 0xff],
				NONE,
				NONE,
				[0x28, 0x27, 0x26, 0xff],
				[0x2b, 0x2a, 0x29, 0xff],
			),
		);
	});

	it("passes a tile that names no places over and holds the ones that stand past the picture", async () => {
		const data = buildDpng({
			tiles: [
				{ x: 0, y: 0, width: 0, height: 0 },
				{ x: 3, y: 2, width: 2, height: 2, png: tileA() },
			],
			width: 4,
			height: 3,
		});
		const layout = readDpngLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = await compositeDpngPicture(data, layout);
		// The tile of no places names none, and the corner of the last one is held to the picture.
		expect(pixels.length).toBe(48);
		expect([...pixels.subarray(44)]).toEqual([3, 2, 1, 4]);
		expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
	});

	it("reads the picture through the format", async () => {
		const data = buildDpng({
			tiles: [
				{ x: 0, y: 0, width: 2, height: 2, png: tileA() },
				{ x: 2, y: 1, width: 2, height: 2, png: tileB() },
			],
			width: 4,
			height: 3,
		});
		const handle = await qlieDpngImageFormat.open(
			new BufferByteSource(data),
			"sample.png",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(4);
		expect(bmp.readInt32LE(22)).toBe(-3);
		expect(bmp.readUInt16LE(28)).toBe(32);
		// Every row of four places stands of four places a place and of nothing behind it.
		expect([...bmp.subarray(0x36, 0x46)]).toEqual(
			bgra([3, 2, 1, 4], [7, 6, 5, 8], NONE, NONE),
		);
	});
});
