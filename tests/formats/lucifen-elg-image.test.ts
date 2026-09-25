import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { elgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readElgLayout } from "../../packages/formats/src/lucifen/elg-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The head of a picture of the engine, of the letters `ELG` and the places of the kind of the walk. */
function elgHead(
	width: number,
	height: number,
	bitsPerPixel: number,
	options: { kind?: number; x?: number; y?: number } = {},
): Buffer {
	const kind = options.kind ?? 0;
	const letters: Buffer = Buffer.from([0x45, 0x4c, 0x47, kind]);
	if (0 === kind) {
		const head: Buffer = Buffer.alloc(8, 0x00);
		letters.copy(head, 0);
		head[3] = bitsPerPixel;
		head.writeUInt16LE(width, 4);
		head.writeUInt16LE(height, 6);
		return head;
	}
	const head: Buffer = Buffer.alloc(13, 0x00);
	letters.copy(head, 0);
	head[4] = bitsPerPixel;
	if (1 === kind) {
		head.writeInt16LE(options.x ?? 0, 5);
		head.writeInt16LE(options.y ?? 0, 7);
		head.writeUInt16LE(width, 9);
		head.writeUInt16LE(height, 11);
	} else {
		head.writeUInt16LE(width, 5);
		head.writeUInt16LE(height, 7);
		head.writeInt16LE(options.x ?? 0, 9);
		head.writeInt16LE(options.y ?? 0, 11);
	}
	return head;
}

