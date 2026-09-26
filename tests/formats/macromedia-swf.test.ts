// The walk of the places of the file of a picture of this port and of the reference of the same engine.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { swfArchiveFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readSwfLayout,
	unpackSwfLossless,
} from "../../packages/formats/src/macromedia/swf.js";
import {
	readBmpImage,
	toBgra32,
} from "../../packages/formats/src/shared/bmp.js";
import { GREY_JPEG, GREY_PIXELS } from "../helpers/jpeg.js";

/** The places of the file of the walk of the bits of the picture of the engine, of the high place. */
class Bits {
	private readonly places: number[] = [];

	bit(value: number): void {
		this.places.push(value ? 1 : 0);
	}

	value(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) this.bit((value >> at) & 1);
	}

	bytes(): Buffer {
		const out: Buffer = Buffer.alloc((this.places.length + 7) >> 3, 0);
		for (let at = 0; at < this.places.length; at += 1) {
			if (this.places[at])
				out[at >> 3] = (out[at >> 3] ?? 0) | (0x80 >> (at & 7));
		}
		return out;
	}
}

/** The head of a picture of the engine: the letters, the places of the picture and the walk of it. */
function swfHead(
	width: number,
	height: number,
	places: number,
	count: number,
): Buffer {
	const head: Buffer = Buffer.alloc(8, 0);
	head.write("FWS", 0, "latin1");
	head[3] = 8;
	head.writeUInt32LE(0, 4);
	const bits = new Bits();
	const size = 5;
	bits.value(size, 5);
	bits.value(0, size);
	bits.value(width, size);
	bits.value(0, size);
	bits.value(height, size);
	const rect = bits.bytes();
	const body: Buffer = Buffer.alloc(4, 0);
	body.writeUInt16LE(places, 0);
	body.writeUInt16LE(count, 2);
	return Buffer.concat([head, rect, body]);
}

/** The places of the file of a tag of the picture of the engine. */
function tag(type: number, body: Buffer): Buffer {
	if (body.length < 0x3f) {
		const head: Buffer = Buffer.alloc(2, 0);
		head.writeUInt16LE((type << 6) | body.length, 0);
		return Buffer.concat([head, body]);
	}
	const head: Buffer = Buffer.alloc(6, 0);
	head.writeUInt16LE((type << 6) | 0x3f, 0);
	head.writeInt32LE(body.length, 2);
	return Buffer.concat([head, body]);
}

/** The places of the file of the picture of the engine of the walk of the engine: the places of it. */
function lossless(id: number, hasAlpha: boolean): Buffer {
	const body: Buffer = Buffer.alloc(7, 0);
	body.writeUInt16LE(id, 0);
	body[2] = 5;
	body.writeUInt16LE(2, 3);
	body.writeUInt16LE(2, 5);
	// The places of the file of the walk of the engine stand of the places of the file of the picture of
	// the engine of the places of the file of the alpha of it first, of the red, of the green and of the
	// places of the file of the colour of it last.
	const places = hasAlpha
		? Buffer.from([
				0x80, 0x11, 0x22, 0x33, 0x40, 0x44, 0x55, 0x66, 0x20, 0x77, 0x88, 0x99,
				0x10, 0xaa, 0xbb, 0xcc,
			])
		: Buffer.from([
				0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0xff, 0x77, 0x88, 0x99, 0xff,
				0xaa, 0xbb, 0xcc, 0xff,
			]);
	return Buffer.concat([body, deflateSync(places)]);
}

/** The places of the file of the name of an entry of the engine: the places of the file of the two. */
function withId(id: number, rest: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(2, 0);
	head.writeUInt16LE(id, 0);
	return Buffer.concat([head, rest]);
}

/** The stream of the picture of the engine of the walk of the engine of it, of the places of the file of it. */
const JPEG: Buffer = GREY_JPEG;

