import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	crowdCwpImageFormat,
	readCwpLayout,
	standCwpAsPng,
} from "../../packages/formats/src/crowd/cwp-image.js";
import {
	PNG_SIGNATURE,
	readPngHeaderFields,
} from "../../packages/formats/src/shared/png.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const DATA_OFFSET = 0x19;
/** One row of two places of four samples each: the walk of the places of the file of the engine itself. */
const PLACES = Buffer.from([0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
const DATA = deflateSync(PLACES);
/** The places of the file of the picture and the check word of the places of the file of it: the rebuilt
 * stream carries the check word as the last places of its own chunk of the places of the file. */
const BODY = Buffer.concat([
	DATA,
	(() => {
		const crc = Buffer.alloc(4, 0x00);
		crc.writeUInt32BE(
			crc32(Buffer.concat([Buffer.from("IDAT", "latin1"), DATA])),
			0,
		);
		return crc;
	})(),
]);

function buildPicture(mark = "CWDP"): Buffer {
	const head = Buffer.alloc(DATA_OFFSET, 0x00);
	head.write(mark, 0, "latin1");
	head.writeUInt32BE(2, 4);
	head.writeUInt32BE(1, 8);
	head.writeUInt8(8, 0x0c);
	head.writeUInt8(6, 0x0d);
	head.writeUInt8(0, 0x0e);
	head.writeUInt8(0, 0x0f);
	head.writeUInt8(0, 0x10);
	// The check word of the head of the picture, and the count of the places of the file of it, both of
	// which the rebuilt stream carries as they stand: the reader of the picture of this project walks them.
	head.writeUInt32BE(
		crc32(
			Buffer.concat([Buffer.from("IHDR", "latin1"), head.subarray(4, 0x11)]),
		),
		0x11,
	);
	head.writeUInt32BE(DATA.length, 0x15);
	return Buffer.concat([head, BODY]);
}

const PICTURE = buildPicture();

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await crowdCwpImageFormat.open(
		new BufferByteSource(data),
		"picture.cwp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Crowd engine image format", () => {
	it("reads the head of a picture", () => {
		expect(readCwpLayout(PICTURE, PICTURE.length)).toEqual({
			width: 2,
			height: 1,
			bits: 8,
			colourType: 6,
			bitsPerPixel: 32,
			dataOffset: DATA_OFFSET,
		});
	});

	it("turns away a head that names no picture", () => {
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("CWDP"[0] === "C" ? "CXDP" : "CXDP", 0, "latin1");
		expect(readCwpLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noPlaces = Buffer.from(PICTURE);
		noPlaces.writeUInt32BE(0, 4);
		expect(readCwpLayout(noPlaces, noPlaces.length)).toBeUndefined();
		const wrongBits = Buffer.from(PICTURE);
		wrongBits.writeUInt8(7, 0x0c);
		expect(readCwpLayout(wrongBits, wrongBits.length)).toBeUndefined();
		const wrongColour = Buffer.from(PICTURE);
		wrongColour.writeUInt8(5, 0x0d);
		expect(readCwpLayout(wrongColour, wrongColour.length)).toBeUndefined();
		expect(readCwpLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("stands the words of a portable network graphic around the places of the file", () => {
		const layout = readCwpLayout(PICTURE, PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		const png = standCwpAsPng(PICTURE, layout);
		expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		expect(png.readUInt32BE(8)).toBe(0x0d);
		expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
		expect(png.subarray(0x10, 0x25)).toEqual(PICTURE.subarray(4, 4 + 0x15));
		expect(png.subarray(0x25, 0x29).toString("latin1")).toBe("IDAT");
		expect(png.subarray(0x29, png.length - 12)).toEqual(BODY);
		// The reference writes the count of the places of that chunk with three bytes where four belong,
		// which leaves the stream one byte short; this port writes the four, which the reader of the picture
		// of this project needs to walk the stream to its end.
		expect(png.subarray(png.length - 12)).toEqual(
			Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
		);
		expect(readPngHeaderFields(png)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
	});

	it("reads the picture out of the words of the portable network graphic it builds", async () => {
		// `CwpFormat.Read` hands the rebuilt stream to the platform's PNG decoder; this port reads it with
		// its own reader of that format, which hands out the places of the picture with four bytes a place,
		// blue, green, red then alpha, as the other readers of this project do.
		const image = readBmpImage(await extract(PICTURE));
		if (!image) throw new Error("the picture is not a bitmap");
		expect([image.width, image.height]).toEqual([2, 1]);
		expect(image.bitsPerPixel).toBe(32);
		// The places of the file of the picture stand red, green, blue then alpha, so the first byte of
		// every place of the bitmap is the third of the picture.
		expect([...image.pixels]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
		const handle = await crowdCwpImageFormat.open(
			new BufferByteSource(PICTURE),
			"picture.cwp",
		);
		expect(handle.entries[0]?.path).toBe("picture.bmp");
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
	});

	it("reads a picture of the second kind", async () => {
		const data = buildPicture("AMNP");
		expect(readCwpLayout(data, data.length)).toMatchObject({ width: 2 });
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("the picture is not a bitmap");
		expect([...image.pixels]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
	});

	it("turns a picture cut short of the places of its head away", async () => {
		const cut = Buffer.from(PICTURE.subarray(0, 20));
		const layout = readCwpLayout(cut, cut.length);
		expect(layout).toMatchObject({ width: 2, height: 1 });
		await expect(extract(cut)).rejects.toThrow(GarbroError);
		await expect(extract(cut)).rejects.toThrow(
			"Crowd picture is cut short of the places of its head",
		);
	});

	it("is told by the words of the head of the picture", async () => {
		expect(crowdCwpImageFormat.descriptor.id).toBe("crowd-cwp-image");
		expect(crowdCwpImageFormat.descriptor.extensions).toEqual(["cwp", "amp"]);
		await expect(
			crowdCwpImageFormat.detect(new BufferByteSource(PICTURE)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("CXDP", 0, "latin1");
		await expect(
			crowdCwpImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
