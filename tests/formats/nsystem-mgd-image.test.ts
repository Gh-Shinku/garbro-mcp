import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { pngFile } from "../helpers/png.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	decodeMgdPixels,
	nsystemMgdImageFormat,
	packMgdBitmap,
	readMgdLayout,
} from "../../packages/formats/src/nsystem/mgd-image.js";
import type { MgdLayout } from "../../packages/formats/src/nsystem/mgd-image.js";

const HEADER_SIZE = 0x1c;
const MODE_RAW = 0;
const MODE_PACKED = 1;
const MODE_PNG = 2;

/** An `MGD ` file: the header, the data word, then whatever the mode stores. */
function buildMgd(options: {
	width: number;
	height: number;
	mode: number;
	payload: Buffer;
	unpackedSize?: number;
}): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("MGD ", 0, "latin1");
	header.writeUInt16LE(HEADER_SIZE, 4);
	header.writeUInt16LE(options.width, 0x0c);
	header.writeUInt16LE(options.height, 0x0e);
	header.writeInt32LE(
		options.unpackedSize ?? options.width * options.height * 4,
		0x10,
	);
	header.writeInt32LE(options.mode, 0x18);
	const size = Buffer.alloc(4, 0x00);
	size.writeInt32LE(options.payload.length, 0);
	return Buffer.concat([header, size, options.payload]);
}

/** Four byte pixels in the order the format stores them. */
function rawPixels(pixels: [number, number, number, number][]): Buffer {
	const out = Buffer.alloc(pixels.length * 4);
	pixels.forEach((pixel, index) => {
		out[index * 4] = pixel[0];
		out[index * 4 + 1] = pixel[1];
		out[index * 4 + 2] = pixel[2];
		out[index * 4 + 3] = pixel[3];
	});
	return out;
}

/** An alpha channel: a run of three zeros, then a list of one. */
function packedAlpha(): Buffer {
	const alpha = Buffer.alloc(6, 0x00);
	alpha.writeInt16LE(-0x7ffe, 0); // a run of three
	alpha.writeInt16LE(1, 3); // then a list of one
	return alpha;
}

function layoutOf(file: Buffer): MgdLayout {
	const layout = readMgdLayout(file);
	if (!layout) throw new Error("no layout");
	return layout;
}

/** The bitmap the format writes for a picture, which is what an entry carries. */
function bitmapOf(file: Buffer): Buffer {
	const layout = layoutOf(file);
	return packMgdBitmap(decodeMgdPixels(file, layout), layout);
}

/** The places of the file of the picture as the format itself hands them out. */
async function walkOf(file: Buffer): Promise<Buffer> {
	const handle = await nsystemMgdImageFormat.open(
		new BufferByteSource(file),
		"picture.mgd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk as Uint8Array));
	}
	return Buffer.concat(chunks);
}

/** A packed payload: the alpha length, the alpha channel, the colour length, the colour channel. */
function packedPayload(alpha: Buffer, colour: Buffer): Buffer {
	const head = Buffer.alloc(4, 0x00);
	head.writeInt32LE(alpha.length, 0);
	const middle = Buffer.alloc(4, 0x00);
	middle.writeInt32LE(colour.length, 0);
	return Buffer.concat([head, alpha, middle, colour]);
}