function swfFile(): Buffer {
	return Buffer.concat([
		swfHead(8, 4, 0x0c00, 1),
		tag(8, withId(1, Buffer.from([0x02]))),
		tag(12, withId(2, Buffer.from([0x0a]))),
		tag(6, withId(3, JPEG)),
		tag(21, Buffer.concat([withId(4, Buffer.alloc(6, 0)), JPEG])),
		tag(36, lossless(5, true)),
		tag(20, lossless(6, false)),
		tag(
			14,
			withId(
				7,
				Buffer.concat([
					Buffer.from([0x2f, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00]),
					Buffer.from("the places of the file of the sound", "latin1"),
				]),
			),
		),
		tag(18, withId(0x2006, Buffer.from([0x2f, 0x00]))),
		tag(19, Buffer.from([0x42, 0x01, 0x02, 0x03, 0x04, 0x05])),
		tag(19, Buffer.from([0x43, 0x06, 0x07, 0x08, 0x09])),
		tag(2, Buffer.from([0x01, 0x02, 0x03])),
		tag(0, Buffer.alloc(0)),
	]);
}

/** The places of the file of the picture of the engine of the third kind of it: the count of the places of
 * the picture, the picture itself, and the stream of the alpha of it behind them. */
function jpeg3(id: number, jpeg: Buffer, alpha: Buffer): Buffer {
	const body: Buffer = Buffer.alloc(6, 0);
	body.writeUInt16LE(id, 0);
	body.writeInt32LE(jpeg.length, 2);
	return Buffer.concat([body, jpeg, deflateSync(alpha)]);
}

/** A picture of the engine of the third kind, of the alpha of it of the places of the file of the walk. */
function swfJpeg3File(alpha: Buffer): Buffer {
	return Buffer.concat([
		swfHead(8, 8, 0x0c00, 1),
		tag(35, jpeg3(9, GREY_JPEG, alpha)),
		tag(0, Buffer.alloc(0)),
	]);
}

/** The places of the file of the picture of the engine, of the walk of the engine of the file of it. */
async function open(data: Buffer) {
	return swfArchiveFormat.open(new BufferByteSource(data), "cg.swf");
}

/** The picture of the engine of the walk of the engine of the file of it, as a bitmap of this project. */
async function pictureOf(data: Buffer, at: number) {
	return readBmpImage(await contentOf(data, at));
}

