import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	maiAmImageFormat,
	maiCmImageFormat,
	maiMskImageFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readAmLayout,
	readCmLayout,
	readMskLayout,
} from "../../packages/formats/src/mai/image-mai.js";

/** The places of a colour map of the engine: the blue, the green and the red of a colour. */
function palette(colors: number[][]): Buffer {
	const out: Buffer = Buffer.alloc(colors.length * 3, 0x00);
	for (let place = 0; place < colors.length; place += 1) {
		const color = colors[place] ?? [0, 0, 0];
		out[place * 3] = color[2] ?? 0;
		out[place * 3 + 1] = color[1] ?? 0;
		out[place * 3 + 2] = color[0] ?? 0;
	}
	return out;
}

/** A picture of the places of a colour of the file itself, of the row of the display the last first. */
function cmFile(input: {
	width: number;
	height: number;
	pixelSize: number;
	colors?: number[][];
	compressed?: boolean;
	data: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x20, 0x00);
	head.write("CM", 0, "latin1");
	head.writeUInt16LE(input.width, 6);
	head.writeUInt16LE(input.height, 8);
	head.writeUInt16LE(input.colors?.length ?? 0, 0x0a);
	head.writeUInt8(8 * input.pixelSize, 0x0c);
	head.writeUInt8(input.compressed ? 1 : 0, 0x0d);
	head.writeUInt8(1, 0x0e);
	const paletteBytes = input.colors ? palette(input.colors) : Buffer.alloc(0);
	const dataOffset = 0x20 + paletteBytes.length;
	head.writeUInt32LE(dataOffset, 0x10);
	head.writeUInt32LE(
		input.compressed
			? input.data.length
			: input.width * input.height * input.pixelSize,
		0x14,
	);
	const body = Buffer.concat([paletteBytes, input.data]);
	head.writeUInt32LE(0x20 + body.length, 2);
	return Buffer.concat([head, body]);
}

/** A picture of an alpha of its own. */
function amFile(input: {
	width: number;
	height: number;
	maskWidth: number;
	maskHeight: number;
	pixelSize: number;
	colors?: number[][];
	compressed?: boolean;
	maskCompressed?: boolean;
	data: Buffer;
	alpha: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x30, 0x00);
	head.write("AM", 0, "latin1");
	head.writeUInt16LE(input.width, 6);
	head.writeUInt16LE(input.height, 8);
	head.writeUInt16LE(input.maskWidth, 0x0a);
	head.writeUInt16LE(input.maskHeight, 0x0c);
	head.writeUInt16LE(input.colors?.length ?? 0, 0x12);
	head.writeUInt8(8 * input.pixelSize, 0x14);
	head.writeUInt8(input.compressed ? 1 : 0, 0x15);
	head.writeUInt8(2, 0x16);
	head.writeUInt8(1, 0x18);
	const paletteBytes = input.colors ? palette(input.colors) : Buffer.alloc(0);
	const dataOffset = 0x30 + paletteBytes.length;
	const maskOffset = dataOffset + input.data.length;
	head.writeUInt32LE(dataOffset, 0x1a);
	head.writeUInt32LE(input.data.length, 0x1e);
	head.writeUInt32LE(maskOffset, 0x22);
	head.writeUInt32LE(input.alpha.length, 0x26);
	head.writeUInt8(input.maskCompressed ? 1 : 0, 0x2a);
	const body = Buffer.concat([paletteBytes, input.data, input.alpha]);
	head.writeUInt32LE(0x30 + body.length, 2);
	return Buffer.concat([head, body]);
}

