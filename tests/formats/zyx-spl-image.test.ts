import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readSplLayout,
	unpackSpl,
	zyxSplImageFormat,
} from "../../packages/formats/src/zyx/spl-image.js";

interface Tile {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A file: the count of tiles, the tiles themselves, the measurements and then the walk. */
function splFile(
	width: number,
	height: number,
	stream: Buffer,
	tiles: Tile[] = [],
): Buffer {
	const head = Buffer.alloc(2 + tiles.length * 8 + 4);
	head.writeInt16LE(tiles.length, 0);
	tiles.forEach((tile, index) => {
		const at = 2 + index * 8;
		head.writeInt16LE(tile.left, at);
		head.writeInt16LE(tile.top, at + 2);
		head.writeInt16LE(tile.right, at + 4);
		head.writeInt16LE(tile.bottom, at + 6);
	});
	const at = 2 + tiles.length * 8;
	head.writeInt16LE(width, at);
	head.writeInt16LE(height, at + 2);
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await zyxSplImageFormat.open(
		new BufferByteSource(data),
		"pic.spl",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** Two pixels that stand in the stream themselves, then the first one copied from two pixels behind. */
const TWO_BY_TWO = Buffer.from([
	6, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 4, 0x02, 0x00, 0, 0x01,
]);

describe("Zyx tiled picture", () => {
	it("uses its extension to guard the signatureless layout", () => {
		expect(zyxSplImageFormat.descriptor.extensions).toEqual(["spl"]);
		expect(zyxSplImageFormat.detection?.extensionOnly).toBe(true);
	});

	it("reads a head of tiles and measurements", () => {
		const layout = readSplLayout(
			splFile(4, 1, TWO_BY_TWO, [
				{ left: 0, top: 0, right: 2, bottom: 1 },
				{ left: 2, top: 0, right: 4, bottom: 1 },
			]),
		);
		expect(layout).toEqual({
			width: 4,
			height: 1,
			tiles: [
				{ left: 0, top: 0, right: 2, bottom: 1 },
				{ left: 2, top: 0, right: 4, bottom: 1 },
			],
			dataOffset: 2 + 2 * 8 + 4,
		});
	});

	it("declines a head that does not describe a picture", () => {
		const base = splFile(4, 1, TWO_BY_TWO);
		expect(readSplLayout(base)).toBeDefined();
		// Too many tiles.
		const many = Buffer.from(base);
		many.writeInt16LE(0x101, 0);
		expect(readSplLayout(many)).toBeUndefined();
		// A negative count of tiles.
		const negative = Buffer.from(base);
		negative.writeInt16LE(-1, 0);
		expect(readSplLayout(negative)).toBeUndefined();
		// A tile whose right edge does not stand behind its left one.
		const flat = splFile(4, 1, TWO_BY_TWO, [
			{ left: 2, top: 0, right: 2, bottom: 1 },
		]);
		expect(readSplLayout(flat)).toBeUndefined();
		// A tile that reaches outside the picture.
		const outside = splFile(4, 1, TWO_BY_TWO, [
			{ left: 0, top: 0, right: 8, bottom: 1 },
		]);
		expect(readSplLayout(outside)).toBeUndefined();
		// A picture of no size.
		const empty = Buffer.from(base);
		empty.writeInt16LE(0, 4);
		expect(readSplLayout(empty)).toBeUndefined();
	});

	it("reports the measurements and the tiles", async () => {
		const data = splFile(2, 2, TWO_BY_TWO, [
			{ left: 0, top: 0, right: 2, bottom: 1 },
		]);
		const handle = await zyxSplImageFormat.open(
			new BufferByteSource(data),
			"dir/pic.spl",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			tiles: [{ left: 0, top: 0, right: 2, bottom: 1 }],
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
		});
	});

	it("writes the picture out again twenty four bits a pixel", async () => {
		const out = await extract(splFile(2, 2, TWO_BY_TWO));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(2);
		// The rows stand the right way up.
		expect(out.readInt32LE(0x16)).toBe(-2);
		// Two rows of two pixels, each row padded to eight bytes; the run of one repeats the pixel before it.
		expect(out.subarray(54).toString("hex")).toBe(
			"01020311121300000102030102030000",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = splFile(4, 1, TWO_BY_TWO).subarray(0, 3);
		expect(readSplLayout(data)).toBeUndefined();
		await expect(
			zyxSplImageFormat.open(new BufferByteSource(data), "pic.spl"),
		).rejects.toThrow(GarbroError);
		await expect(
			zyxSplImageFormat.open(new BufferByteSource(data), "pic.spl"),
		).rejects.toThrow("Not a Zyx tiled picture");
	});
});

describe("Zyx tiled walk", () => {
	const layout = { width: 4, height: 1, tiles: [], dataOffset: 0 };

	it("reads a run of pixels that stand in the stream themselves", () => {
		// One command carries three times its own byte less four bytes, so `5` holds one pixel and `6` two.
		const out = unpackSpl(
			Buffer.from([
				5, 0x01, 0x02, 0x03, 6, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 5, 0x31,
				0x32, 0x33,
			]),
			layout,
		);
		expect(out.toString("hex")).toBe("010203111213212223313233");
	});

	it("repeats the pixel before it", () => {
		const out = unpackSpl(Buffer.from([5, 0x01, 0x02, 0x03, 0, 0x03]), layout);
		expect(out.toString("hex")).toBe("010203010203010203010203");
	});

	it("copies whole pixels from a distance of pixels", () => {
		// Two pixels, then two copies of the pixel one behind: the second one of the picture.
		const out = unpackSpl(
			Buffer.from([6, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 3, 0x01, 3, 0x01]),
			layout,
		);
		expect(out.toString("hex")).toBe("010203111213111213111213");
	});

	it("reads the wider count and distance of the second and fourth kinds", () => {
		// The count of the first kind is a byte, the distance of the second a word; the fourth kind takes a
		// word of its own. Both copies reach the second pixel.
		const long = unpackSpl(
			Buffer.from([
				6, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 2, 0x01, 0x01, 0x00, 4, 0x02,
				0x00,
			]),
			layout,
		);
		expect(long.toString("hex")).toBe("010203111213111213111213");
	});

	it("refuses a command that reaches outside the picture", () => {
		// A run of nine bytes carries the walk to nine of twelve, and the run of six behind it reaches three
		// bytes past the picture.
		expect(() =>
			unpackSpl(
				Buffer.from([7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0]),
				layout,
			),
		).toThrow("past its own end");
		// A repeat at the very start has no pixel before it.
		expect(() => unpackSpl(Buffer.from([0, 0x01]), layout)).toThrow(
			"past its own end",
		);
		// Nor has a copy from one pixel behind it.
		expect(() => unpackSpl(Buffer.from([1, 0x02, 0x01]), layout)).toThrow(
			"past its own end",
		);
	});

	it("gives up where the stream stops", () => {
		const out = unpackSpl(Buffer.from([5, 0x01, 0x02, 0x03]), layout);
		expect(out.toString("hex")).toBe("010203000000000000000000");
	});
});
