import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	drgImageFormat,
	gga0ImageFormat,
	ggdIndexedImageFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readDrgLayout,
	readGga0Layout,
	readGgdLayout,
} from "../../packages/formats/src/ikura/drg-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { literalLzssStream } from "../helpers/lzss.js";

/** The head of a picture of the first kind of the engine: the mark and the places of the picture. */
function drgFile(
	mark: string,
	width: number,
	height: number,
	body: Buffer,
): Buffer {
	const head: Buffer = Buffer.alloc(8, 0x00);
	head.writeUInt32LE(~Buffer.from(mark, "latin1").readUInt32LE(0) >>> 0, 0);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, body]);
}

/** The head of the indexed picture of the engine: the mark, the places of the picture, the table. */
function ggdFile(
	width: number,
	height: number,
	palette: Buffer,
	places: Buffer,
	options: { headerSize?: number; bitmapSize?: number; flipped?: boolean } = {},
): Buffer {
	const headerSize = options.headerSize ?? 0x1c;
	const head: Buffer = Buffer.alloc(headerSize, 0x00);
	head.writeUInt32LE(~0x47363532 >>> 0, 0);
	head.writeUInt32LE(headerSize, 4);
	head.writeUInt32LE(width, 8);
	head.writeInt32LE(options.flipped ? -height : height, 12);
	head.writeUInt32LE(options.bitmapSize ?? places.length, 24);
	const table: Buffer = Buffer.alloc(4 + 0x400 + 4, 0x00);
	palette.copy(table, 4);
	return Buffer.concat([head, table, places]);
}

/** The head of a picture of the fourth kind of the engine, then the walk of the places of it. */
function gga0File(
	width: number,
	height: number,
	body: Buffer,
	options: { flags?: number } = {},
): Buffer {
	const head: Buffer = Buffer.alloc(24, 0x00);
	head.write("GGA00000", 0, "latin1");
	head.writeUInt16LE(width, 8);
	head.writeUInt16LE(height, 10);
	head[14] = 32;
	head[15] = options.flags ?? 0;
	head.writeUInt32LE(24, 16);
	head.writeUInt32LE(body.length, 20);
	return Buffer.concat([head, body]);
}

async function bmpOf(
	format: typeof drgImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "cg.drg");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a bitmap, of the rows of it from the top of the picture down. */