/** A picture of the places of a colour map of the file. */
function mskFile(input: {
	width: number;
	height: number;
	compressed: boolean;
	data: Buffer;
	colors?: number[][];
}): Buffer {
	const head: Buffer = Buffer.alloc(0x10, 0x00);
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	head.writeInt32LE(input.compressed ? 1 : 0, 0x0c);
	const map: Buffer = Buffer.alloc(0x400, 0x00);
	const colors = input.colors ?? [];
	for (let place = 0; place < colors.length; place += 1) {
		const color = colors[place] ?? [0, 0, 0];
		map[place * 4] = color[2] ?? 0;
		map[place * 4 + 1] = color[1] ?? 0;
		map[place * 4 + 2] = color[0] ?? 0;
	}
	const size = input.compressed
		? 0x10 + map.length + input.data.length
		: input.width * input.height + 0x10 + map.length;
	head.writeUInt32LE(size, 0);
	return Buffer.concat([head, map, input.data]);
}

async function bytesOf(
	format: typeof maiCmImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "image");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a picture of 24 places to a place, of the rows of it the display first. */
function rows24(bytes: Buffer, width: number, height: number): number[] {
	const stride = (width * 3 + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * 3; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

describe("MAI engine image", () => {
	it("reads the head of a picture of the places of a colour of the file", () => {
		const data = cmFile({
			width: 2,
			height: 2,
			pixelSize: 3,
			data: Buffer.from([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]),
		});
		expect(readCmLayout(data)).toMatchObject({
			width: 2,
			height: 2,
			colors: 0,
			pixelSize: 3,
			compressed: false,
			dataOffset: 0x20,
			dataLength: 12,
		});
		// A picture of a count of the places of the file of its own.
		expect(
			readCmLayout(Buffer.concat([data, Buffer.alloc(1)])),
		).toBeUndefined();
	});

	it("reads the places of a picture of the places of a colour of the file", async () => {
		const data = cmFile({
			width: 2,
			height: 2,
			pixelSize: 3,
			data: Buffer.from([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]),
		});
		const bytes = await bytesOf(maiCmImageFormat, data);
		// The places of the picture stand of the row of the file the last first.
		expect(rows24(bytes, 2, 2)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("reads a picture of the places of a colour map of the file", async () => {
		const data = cmFile({
			width: 4,
			height: 1,
			pixelSize: 1,
			colors: [
				[0x11, 0x22, 0x33],
				[0x44, 0x55, 0x66],
			],
			compressed: true,
			// Two places of the file and a run of two of them of the place behind the first of them.
			data: Buffer.from([0x02, 0x00, 0x01, 0x82, 0x01]),
		});
		expect(readCmLayout(data)?.pixelSize).toBe(1);
		const bytes = await bytesOf(maiCmImageFormat, data);
		// The colour map of the picture stands at 0x36, of the places of the picture behind it.
		expect([...bytes.subarray(0x36, 0x3a)]).toEqual([0x33, 0x22, 0x11, 0x00]);
		const pixelsAt = 0x36 + 0x400;
		expect([...bytes.subarray(pixelsAt, pixelsAt + 4)]).toEqual([0, 1, 1, 1]);
	});

	it("reads the head of a picture of an alpha of its own", () => {
		const data = amFile({
			width: 2,
			height: 2,
			maskWidth: 2,
			maskHeight: 2,
			pixelSize: 3,
			data: Buffer.alloc(12, 0x11),
			alpha: Buffer.from([0, 0x10, 0x20, 0x30]),
		});
		expect(readAmLayout(data)).toMatchObject({
			width: 2,
			height: 2,
			colors: 0,
			pixelSize: 3,
			maskWidth: 2,
			maskHeight: 2,
			maskLength: 4,
		});
	});

	it("reads the places of a picture and of the alpha of it", async () => {
		const data = amFile({
			width: 2,
			height: 2,
			maskWidth: 2,
			maskHeight: 2,
			pixelSize: 3,
			data: Buffer.from([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]),
			// The places of the alpha of the picture stand of the row of the file the first first.
			alpha: Buffer.from([0x10, 0x20, 0x30, 0x40]),
		});
		const bytes = await bytesOf(maiAmImageFormat, data);
		// The places of the picture stand of the row of the display the first, of the alpha of the row of
		// the file of it the same row: the places of the alpha stand of no walk of their own.
		expect([...bytes.subarray(0x36, 0x36 + 16)]).toEqual([
			1, 2, 3, 0x10, 4, 5, 6, 0x20, 7, 8, 9, 0x30, 10, 11, 12, 0x40,
		]);
	});

	it("reads a picture of the places of a colour map and of the alpha of it", async () => {
		const data = amFile({
			width: 4,
			height: 1,
			maskWidth: 4,
			maskHeight: 1,
			pixelSize: 1,
			colors: [
				[0x00, 0xfe, 0x00],
				[0x10, 0x20, 0x30],
			],
			compressed: true,
			// Four places of the file.
			data: Buffer.from([0x04, 0x01, 0x00, 0x00, 0x01]),
			alpha: Buffer.from([0x01, 0x00, 0x00, 0x00]),
		});
		const bytes = await bytesOf(maiAmImageFormat, data);
		// The colour of the colour map of no alpha of its own stands of an alpha of nought; a place of the
		// alpha of the picture of nought behind it stands of an alpha of the whole place.
		expect([...bytes.subarray(0x36, 0x36 + 16)]).toEqual([
			0x30, 0x20, 0x10, 0x11, 0x00, 0xfe, 0x00, 0x00, 0x00, 0xfe, 0x00, 0x00,
			0x30, 0x20, 0x10, 0xff,
		]);
	});

	it("reads the head of a picture of a colour map of the file", () => {
		const data = mskFile({
			width: 4,
			height: 1,
			compressed: false,
			data: Buffer.from([0, 1, 1, 0]),
			colors: [
				[0x11, 0x22, 0x33],
				[0x44, 0x55, 0x66],
			],
		});
		expect(readMskLayout(data)).toMatchObject({
			width: 4,
			height: 1,
			compressed: false,
		});
		// A picture of no walk of the places of the picture of no count of places of its own.
		expect(
			readMskLayout(Buffer.concat([data, Buffer.alloc(1)])),
		).toBeUndefined();
	});

	it("reads the places of a picture of a colour map of the file", async () => {
		const data = mskFile({
			width: 4,
			height: 1,
			compressed: false,
			data: Buffer.from([0, 1, 1, 0]),
			colors: [
				[0x11, 0x22, 0x33],
				[0x44, 0x55, 0x66],
			],
		});
		const bytes = await bytesOf(maiMskImageFormat, data);
		expect([...bytes.subarray(0x36, 0x3a)]).toEqual([0x33, 0x22, 0x11, 0x00]);
		const pixelsAt = 0x36 + 0x400;
		expect([...bytes.subarray(pixelsAt, pixelsAt + 4)]).toEqual([0, 1, 1, 0]);
	});

	it("reads the places of a picture of the walks of a colour map of the file", async () => {
		const data = mskFile({
			width: 4,
			height: 1,
			compressed: true,
			// Two places of the file and a run of two of them of the place behind the first of them.
			data: Buffer.from([0x02, 0x00, 0x01, 0x82, 0x01]),
		});
		const bytes = await bytesOf(maiMskImageFormat, data);
		const pixelsAt = 0x36 + 0x400;
		expect([...bytes.subarray(pixelsAt, pixelsAt + 4)]).toEqual([0, 1, 1, 1]);
	});

	it("tells the pictures of the engine by the head of them", async () => {
		const cm = cmFile({
			width: 2,
			height: 2,
			pixelSize: 3,
			data: Buffer.alloc(12, 0x11),
		});
		expect(await maiCmImageFormat.detect?.(new BufferByteSource(cm))).toBe(
			true,
		);
		expect(await maiAmImageFormat.detect?.(new BufferByteSource(cm))).toBe(
			false,
		);
		expect(
			await maiMskImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x10, 0x00)),
			),
		).toBe(false);
		await expect(
			maiCmImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x10, 0x00)),
				"image",
			),
		).rejects.toThrow(GarbroError);
	});
});
