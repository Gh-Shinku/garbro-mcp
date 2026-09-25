import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { izumiMai2ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readMai2Layout } from "../../packages/formats/src/izumi/mai2-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** A picture of the engine: the mark, the head of it and the walks of the planes behind them. */
function mai2File(input: {
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	flags: number;
	planes: Buffer[];
	palette?: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x14, 0x00);
	head.write("MAI2", 0, "latin1");
	const place = (input.offsetY ?? 0) * 0x50 + (input.offsetX ?? 0);
	head.writeUInt16LE(place, 4);
	head.writeUInt16LE(input.width / 8, 6);
	head.writeUInt16LE(input.height, 8);
	head.writeUInt8(input.flags, 0xa);
	for (let plane = 0; plane < 4; plane += 1) {
		head.writeUInt16LE(input.planes[plane]?.length ?? 0, 0xc + plane * 2);
	}
	const body: Buffer[] = [];
	if (input.palette) body.push(input.palette);
	for (const plane of input.planes) body.push(plane);
	return Buffer.concat([head, ...body]);
}

/** The colours of a picture of four places to a place, of the places of the file. */
function paletteBytes(colors: number[][]): Buffer {
	const out: number[] = [];
	const bits: number[] = [];
	for (const color of colors) {
		for (const channel of color) {
			bits.push(
				(channel >> 3) & 1,
				(channel >> 2) & 1,
				(channel >> 1) & 1,
				channel & 1,
			);
		}
	}
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1)
			value = (value << 1) | (bits[at + bit] ?? 0);
		out.push(value);
	}
	return Buffer.from(out);
}

async function pictureOf(data: Buffer) {
	const handle = await izumiMai2ImageFormat.open(
		new BufferByteSource(data),
		"cg.mai",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const bytes = await consumeBuffer(await handle.openEntry(entry.id));
	const image = readBmpImage(bytes);
	if (!image) throw new Error("the port handed over no picture");
	return { image, bytes };
}

describe("Izumi engine image", () => {
	it("reads the head of a picture", () => {
		const layout = readMai2Layout(
			mai2File({
				width: 8,
				height: 2,
				offsetX: 3,
				offsetY: 4,
				flags: 0x8f,
				planes: [
					Buffer.from([0xf1, 0xff]),
					Buffer.alloc(0),
					Buffer.alloc(0),
					Buffer.alloc(0),
				],
			}),
		);
		expect(layout).toEqual({
			width: 8,
			height: 2,
			offsetX: 3,
			offsetY: 4,
			flags: 0x8f,
			hasPalette: true,
			planeSizes: [2, 0, 0, 0],
		});
		const stray = Buffer.from(
			mai2File({ width: 8, height: 2, flags: 0, planes: [Buffer.alloc(0)] }),
		);
		stray.write("MAI3", 0, "latin1");
		expect(readMai2Layout(stray)).toBeUndefined();
		expect(readMai2Layout(Buffer.alloc(0x14, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture of one plane of them", async () => {
		// A plane of one place: a walk of one place as it stands, and then the places of the picture of
		// the plane itself.
		const { image } = await pictureOf(
			mai2File({
				width: 8,
				height: 1,
				flags: 1,
				planes: [Buffer.from([0xf1, 0x81])],
			}),
		);
		expect(image.bitsPerPixel).toBe(4);
		expect([...image.pixels]).toEqual([0x10, 0x00, 0x00, 0x01]);
	});

	it("reads the places of a picture of the places of the planes behind them", async () => {
		// The second plane stands of the places of the first.
		const { image } = await pictureOf(
			mai2File({
				width: 8,
				height: 1,
				flags: 3,
				planes: [Buffer.from([0xf1, 0x81]), Buffer.from([0x41])],
			}),
		);
		expect([...image.pixels]).toEqual([0x30, 0x00, 0x00, 0x03]);
	});

	it("reads a picture whose planes stand of the places of the plane before them", async () => {
		// Two columns of two places each: the walk of the second column stands of the places of the
		// first, of the places of a column before it.
		const { image } = await pictureOf(
			mai2File({
				width: 16,
				height: 2,
				flags: 1,
				planes: [Buffer.from([0xf2, 0x81, 0x40, 0xe2])],
			}),
		);
		expect(image.bitsPerPixel).toBe(4);
		expect([...image.pixels]).toEqual([
			0x10, 0x00, 0x00, 0x01, 0x10, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00,
			0x01, 0x00, 0x00, 0x00,
		]);
	});

	it("reads the places of a picture of the walks of the planes of it", async () => {
		// The first plane stands of a run of one place, the second of the places of the first the other
		// way round, the third of no place of its own and the fourth of the places of the first two
		// together.
		const { image } = await pictureOf(
			mai2File({
				width: 8,
				height: 1,
				flags: 15,
				planes: [
					Buffer.from([0xfa, 0x01, 0xff]),
					Buffer.from([0xfb, 0x01]),
					Buffer.from([0xf9, 0x01]),
					Buffer.from([0xff, 0x01]),
				],
			}),
		);
		expect([...image.pixels]).toEqual([0x99, 0x99, 0x99, 0x99]);
	});

	it("reads the colours of a picture of the places of the file", async () => {
		const colors: number[][] = [];
		for (let at = 0; at < 16; at += 1) colors.push([at, 0, 0]);
		colors[1] = [1, 2, 3];
		const { bytes } = await pictureOf(
			mai2File({
				width: 8,
				height: 1,
				flags: 0x81,
				planes: [Buffer.from([0xf1, 0x00])],
				palette: paletteBytes(colors),
			}),
		);
		// The colour map of the bitmap stands of four places to a colour, of the places of the file.
		expect([...bytes.subarray(0x36 + 4, 0x36 + 8)]).toEqual([
			0x33, 0x22, 0x11, 0x00,
		]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = mai2File({
			width: 8,
			height: 1,
			flags: 1,
			planes: [Buffer.from([0xf1, 0x81])],
		});
		expect(
			await izumiMai2ImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		expect(
			await izumiMai2ImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x14, 0x00)),
			),
		).toBe(false);
		await expect(
			izumiMai2ImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x14, 0x00)),
				"cg.mai",
			),
		).rejects.toThrow(GarbroError);
	});
});