async function contentOf(data: Buffer, at: number): Promise<Buffer> {
	const handle = await open(data);
	const entry = handle.entries[at];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The head of a picture of the engine of the walk of the engine of the places of it. */
function losslessHead(id: number, format: number): Buffer {
	const head: Buffer = Buffer.alloc(7, 0);
	head.writeUInt16LE(id, 0);
	head[2] = format;
	head.writeUInt16LE(2, 3);
	head.writeUInt16LE(2, 5);
	return head;
}

describe("Shockwave Flash presentation", () => {
	it("reads the head of the picture of the engine", async () => {
		const layout = await readSwfLayout(swfFile());
		expect(layout).toBeDefined();
		expect(layout?.version).toBe(8);
		expect(layout?.compressed).toBe(false);
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(4);
		expect(layout?.frameRate).toBe(0x0c00);
		expect(layout?.frameCount).toBe(1);
	});

	it("reads the places of the file of the engine of the picture of it of no places of the file", async () => {
		expect(await readSwfLayout(Buffer.alloc(0x20))).toBeUndefined();
		const short = Buffer.from(swfFile());
		short[0] = 0x47;
		expect(await readSwfLayout(short)).toBeUndefined();
	});

	it("reads the entries of the picture of the engine", async () => {
		const handle = await open(swfFile());
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"cg#00001.bin",
			"cg#00002.bin",
			"cg#00003.bmp",
			"cg#00004.bmp",
			"cg#00005.bmp",
			"cg#00006.bmp",
			"cg#00007.mp3",
			"cg#08198.mp3",
		]);
		expect(handle.entries.map((entry) => entry.metadata?.type)).toEqual([
			"JpegTables",
			"",
			"image",
			"image",
			"image",
			"image",
			"audio",
			"audio",
		]);
		expect(handle.metadata?.width).toBe(8);
	});

	it("reads the places of the file of the walk of the engine of the picture of the engine", async () => {
		// The places of the file of the picture of the engine of the walk of the engine stand of the places
		// of the file of the picture of the engine itself, of the places of the file of the two of them for
		// the walk of the second kind of it.
		const data = swfFile();
		expect([...(await contentOf(data, 0))]).toEqual([0x01, 0x00, 0x02]);
		expect([...(await contentOf(data, 1))]).toEqual([0x02, 0x00, 0x0a]);
		// The two kinds of picture the engine keeps as a JPEG are read with the reader of this project: the
		// places of the file of the picture of the engine itself stand behind the count of the places of the
		// file of it, and those of the second kind behind the places of the file of the walk of it.
		expect([...((await pictureOf(data, 2))?.pixels ?? [])]).toEqual([
			...GREY_PIXELS,
		]);
		expect([...((await pictureOf(data, 3))?.pixels ?? [])]).toEqual([
			...GREY_PIXELS,
		]);
	});

	it("reads the places of the file of the picture of the engine of the walk of the engine of it", async () => {
		// The places of the file of the picture of the engine stand of the walk of the engine of the places
		// of the file of the alpha of it first, of the red, of the green and of the colour of it last: the
		// places of the file of the picture of the engine of this port stand of the places of the file of
		// the colour of the walk of the engine of it first, of the green, of the red and of the alpha of it.
		const bmp = await contentOf(swfFile(), 4);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		const at = bmp.readUInt32LE(0x0a);
		expect([...bmp.subarray(at, at + 16)]).toEqual([
			0x33, 0x22, 0x11, 0x80, 0x66, 0x55, 0x44, 0x40, 0x99, 0x88, 0x77, 0x20,
			0xcc, 0xbb, 0xaa, 0x10,
		]);
		const other = await contentOf(swfFile(), 5);
		const places = other.readUInt32LE(0x0a);
		// The places of the file of the walk of the engine of the places of the file of a colour of the
		// picture of the engine itself: the places of the file of the picture of the engine of the walk of
		// the places of the file of the four of them of a place of it.
		expect([...other.subarray(places, places + 16)]).toEqual([
			0xff, 0x33, 0x22, 0x11, 0xff, 0x66, 0x55, 0x44, 0xff, 0x99, 0x88, 0x77,
			0xff, 0xcc, 0xbb, 0xaa,
		]);
	});

	it("reads a picture of the engine of the table of the colours of the walk of it", async () => {
		// The places of the file of the table of the colours of the picture of the engine stand of the places
		// of the file of the walk of the engine of the places of the file of the three of them and of the
		// places of the file of the alpha of it, of the walk of the engine of the places of the file of the
		// count of the colours of it at the head of the places of the file of the picture of the engine.
		const table = Buffer.from([0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x77]);
		const bmp = await unpackSwfLossless({
			type: 20,
			places: 0,
			body: Buffer.concat([
				losslessHead(9, 3),
				Buffer.from([1]),
				deflateSync(Buffer.concat([table, Buffer.from([0, 1, 1, 0])])),
			]),
		});
		expect(bmp.readUInt32LE(0x0a)).toBe(0x436);
		const image = readBmpImage(bmp);
		expect([...(image?.palette.subarray(0, 8) ?? [])]).toEqual([
			0x33, 0x22, 0x11, 0xff, 0x66, 0x55, 0x44, 0xff,
		]);
		// The places of the file of the walk of the engine of the places of the file of the picture of the
		// engine stand of the places of the file of the table of the colours of it behind them.
		expect([...(image?.pixels ?? [])]).toEqual([0, 1, 1, 0]);
		// The colour table stands of the places of the file of the three of them and of the places of the
		// file of the alpha of it, so the places of the file of the picture of the engine stand of the
		// places of the file of the colour of it first of them.
		expect([...(image ? (toBgra32(image, true) ?? []) : [])]).toEqual([
			0x33, 0x22, 0x11, 0xff, 0x66, 0x55, 0x44, 0xff, 0x66, 0x55, 0x44, 0xff,
			0x33, 0x22, 0x11, 0xff,
		]);
	});

	it("reads a picture of the engine of the colour of the two of them of the places of it", async () => {
		const places = Buffer.from([
			0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff,
		]);
		const bmp = await unpackSwfLossless({
			type: 20,
			places: 0,
			body: Buffer.concat([losslessHead(10, 4), deflateSync(places)]),
		});
		const image = readBmpImage(bmp);
		expect(image?.bitsPerPixel).toBe(16);
		expect(image?.masks).toEqual({ red: 0xf800, green: 0x07e0, blue: 0x001f });
		expect([...(image?.pixels ?? [])]).toEqual([...places]);
	});

	it("reads the picture of the third kind and the alpha of it", async () => {
		// `SwfJpeg3Decoder` reads the stream of the alpha of the picture behind the places of the file of the
		// picture itself and lays it over the fourth place of every place of the picture.
		const alpha = Buffer.alloc(64);
		for (let at = 0; at < 64; at += 1) alpha[at] = at + 1;
		const image = await pictureOf(swfJpeg3File(alpha), 0);
		if (!image) throw new Error("no bitmap");
		expect([image.width, image.height]).toEqual([8, 8]);
		const expected = Buffer.from(GREY_PIXELS);
		for (let at = 0; at < 64; at += 1) expected[at * 4 + 3] = at + 1;
		expect([...image.pixels]).toEqual([...expected]);
		// A stream that stands short of the count of the places of the picture leaves nought behind it.
		const short = await pictureOf(swfJpeg3File(Buffer.alloc(4, 0x77)), 0);
		if (!short) throw new Error("no bitmap");
		const padded = Buffer.from(GREY_PIXELS);
		for (let at = 0; at < 64; at += 1)
			padded[at * 4 + 3] = at < 4 ? 0x77 : 0x00;
		expect([...short.pixels]).toEqual([...padded]);
	});

	it("turns away a picture of the third kind whose count of the places of the file stands behind it", async () => {
		const body: Buffer = Buffer.alloc(6, 0);
		body.writeUInt16LE(9, 0);
		body.writeInt32LE(GREY_JPEG.length + 0x100, 2);
		const data = Buffer.concat([
			swfHead(8, 8, 0x0c00, 1),
			tag(35, Buffer.concat([body, GREY_JPEG])),
			tag(0, Buffer.alloc(0)),
		]);
		const handle = await open(data);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("reads the places of the file of the sound of the stream of the picture of the engine", async () => {
		const data = swfFile();
		expect([...(await contentOf(data, 6))]).toEqual([
			...Buffer.from("the places of the file of the sound", "latin1"),
		]);
		expect([...(await contentOf(data, 7))]).toEqual([0x04, 0x05, 0x09]);
	});

	it("reads the places of the file of the picture of the engine of the places of the file of it", async () => {
		// The places of the file of the picture of the engine of the walk of the places of the file of the
		// engine stand of the places of the file of the walk of the engine of the places of the file of the
		// picture of it of the compression of the places of the file of the engine itself.
		const plain = swfFile();
		const body = plain.subarray(8);
		const compressed = Buffer.concat([
			Buffer.from("CWS", "latin1"),
			Buffer.from([8, 0, 0, 0, 0]),
			deflateSync(body),
		]);
		const layout = await readSwfLayout(compressed);
		expect(layout?.compressed).toBe(true);
		expect(layout?.width).toBe(8);
		const handle = await open(compressed);
		expect(handle.entries.length).toBe(8);
		expect([...(await contentOf(compressed, 0))]).toEqual([0x01, 0x00, 0x02]);
		await expect(
			swfArchiveFormat.open(new BufferByteSource(Buffer.alloc(0x20)), "cg.swf"),
		).rejects.toThrow(GarbroError);
	});
});