async function bmpOf(data: Buffer): Promise<Buffer> {
	const handle = await elgImageFormat.open(
		new BufferByteSource(data),
		"cg.elg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a bitmap, of the rows of it from the top of the picture down. */
function pixelsOf(bytes: Buffer, width: number, height: number): number[] {
	const stride = (width * 3 + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * 3; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

describe("Lucifen Easy Game System image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const plain = elgHead(2, 2, 24);
		const first = readElgLayout(plain);
		expect(first?.width).toBe(2);
		expect(first?.height).toBe(2);
		expect(first?.bitsPerPixel).toBe(24);
		expect(first?.kind).toBe(0);
		expect(first?.headSize).toBe(8);
		// The places of the picture to either side and up and down stand of the head of a picture of the
		// second kind, of the places of the file of the head of the walk of its chunks of the third.
		const second = elgHead(2, 2, 8, { kind: 1, x: -3, y: 5 });
		const layout = readElgLayout(second);
		expect(layout?.kind).toBe(1);
		expect(layout?.bitsPerPixel).toBe(8);
		expect(layout?.offsetX).toBe(-3);
		expect(layout?.offsetY).toBe(5);
		expect(layout?.headSize).toBe(13);
		const third = elgHead(2, 2, 32, { kind: 2, x: 1, y: 2 });
		expect(readElgLayout(third)?.kind).toBe(2);
		expect(readElgLayout(third)?.offsetX).toBe(1);
		const wrongBits = elgHead(2, 2, 16);
		expect(readElgLayout(wrongBits)).toBeUndefined();
		const wrongMark = Buffer.from(plain);
		wrongMark[0] = 0x46;
		expect(readElgLayout(wrongMark)).toBeUndefined();
		const flat = elgHead(2, 2, 24);
		flat.writeUInt16LE(0, 4);
		expect(readElgLayout(flat)).toBeUndefined();
		expect(readElgLayout(plain.subarray(0, 7))).toBeUndefined();
	});

	it("reads a picture of eight places of a colour, of the colours of its own", async () => {
		// The walk of the places of the file of the picture stands of the table of the colours of it before
		// the places of the picture itself: of a run of the places of the file of four places of a colour
		// to a place of the picture, of the places of the file of the table behind the count of them.
		const palette: Buffer = Buffer.alloc(0x400, 0x00);
		palette[4] = 0x33;
		palette[5] = 0x22;
		palette[6] = 0x11;
		const walk = Buffer.concat([
			// The count of the places of the file of the table: of 0x300 places of it and the places behind
			// the places of the file of the walk of the engine.
			Buffer.from([0x23, 0xdf]),
			palette,
			Buffer.from([0xff]),
			// The places of the picture: two of them standing in the file, three of them of the place
			// before them.
			Buffer.from([0x01, 0x10, 0x11]),
			Buffer.from([0x40, 0x22]),
			Buffer.from([0xff]),
		]);
		const data = Buffer.concat([elgHead(5, 1, 8), walk]);
		const bytes = await bmpOf(data);
		const image = readBmpImage(bytes);
		if (!image) throw new Error("the port handed over no bitmap");
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([0x10, 0x11, 0x22, 0x22, 0x22]);
		expect([...bytes.subarray(0x36, 0x36 + 8)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x33, 0x22, 0x11, 0x00,
		]);
	});

	it("reads the places of a picture of twenty four places of a colour, of the row before it", async () => {
		// A picture of two rows of two places of a colour to a place of them: the places of the row below
		// stand of the places of the picture one row up, of no places of the file behind the walk of them.
		const data = Buffer.concat([
			elgHead(2, 2, 24),
			Buffer.from([0x01, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0xd0, 0xd0, 0xff]),
		]);
		expect(pixelsOf(await bmpOf(data), 2, 2)).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
		]);
	});

	it("reads the places of a picture of thirty two places of a colour, of the alpha of it", async () => {
		// The places of the alpha of a picture stand of the walk of the places of the picture itself: the
		// places of the file of the walk of the alpha stand of the places of a colour of the picture, of
		// the fourth place of a place of it.
		const data = Buffer.concat([
			elgHead(3, 1, 32),
			Buffer.from([
				0x00, 0x11, 0x22, 0x33, 0x40, 0x44, 0x55, 0x66, 0xff, 0x02, 0x91, 0x92,
				0x93, 0xff,
			]),
		]);
		const image = await bmpOf(data);
		const places = readBmpImage(image);
		if (!places) throw new Error("the port handed over no bitmap");
		expect(places.bitsPerPixel).toBe(32);
		expect([...places.pixels]).toEqual([
			0x11, 0x22, 0x33, 0x91, 0x44, 0x55, 0x66, 0x92, 0x44, 0x55, 0x66, 0x93,
		]);
	});

	it("reads a picture of the second kind, of the places of it to either side and up and down", async () => {
		const data = Buffer.concat([
			elgHead(1, 1, 24, { kind: 1, x: 7, y: 9 }),
			Buffer.from([0x00, 0xaa, 0xbb, 0xcc, 0xff]),
		]);
		expect(pixelsOf(await bmpOf(data), 1, 1)).toEqual([0xaa, 0xbb, 0xcc]);
	});

	it("reads a picture of the third kind, of the chunks of the file of it", async () => {
		// The places of the file of the picture stand of chunks of their own, of the count of the places of
		// the head of a chunk in front of the places of it: the walk of the picture stands behind them.
		const chunk: Buffer = Buffer.alloc(4, 0x00);
		chunk.writeInt32LE(8, 0);
		const data = Buffer.concat([
			elgHead(1, 1, 24, { kind: 2 }),
			Buffer.from([0x01]),
			chunk,
			Buffer.alloc(4, 0x00),
			Buffer.from([0x00]),
			Buffer.from([0x00, 0xaa, 0xbb, 0xcc, 0xff]),
		]);
		expect(readElgLayout(data)?.kind).toBe(2);
		expect(pixelsOf(await bmpOf(data), 1, 1)).toEqual([0xaa, 0xbb, 0xcc]);
	});

	it("turns away a picture of a walk standing short of the file of it", async () => {
		const data = Buffer.concat([
			elgHead(4, 1, 24),
			Buffer.from([0x01, 0x11, 0x22, 0x33]),
		]);
		await expect(bmpOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		expect(
			await elgImageFormat.detect?.(new BufferByteSource(elgHead(2, 2, 24))),
		).toBe(true);
		const wrong = elgHead(2, 2, 24);
		wrong[3] = 16;
		expect(await elgImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