describe("NSystem image format", () => {
	it("reads the header and refuses anything else", () => {
		const file = buildMgd({
			width: 3,
			height: 5,
			mode: MODE_RAW,
			payload: Buffer.alloc(0x40, 0x00),
		});
		const layout = layoutOf(file);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(5);
		expect(layout.dataOffset).toBe(HEADER_SIZE);
		expect(layout.unpackedSize).toBe(3 * 5 * 4);
		expect(layout.mode).toBe(MODE_RAW);
		const unknown = buildMgd({
			width: 1,
			height: 1,
			mode: 3,
			payload: Buffer.alloc(4, 0x00),
		});
		expect(readMgdLayout(unknown)).toBeUndefined();
		const wrongMarker = buildMgd({
			width: 1,
			height: 1,
			mode: MODE_RAW,
			payload: Buffer.alloc(4, 0x00),
		});
		wrongMarker.write("XYZ ", 0, "latin1");
		expect(readMgdLayout(wrongMarker)).toBeUndefined();
		expect(readMgdLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
	});

	it("reads stored pixels, and picks the depth from their alpha bytes", () => {
		const opaque = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_RAW,
			payload: rawPixels([
				[10, 20, 30, 0],
				[40, 50, 60, 0],
			]),
		});
		const plain = decodeMgdPixels(opaque, layoutOf(opaque));
		expect(plain.hasAlpha).toBe(false);
		expect([...plain.pixels]).toEqual([10, 20, 30, 0, 40, 50, 60, 0]);
		const withAlpha = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_RAW,
			payload: rawPixels([
				[10, 20, 30, 0],
				[40, 50, 60, 0xff],
			]),
		});
		expect(decodeMgdPixels(withAlpha, layoutOf(withAlpha)).hasAlpha).toBe(true);
	});

	it("reads a packed colour channel of all three group kinds", () => {
		// Two literal pixels, then one difference of five bits to a channel, then a run of one.
		const colour = Buffer.from([
			0x02,
			10,
			20,
			30,
			40,
			50,
			60, // two literal pixels
			0x81,
			0x43,
			0x84, // a difference: blue +3, green +2, red +1
			0x40,
			70,
			80,
			90, // a run of one pixel
		]);
		const file = buildMgd({
			width: 2,
			height: 2,
			mode: MODE_PACKED,
			payload: packedPayload(packedAlpha(), colour),
		});
		const pixels = decodeMgdPixels(file, layoutOf(file));
		expect(pixels.hasAlpha).toBe(false);
		expect([...pixels.pixels]).toEqual([
			10, 20, 30, 0, 40, 50, 60, 0, 43, 52, 61, 0, 70, 80, 90, 0,
		]);
	});

	it("reads a difference of four bits to a channel, signs and all", () => {
		// One literal pixel, then a difference that takes five from red, adds three to green and takes
		// fifteen from blue, which leaves the blue byte short of zero and therefore wrapped.
		const colour = Buffer.from([
			0x01,
			10,
			20,
			30, //
			0x81,
			0x7f,
			0x54, // blue -15, green +3, red -5
		]);
		const file = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_PACKED,
			payload: packedPayload(Buffer.alloc(2, 0x00), colour),
		});
		const pixels = decodeMgdPixels(file, layoutOf(file));
		expect([...pixels.pixels]).toEqual([10, 20, 30, 0, 0xfb, 23, 25, 0]);
	});

	it("writes the depth the alpha channel calls for", () => {
		const file = buildMgd({
			width: 1,
			height: 1,
			mode: MODE_RAW,
			payload: rawPixels([[10, 20, 30, 0]]),
		});
		const bmp = bitmapOf(file);
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		expect([...bmp.subarray(0x36, 0x39)]).toEqual([10, 20, 30]);
		const opaqueFile = buildMgd({
			width: 1,
			height: 1,
			mode: MODE_RAW,
			payload: rawPixels([[10, 20, 30, 0x80]]),
		});
		const alphaBmp = bitmapOf(opaqueFile);
		expect(alphaBmp.readUInt16LE(0x1c)).toBe(32);
		expect([...alphaBmp.subarray(0x36, 0x3a)]).toEqual([10, 20, 30, 0x80]);
	});

	it("refuses a picture whose data reaches past the file", () => {
		const file = buildMgd({
			width: 4,
			height: 4,
			mode: MODE_RAW,
			payload: Buffer.alloc(8, 0x00),
		});
		expect(() => decodeMgdPixels(file, layoutOf(file))).toThrow(GarbroError);
	});

	it("reads the picture of another kind the third mode holds", async () => {
		// `MgdFormat.Read` of the third mode hands the stream behind the count of the places of the picture
		// to the decoder of the platform and returns the frame of it; this port reads it with its own reader
		// of the PNG interchange format and hands out a bitmap of the size of that frame.
		const png = pngFile({
			width: 2,
			height: 1,
			colourType: 6,
			rows: [[1, 2, 3, 4, 5, 6, 7, 8]],
		});
		const file = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_PNG,
			payload: png,
		});
		const image = readBmpImage(await walkOf(file));
		if (!image) throw new Error("no bitmap");
		expect([image.width, image.height]).toEqual([2, 1]);
		// The places of the file of the picture stand red, green, blue then alpha, so the first byte of
		// every place of the bitmap is the third of the picture.
		expect([...image.pixels]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
		// The walk of the other two modes is not one of a picture of another kind.
		expect(() =>
			decodeMgdPixels(
				buildMgd({
					width: 1,
					height: 1,
					mode: MODE_PNG,
					payload: Buffer.alloc(4, 0x00),
				}),
				layoutOf(
					buildMgd({
						width: 1,
						height: 1,
						mode: MODE_PNG,
						payload: Buffer.alloc(4, 0x00),
					}),
				),
			),
		).toThrow(GarbroError);
	});

	it("refuses a picture of the third mode whose own count or places stand behind it", async () => {
		const short = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_PNG,
			payload: Buffer.alloc(4, 0x00),
		});
		const layout = layoutOf(short);
		short.writeInt32LE(0x1000, layout.dataOffset);
		await expect(walkOf(short)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		const stray = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_PNG,
			payload: Buffer.alloc(16, 0x11),
		});
		await expect(walkOf(stray)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("detects, lists and extracts through the registered format", async () => {
		const file = buildMgd({
			width: 2,
			height: 1,
			mode: MODE_RAW,
			payload: rawPixels([
				[10, 20, 30, 0],
				[40, 50, 60, 0],
			]),
		});
		await expect(
			nsystemMgdImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		await expect(
			nsystemMgdImageFormat.detect(new BufferByteSource(Buffer.alloc(0x40, 0))),
		).resolves.toBe(false);
		const archive = await nsystemMgdImageFormat.open(
			new BufferByteSource(file),
			"picture.mgd",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual(["picture.bmp"]);
		expect(archive.metadata.mode).toBe(MODE_RAW);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await archive.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		expect([...bmp.subarray(0x36, 0x3c)]).toEqual([10, 20, 30, 40, 50, 60]);
		await expect(
			nsystemMgdImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0)),
				"picture.mgd",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
