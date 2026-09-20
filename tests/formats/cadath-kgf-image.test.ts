import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	cadathKgfImageFormat,
	readKgfLayout,
	unpackKgfPicture,
} from "../../packages/formats/src/cadath/kgf-image.js";

const HEAD_SIZE = 0x1c;
const PACKED_SIZE_FIELD = 0x24;

function buildPicture(options: {
	width: number;
	height: number;
	bpp: number;
	mode: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("KGF", 0, "latin1");
	head.writeUInt32LE(options.width, 4);
	head.writeUInt32LE(options.height, 8);
	head.writeInt32LE(options.bpp, 0xc);
	head.writeInt32LE(options.mode, 0x10);
	return Buffer.concat([head, options.body]);
}

function packedPlaces(want: Buffer, bufferSize: number): Buffer {
	const control = Buffer.alloc(bufferSize >> 6);
	const words = Buffer.alloc(bufferSize >> 3);
	const literals = Buffer.alloc(want.length);
	let last = 0;
	for (let at = 0; at < want.length; at += 1) {
		literals[at] = (want[at] ?? 0) ^ last;
		last = want[at] ?? 0;
	}
	return Buffer.concat([control, words, literals]);
}

function packedBody(stream: Buffer, packedSize: number): Buffer {
	const at = PACKED_SIZE_FIELD - HEAD_SIZE;
	const sizes = Buffer.alloc(at + 4, 0x00);
	sizes.writeUInt32LE(packedSize, at);
	return Buffer.concat([sizes, stream]);
}

describe("Cadath image format", () => {
	it("reads the head of a picture", () => {
		const file = buildPicture({
			width: 8,
			height: 8,
			bpp: 32,
			mode: 0,
			body: Buffer.alloc(256),
		});
		expect(readKgfLayout(file, file.length)).toEqual({
			width: 8,
			height: 8,
			bitsPerPixel: 32,
			mode: 0,
			dataOffset: HEAD_SIZE,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		const good = buildPicture({
			width: 8,
			height: 8,
			bpp: 32,
			mode: 0,
			body: Buffer.alloc(256),
		});
		const wrongMark = Buffer.from(good);
		wrongMark.write("KGg", 0, "latin1");
		expect(readKgfLayout(wrongMark, wrongMark.length)).toBeUndefined();
		for (const bpp of [0, 8, 16, 48]) {
			const bad = Buffer.from(good);
			bad.writeInt32LE(bpp, 0xc);
			expect(readKgfLayout(bad, bad.length)).toBeUndefined();
		}
		for (const mode of [-1, 6, 9]) {
			const bad = Buffer.from(good);
			bad.writeInt32LE(mode, 0x10);
			expect(readKgfLayout(bad, bad.length)).toBeUndefined();
		}
		expect(readKgfLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of a picture of the kind of the places of the picture as they stand", () => {
		const places = Buffer.from([
			0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0x00,
		]);
		const file = buildPicture({
			width: 2,
			height: 1,
			bpp: 32,
			mode: 0,
			body: places,
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackKgfPicture(file, layout)).toEqual(places);
	});

	it("reads the places of a picture of the kind of the places of the picture of a place of the picture", () => {
		const places = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		]);
		const file = buildPicture({
			width: 2,
			height: 1,
			bpp: 32,
			mode: 1,
			body: places,
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackKgfPicture(file, layout)).toEqual(
			Buffer.from([0x01, 0x03, 0x05, 0x07, 0x02, 0x04, 0x06, 0x08]),
		);
	});

	it("reads the places of a picture of the kind of the places of the picture of the runs of them", () => {
		const bits = Buffer.from([0x04]);
		const stream = Buffer.from([0xa1, 0xb2, 0xc3, 0x03]);
		const file = buildPicture({
			width: 2,
			height: 1,
			bpp: 32,
			mode: 2,
			body: Buffer.concat([
				Buffer.from([3, 0, 0, 0]),
				Buffer.from([bits.length, 0, 0, 0]),
				Buffer.from([0, 0, 0, 0]),
				bits,
				stream,
			]),
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const out = unpackKgfPicture(file, layout);
		expect(out).toEqual(
			Buffer.from([0xa1, 0xc3, 0xc3, 0xc3, 0xb2, 0xc3, 0xc3, 0xc3]),
		);
		expect(out.subarray(0, 4)).toEqual(Buffer.from([0xa1, 0xc3, 0xc3, 0xc3]));
	});

	it("reads the places of a picture of the kind of the compression of the pictures of the engine", () => {
		const want = Buffer.from(
			Array.from({ length: 256 }, (_, i) => (i * 7 + 3) & 0xff),
		);
		const file = buildPicture({
			width: 8,
			height: 8,
			bpp: 32,
			mode: 3,
			body: packedBody(packedPlaces(want, 256), 256),
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackKgfPicture(file, layout)).toEqual(want);
	});

	it("reads the places of a picture of the kind of the compression of the pictures of the engine beside the places of the picture of a place of the picture", () => {
		const want = Buffer.from(
			Array.from({ length: 256 }, (_, i) => (i & 0x0f) | 0x20),
		);
		const file = buildPicture({
			width: 8,
			height: 8,
			bpp: 32,
			mode: 4,
			body: packedBody(packedPlaces(want, 256), 256),
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const out = unpackKgfPicture(file, layout);
		const expectOut = Buffer.alloc(256);
		for (let at = 0; at < 64; at += 1) {
			for (let channel = 0; channel < 4; channel += 1)
				expectOut[at * 4 + channel] = want[channel * 64 + at] ?? 0;
		}
		expect(out).toEqual(expectOut);
	});

	it("reads the places of a picture of the kind of the compression of the pictures of the engine of the places of the picture beside them", () => {
		const width = 8;
		const height = 16;
		const deltas = Buffer.alloc(512, 0);
		for (let channel = 0; channel < 4; channel += 1) {
			for (let column = 0; column < width; column += 1)
				deltas[channel * width * height + column] =
					(channel + column + 1) & 0xff;
		}
		const file = buildPicture({
			width,
			height,
			bpp: 32,
			mode: 5,
			body: packedBody(packedPlaces(deltas, 512), 512),
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const out = unpackKgfPicture(file, layout);
		for (let row = 0; row < height; row += 1) {
			for (let channel = 0; channel < 4; channel += 1) {
				for (let column = 0; column < width; column += 1) {
					expect(
						out[(row * width + column) * 4 + channel],
						`row ${row} channel ${channel} column ${column}`,
					).toBe((channel + column + 1) & 0xff);
				}
			}
		}
	});

	it("stands the places of a picture out as a picture of the places of a picture of its own", async () => {
		const places = Buffer.from([
			0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0x00,
		]);
		const file = buildPicture({
			width: 2,
			height: 1,
			bpp: 32,
			mode: 0,
			body: places,
		});
		const handle = await cadathKgfImageFormat.open(
			new BufferByteSource(file),
			"picture.kgf",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(-1);
		expect(bmp.subarray(0x36, 0x36 + 8)).toEqual(places);
	});

	it("turns a picture cut short of the places of its walk away", () => {
		const file = buildPicture({
			width: 8,
			height: 8,
			bpp: 32,
			mode: 0,
			body: Buffer.alloc(16),
		});
		const layout = readKgfLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackKgfPicture(file, layout)).toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(cadathKgfImageFormat.descriptor.id).toBe("cadath-kgf-image");
		const file = buildPicture({
			width: 2,
			height: 1,
			bpp: 32,
			mode: 0,
			body: Buffer.alloc(8),
		});
		await expect(
			cadathKgfImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(file);
		wrongMark.write("KGg", 0, "latin1");
		await expect(
			cadathKgfImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
