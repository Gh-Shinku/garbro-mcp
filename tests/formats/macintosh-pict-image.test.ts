import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { pictImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readPictLayout } from "../../packages/formats/src/macintosh/pict-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The head of a picture of the engine: the places of it, of the mark `PICT` or of 0x200. */
function pictHead(
	width: number,
	height: number,
	options: { mark?: boolean; version?: number; opcode?: number } = {},
): Buffer {
	const at = options.mark === false ? 0x200 : 4;
	const head: Buffer = Buffer.alloc(at + 0x10, 0x00);
	if (options.mark !== false) head.write("PICT", 0, "latin1");
	head.writeInt16BE(0, at + 2);
	head.writeInt16BE(0, at + 4);
	head.writeInt16BE(height, at + 6);
	head.writeInt16BE(width, at + 8);
	head.writeUInt16BE(options.opcode ?? 0x11, at + 0x0a);
	head.writeUInt16BE(options.version ?? 0x2ff, at + 0x0c);
	return head;
}

/** The rectangle of the places of a picture: the places of the head of it, of the places of it behind. */
function rect(width: number, height: number): Buffer {
	const out: Buffer = Buffer.alloc(8, 0x00);
	out.writeInt16BE(0, 0);
	out.writeInt16BE(0, 2);
	out.writeInt16BE(height, 4);
	out.writeInt16BE(width, 6);
	return out;
}

/** The head of the places of a colour of a picture, of the places of a colour of its own. */
function pixmapHead(bitsPerPixel: number, compCount: number): Buffer {
	const head: Buffer = Buffer.alloc(36, 0x00);
	head.writeInt16BE(bitsPerPixel, 18);
	head.writeInt16BE(compCount, 20);
	head.writeInt16BE(1, 22);
	return head;
}

/** A word of the walk of a picture: the number of the word, then the places of the file behind it. */
function word(code: number, body: Buffer[]): Buffer {
	const head: Buffer = Buffer.alloc(2, 0x00);
	head.writeUInt16BE(code, 0);
	return Buffer.concat([head, ...body]);
}

/** A row of the places of the file: the count of the places of the row, then the places themselves. */
function rleRow(scanline: Buffer): Buffer {
	return Buffer.concat([Buffer.from([scanline.length]), scanline]);
}

/** The head of the places of the file of a picture of the places of a colour of no walk of the engine. */
function bitsHead(stride: number, width: number, height: number): Buffer[] {
	const out: Buffer = Buffer.alloc(2, 0x00);
	out.writeUInt16BE(stride, 0);
	return [out, rect(width, height)];
}

/**
 * The walk of a picture comes to its end at a place of the file of an even count: the places of the walk
 * standing of an odd count of places of the file stand one place of the file behind the other, of the
 * lowest place of the file of it first.
 */
function ends(body: Buffer): Buffer {
	const whole =
		body.length % 2 === 0 ? body : Buffer.concat([body, Buffer.alloc(1, 0x00)]);
	return Buffer.concat([whole, Buffer.from([0x00, 0xff])]);
}

