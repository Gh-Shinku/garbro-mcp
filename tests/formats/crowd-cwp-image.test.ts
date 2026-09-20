import { Buffer } from "node:buffer";
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

const DATA_OFFSET = 0x19;
const BODY = Buffer.from("789c6360f80a0001010100", "hex");

function buildPicture(mark = "CWDP"): Buffer {
	const head = Buffer.alloc(DATA_OFFSET, 0x00);
	head.write(mark, 0, "latin1");
	head.writeUInt32BE(2, 4);
	head.writeUInt32BE(1, 8);
	head.writeUInt8(8, 0x0c);
	head.writeUInt8(6, 0x0d);
	head.writeUInt8(0x08, 0x0e);
	head.writeUInt8(0x00, 0x0f);
	head.writeUInt8(0x00, 0x10);
	for (let at = 0x11; at < DATA_OFFSET; at += 1) head.writeUInt8(at, at);
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
		expect(png.subarray(0x29, png.length - 11)).toEqual(BODY);
		expect(png.subarray(png.length - 11)).toEqual(
			Buffer.from([0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
		);
		expect(readPngHeaderFields(png)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
	});

	it("hands the picture out as the words of a portable network graphic", async () => {
		const png = await extract(PICTURE);
		expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		expect(readPngHeaderFields(png)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		const handle = await crowdCwpImageFormat.open(
			new BufferByteSource(PICTURE),
			"picture.cwp",
		);
		expect(handle.entries[0]?.path).toBe("picture.png");
		expect(handle.metadata).toMatchObject({
			image: "png",
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
	});

	it("reads a picture of the second kind", async () => {
		const data = buildPicture("AMNP");
		expect(readCwpLayout(data, data.length)).toMatchObject({ width: 2 });
		expect((await extract(data)).subarray(0, 8)).toEqual(PNG_SIGNATURE);
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
