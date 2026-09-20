import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	advsysGr2ImageFormat,
	readGr2Layout,
	unpackGr2Picture,
} from "../../packages/formats/src/advsys/gr2-image.js";

const HEAD_SIZE = 0x10;

function strideOf(width: number, bitsPerPixel: number): number {
	return (width * (bitsPerPixel / 8) + 3) & ~3;
}

function buildPicture(options?: {
	width?: number;
	height?: number;
	bitsPerWord?: number;
	extra?: number;
}): Buffer {
	const width = options?.width ?? 2;
	const height = options?.height ?? 2;
	const bitsPerWord = options?.bitsPerWord ?? 4;
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("GR2_", 0, "latin1");
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	head.writeInt16LE(bitsPerWord, 0xc);
	const size = strideOf(width, bitsPerWord * 8) * height;
	const pixels = Buffer.alloc(size, 0x00);
	for (let at = 0; at < size; at += 1) pixels[at] = (at * 7 + 3) & 0xff;
	const rowStride = strideOf(width, bitsPerWord * 8);
	const used = (width * (bitsPerWord * 8)) / 8;
	for (let row = 0; row < height; row += 1) {
		pixels.fill(0x00, row * rowStride + used, (row + 1) * rowStride);
	}
	return Buffer.concat([head, pixels, Buffer.alloc(options?.extra ?? 0, 0xaa)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await advsysGr2ImageFormat.open(
		new BufferByteSource(data),
		"picture.gr2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("AdvSys engine image format", () => {
	it("reads the head of a picture", () => {
		expect(readGr2Layout(buildPicture({ width: 2, height: 2 }), 0x20)).toEqual({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			stride: 8,
		});
		expect(
			readGr2Layout(buildPicture({ width: 3, height: 1 }), 0x20),
		).toMatchObject({ bitsPerPixel: 32, stride: 12 });
		expect(
			readGr2Layout(
				buildPicture({ width: 3, height: 1, bitsPerWord: 2 }),
				0x20,
			),
		).toMatchObject({ bitsPerPixel: 16, stride: 8 });
		expect(
			readGr2Layout(
				buildPicture({ width: 3, height: 1, bitsPerWord: 3 }),
				0x20,
			),
		).toMatchObject({ bitsPerPixel: 24, stride: 12 });
	});

	it("turns away a head that names no picture of this kind", () => {
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("GR3_", 0, "latin1");
		expect(readGr2Layout(wrongMark, 0x20)).toBeUndefined();
		expect(
			readGr2Layout(buildPicture({ bitsPerWord: 1 }), 0x20),
		).toBeUndefined();
		expect(
			readGr2Layout(buildPicture({ bitsPerWord: 5 }), 0x20),
		).toBeUndefined();
		expect(readGr2Layout(buildPicture({ width: 0 }), 0x20)).toBeUndefined();
		expect(readGr2Layout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of a picture as they stand", () => {
		const data = buildPicture({ width: 2, height: 2 });
		const layout = readGr2Layout(data, data.length);
		if (!layout) throw new Error("no layout");
		const places = unpackGr2Picture(data, layout);
		expect(places.length).toBe(16);
		expect(places[0]).toBe(0x03);
		expect(places[15]).toBe((15 * 7 + 3) & 0xff);
		const longer = buildPicture({ width: 2, height: 2, extra: 5 });
		const longerLayout = readGr2Layout(longer, longer.length);
		if (!longerLayout) throw new Error("no layout");
		expect(unpackGr2Picture(longer, longerLayout)).toEqual(places);
	});

	it("turns a picture cut short of its places away", async () => {
		const cut = Buffer.from(
			buildPicture({ width: 2, height: 2 }).subarray(0, 0x18),
		);
		await expect(extract(cut)).rejects.toThrow(GarbroError);
	});

	it("stands a picture of two and thirty places out", async () => {
		const data = buildPicture({ width: 2, height: 2 });
		const bmp = await extract(data);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect(bmp.subarray(0x36)).toEqual(
			data.subarray(HEAD_SIZE, HEAD_SIZE + 16),
		);
	});

	it("stands a picture of four and twenty places out without the places of the row behind it", async () => {
		const data = buildPicture({ width: 3, height: 2, bitsPerWord: 3 });
		const bmp = await extract(data);
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		const first = data.subarray(HEAD_SIZE, HEAD_SIZE + 9);
		const second = data.subarray(HEAD_SIZE + 12, HEAD_SIZE + 21);
		const at = bmp.indexOf(first);
		expect(at).toBeGreaterThanOrEqual(0x36);
		expect(bmp.indexOf(second)).toBe(at + 12);
	});

	it("stands a picture of sixteen places out", async () => {
		const data = buildPicture({ width: 3, height: 1, bitsPerWord: 2 });
		const bmp = await extract(data);
		expect(bmp.readUInt16LE(0x1c)).toBe(16);
		const pixels = data.subarray(HEAD_SIZE, HEAD_SIZE + 8);
		expect(bmp.includes(pixels)).toBe(true);
	});

	it("is told by the words of the picture", async () => {
		expect(advsysGr2ImageFormat.descriptor.id).toBe("advsys-gr2-image");
		await expect(
			advsysGr2ImageFormat.detect(new BufferByteSource(buildPicture())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("GR3_", 0, "latin1");
		await expect(
			advsysGr2ImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