/** The places of a picture, of the head of it behind: the BMP itself, of the walk of the engine. */
async function bmpOf(data: Buffer): Promise<Buffer> {
	const handle = await pictImageFormat.open(
		new BufferByteSource(data),
		"cg.pct",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

async function pixelsOf(data: Buffer) {
	const image = readBmpImage(await bmpOf(data));
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Apple Macintosh image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = pictHead(8, 1);
		const layout = readPictLayout(good);
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(1);
		// The places of the walk of the picture stand behind the head of it, of the mark of it or not.
		expect(layout?.dataOffset).toBe(4 + 0x0e);
		expect(readPictLayout(pictHead(8, 1, { mark: false }))?.dataOffset).toBe(
			0x200 + 0x0e,
		);
		expect(readPictLayout(pictHead(8, 1, { version: 0x2fe }))).toBeUndefined();
		expect(readPictLayout(pictHead(8, 1, { opcode: 0x12 }))).toBeUndefined();
		expect(readPictLayout(good.subarray(0, 0x10))).toBeUndefined();
		expect(readPictLayout(Buffer.alloc(0x20, 0x00))).toBeUndefined();
	});

	it("reads a picture of the places of a colour of its own, of two colours of one", async () => {
		// A picture of eight places of a colour to a place of the file, of two colours of its own. The row
		// of it stands of a run of three places of the file and then of a run of one place of the file six
		// times, of which the walk of the row stands of the five places of the picture behind the first
		// three of them: the places of the row stand `0`, `1`, `0` and then `1` five times.
		const table: Buffer = Buffer.alloc(4 + 2 + 2 + 8 * 2, 0x00);
		table.writeUInt16BE(1, 6);
		// The colours of the picture: the first of them white, the second of them black, of the places of
		// the file of it of the place of the colour of a place of it, then the places of a colour of it.
		table.writeUInt16BE(0, 8);
		table.writeUInt16BE(0xffff, 10);
		table.writeUInt16BE(0xffff, 12);
		table.writeUInt16BE(0xffff, 14);
		// The second colour of the picture names the second place of the colours of it of its own.
		table.writeUInt16BE(1, 16);
		const scanline = Buffer.concat([
			Buffer.from([0x02, 0x00, 0x01, 0x00]),
			Buffer.from([0xfc, 0x01]),
		]);
		const data = Buffer.concat([
			pictHead(8, 1),
			ends(
				word(0x98, [
					...bitsHead(0x8000 | 8, 8, 1),
					pixmapHead(8, 1),
					table,
					Buffer.alloc(8 + 8 + 2, 0x00),
					rleRow(scanline),
				]),
			),
		]);
		const bytes = await bmpOf(data);
		const image = readBmpImage(bytes);
		if (!image) throw new Error("the port handed over no bitmap");
		expect([...image.pixels]).toEqual([0, 1, 0, 1, 1, 1, 1, 1]);
		expect(image.bitsPerPixel).toBe(8);
		expect([...bytes.subarray(0x36, 0x36 + 8)]).toEqual([
			0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("reads the places of a colour of a picture, of the places of the file of it one behind another", async () => {
		// The places of a picture of thirty two places of a colour to a place of it stand of the places of
		// the file of it themselves: of the places of a colour of it one behind another, of the lowest
		// place of a place of the picture of the walk of it first.
		const data = Buffer.concat([
			pictHead(2, 1),
			word(0x9a, [
				Buffer.alloc(6, 0x00),
				rect(2, 1),
				pixmapHead(32, 3),
				Buffer.alloc(8 + 8 + 2, 0x00),
				Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
			]),
		]);
		const image = await pixelsOf(data);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0x55, 0x33, 0x11, 0x00, 0x66, 0x44, 0x22, 0x00,
		]);
	});

	it("reads the alpha of a picture of four places of a colour to a place of it", async () => {
		// The places of the picture stand of the places of a colour of it one behind another: of the
		// places of the alpha of it first, then of the places of a colour of it, of the lowest place of
		// them first.
		const scanline = Buffer.concat([
			Buffer.from([0x07]),
			Buffer.from([0x01, 0x02, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		]);
		const data = Buffer.concat([
			pictHead(2, 1),
			word(0x9a, [
				Buffer.alloc(6, 0x00),
				rect(2, 1),
				pixmapHead(32, 4),
				Buffer.alloc(8 + 8 + 2, 0x00),
				rleRow(scanline),
			]),
		]);
		const image = await pixelsOf(data);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0x55, 0x33, 0x11, 0x01, 0x66, 0x44, 0x22, 0x02,
		]);
	});

	it("reads the places of a picture of sixteen places of a colour to a place of it", async () => {
		// The places of a picture of sixteen places of a colour to a place of it stand of the places of the
		// file of it the other way around from the places of the walk of it, so the BMP of it stands of the
		// lowest place of the word of a place of a colour of it first.
		const scanline = Buffer.concat([
			Buffer.from([0x03]),
			Buffer.from([0x7c, 0x00, 0x03, 0xe0, 0x00, 0x1f, 0x7f, 0xff]),
		]);
		const data = Buffer.concat([
			pictHead(4, 1),
			word(0x9a, [
				Buffer.alloc(6, 0x00),
				rect(4, 1),
				pixmapHead(16, 3),
				Buffer.alloc(8 + 8 + 2, 0x00),
				rleRow(scanline),
			]),
		]);
		// The BMP of the engine stands of twelve places of the colours of the picture behind the head of it.
		const bytes = await bmpOf(data);
		expect([...bytes.subarray(0x42, 0x4a)]).toEqual([
			0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x00, 0xff, 0x7f,
		]);
	});

	it("reads the places of a picture of twenty four places of a colour to a place of it", async () => {
		// The places of the row of a picture of twenty four places of a colour to a place of it stand of
		// the places of the width of the picture, of the places of the file of it behind: the reference
		// names the places of the row of the walk of it of the places of the width of the picture, of no
		// places of a colour of it, so a picture of eight places of the width stands of a row of twenty
		// four places of the file here.
		const scanline = Buffer.concat([
			Buffer.from([0x17]),
			Buffer.from([
				0x11, 0x22, 0x33, 0x44, 0x45, 0x46, 0x47, 0x48, 0x51, 0x52, 0x53, 0x54,
				0x55, 0x56, 0x57, 0x58, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
			]),
		]);
		const data = Buffer.concat([
			pictHead(8, 1),
			word(0x9a, [
				Buffer.alloc(6, 0x00),
				rect(8, 1),
				pixmapHead(24, 3),
				Buffer.alloc(8 + 8 + 2, 0x00),
				rleRow(scanline),
			]),
		]);
		const image = await pixelsOf(data);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([
			0x91, 0x51, 0x11, 0x92, 0x52, 0x22, 0x93, 0x53, 0x33, 0x94, 0x54, 0x44,
			0x95, 0x55, 0x45, 0x96, 0x56, 0x46, 0x97, 0x57, 0x47, 0x98, 0x58, 0x48,
		]);
	});

	it("reads a picture of the words of the walk of it standing of no places of the picture", async () => {
		// The words of the walk of the picture stand of the places of the file of it of our own: the words
		// of the walk standing of an odd count of places of the file stand one place of the file behind the
		// other, of the lowest place of the file first.
		const clip = Buffer.alloc(2 + 2 + 3, 0x00);
		clip.writeUInt16BE(0x01, 0);
		clip.writeUInt16BE(5, 2);
		const comment = Buffer.alloc(2 + 2 + 2 + 3, 0x00);
		comment.writeUInt16BE(0xa1, 0);
		comment.writeUInt16BE(3, 4);
		const header = Buffer.alloc(2 + 0x18, 0x00);
		header.writeUInt16BE(0x0c00, 0);
		const scanline = Buffer.concat([
			Buffer.from([0x07]),
			Buffer.alloc(8, 0x41),
		]);
		const data = Buffer.concat([
			pictHead(8, 1),
			// The words of the walk of the picture: the clip of it, the comment of it, the head of the
			// places of the file of it, the picture itself, and the end of the walk of it.
			clip,
			Buffer.alloc(1, 0x00),
			comment,
			Buffer.alloc(1, 0x00),
			header,
			word(0x98, [
				...bitsHead(0x8000 | 8, 8, 1),
				pixmapHead(8, 1),
				// The places of the colours of the picture: the places of the head of them, then one place of a colour of it.
				Buffer.alloc(4 + 2 + 2 + 8, 0x00),
				Buffer.alloc(8 + 8 + 2, 0x00),
				rleRow(scanline),
			]),
			Buffer.from([0x00, 0xff]),
		]);
		const image = await pixelsOf(data);
		expect([...image.pixels]).toEqual(Array.from({ length: 8 }, () => 0x41));
	});

	it("turns away a picture of the places of a colour of no walk of the engine", async () => {
		// The places of a picture of the places of the file of it of no places of a colour of eight of them
		// stand of one place of a colour to a place of the picture, which the walk of the engine names and
		// then turns away.
		const data = Buffer.concat([
			pictHead(3, 1),
			word(0x90, [...bitsHead(3, 3, 1), Buffer.from([0x01, 0x02, 0x03])]),
		]);
		await expect(pixelsOf(data)).rejects.toThrow(GarbroError);
	});

	it("turns away a picture of a word of no walk of the engine", async () => {
		const data = Buffer.concat([pictHead(8, 1), Buffer.from([0x12, 0x34])]);
		await expect(pixelsOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		expect(
			await pictImageFormat.detect?.(new BufferByteSource(pictHead(8, 1))),
		).toBe(true);
		const wrong = pictHead(8, 1, { version: 0x2fe });
		expect(await pictImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