function pixelsOf(
	bytes: Buffer,
	width: number,
	height: number,
	places = 3,
): number[] {
	const stride = (width * places + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * places; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

describe("Digital Romance System image", () => {
	it("reads the head of a picture of the three kinds of marks", () => {
		expect(readDrgLayout(drgFile("FULL", 2, 3, Buffer.alloc(0)))?.width).toBe(
			2,
		);
		expect(
			readDrgLayout(drgFile("FULL", 2, 3, Buffer.alloc(0)))?.bitsPerPixel,
		).toBe(24);
		expect(
			readDrgLayout(drgFile("TRUE", 2, 3, Buffer.alloc(0)))?.bitsPerPixel,
		).toBe(24);
		expect(
			readDrgLayout(drgFile("HIGH", 2, 3, Buffer.alloc(0)))?.bitsPerPixel,
		).toBe(16);
		expect(
			readDrgLayout(drgFile("FULX", 2, 3, Buffer.alloc(0))),
		).toBeUndefined();
		const flat = drgFile("FULL", 2, 3, Buffer.alloc(0));
		flat.writeUInt16LE(0, 4);
		expect(readDrgLayout(flat)).toBeUndefined();
		expect(readDrgLayout(Buffer.alloc(0x10, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture of the places of the file itself and of the places of it", async () => {
		// The walk of the places of the file of the engine stands of the places of a pixel of the picture:
		// the walk of the places standing of five or more stands of a run of the places of the file itself,
		// and the walk standing of one stands of the places of the picture before the place of the run.
		const data = drgFile(
			"FULL",
			2,
			1,
			Buffer.from([0x05, 0x11, 0x22, 0x33, 0x01, 0x01, 0x01]),
		);
		const image = await bmpOf(drgImageFormat, data);
		expect([...image.subarray(0x36, 0x36 + 6)]).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
		]);
	});

	it("turns away a picture of a walk standing of no places of the picture", async () => {
		// The places of the run of the walk stand of the places of the picture itself: a run of the places
		// of the file before the first place of the picture stands of no places of it at all.
		const data = drgFile("FULL", 2, 1, Buffer.from([0x01, 0x01, 0x00]));
		await expect(bmpOf(drgImageFormat, data)).rejects.toThrow(GarbroError);
	});

	it("reads the head of the indexed picture of the engine and the walk of the places of it", async () => {
		const palette: Buffer = Buffer.alloc(0x400, 0x00);
		palette[4] = 0x33;
		palette[5] = 0x22;
		palette[6] = 0x11;
		// The places of the walk of the indexed picture stand of a row of the places of the width of the
		// picture: of the places of the file of the row behind them.
		const places: Buffer = Buffer.alloc(16, 0x00);
		places[0] = 0x01;
		places[1] = 0x02;
		places[8] = 0x03;
		const stream = literalLzssStream(places);
		const data = ggdFile(5, 2, palette, stream, { bitmapSize: 16 });
		const layout = readGgdLayout(data);
		expect(layout?.width).toBe(5);
		expect(layout?.height).toBe(2);
		expect(layout?.flipped).toBe(false);
		const bytes = await bmpOf(ggdIndexedImageFormat, data);
		const image = readBmpImage(bytes);
		if (!image) throw new Error("the port handed over no bitmap");
		expect([...image.pixels]).toEqual([
			0x01, 0x02, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00,
		]);
		expect([...bytes.subarray(0x36, 0x36 + 8)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x33, 0x22, 0x11, 0x00,
		]);
	});

	it("reads the head of the indexed picture of the places of it the other way up", () => {
		const layout = readGgdLayout(
			ggdFile(
				5,
				2,
				Buffer.alloc(0x400, 0x00),
				literalLzssStream(Buffer.alloc(16)),
				{
					flipped: true,
				},
			),
		);
		expect(layout?.height).toBe(2);
		expect(layout?.flipped).toBe(true);
		expect(readGgdLayout(Buffer.alloc(0x20, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture of the fourth kind, of the walks of the places of the file", async () => {
		// The walk of the places of a picture of the fourth kind stands of the places of a pixel of it:
		// the walk of the places standing of the places of the file itself stands of four places of the
		// file to a place of the picture, and the walk standing of eight of the places of the picture
		// before the place of the run.
		const data = gga0File(
			2,
			1,
			Buffer.from([0x0c, 0x11, 0x22, 0x33, 0x44, 0x08]),
		);
		expect(readGga0Layout(data)?.width).toBe(2);
		const image = await bmpOf(gga0ImageFormat, data);
		expect([...image.subarray(0x36, 0x36 + 8)]).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44,
		]);
	});

	it("reads the places of a picture of the fourth kind of the row above the place of it", async () => {
		const data = gga0File(
			2,
			2,
			Buffer.concat([
				Buffer.from([0x0d]),
				Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
				Buffer.from([0x09, 0x0a]),
			]),
		);
		expect(pixelsOf(await bmpOf(gga0ImageFormat, data), 2, 2, 4)).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x11, 0x22, 0x33, 0x44,
			0x11, 0x22, 0x33, 0x44,
		]);
	});

	it("turns away a picture of the fourth kind standing short of the file of it", async () => {
		const data = gga0File(2, 1, Buffer.from([0x0c, 0x11, 0x22]));
		await expect(bmpOf(gga0ImageFormat, data)).rejects.toThrow(GarbroError);
	});

	it("tells the pictures of the engine by the heads of them", async () => {
		expect(
			await drgImageFormat.detect?.(
				new BufferByteSource(drgFile("FULL", 2, 2, Buffer.alloc(6))),
			),
		).toBe(true);
		expect(
			await gga0ImageFormat.detect?.(
				new BufferByteSource(gga0File(2, 2, Buffer.alloc(8))),
			),
		).toBe(true);
		const wrong = gga0File(2, 2, Buffer.alloc(8));
		wrong.write("GGA00001", 0, "latin1");
		expect(await gga0ImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
