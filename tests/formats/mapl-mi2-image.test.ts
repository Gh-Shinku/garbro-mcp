import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { maplMi2ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readMi2Layout } from "../../packages/formats/src/mapl/mi2-image.js";

/** The head of a picture of the engine, of the places of the file of the head of it. */
function head(input: {
	width: number;
	height: number;
	bitsPerPixel: number;
	colors: number;
}): Buffer {
	const bytes: Buffer = Buffer.alloc(0x28, 0x00);
	bytes.writeUInt32LE(0x28, 0);
	bytes.writeUInt32LE(input.width, 4);
	bytes.writeUInt32LE(input.height, 8);
	bytes.writeUInt16LE(input.bitsPerPixel, 0x0e);
	bytes.writeInt32LE(input.colors, 0x20);
	return bytes;
}

/** A picture of the engine: the head of it, the colour map of it and the walks of the places of it. */
function mi2File(input: {
	bitsPerPixel: number;
	colors?: number;
	palette?: number[];
	body: Buffer;
	width?: number;
	height?: number;
}): Buffer {
	const colors = input.colors ?? 0;
	const palette = input.palette ?? [];
	const map: Buffer = Buffer.alloc(colors * 4, 0x00);
	for (let place = 0; place < Math.min(palette.length, colors); place += 1) {
		const color = palette[place] ?? 0;
		map[place * 4] = color & 0xff;
		map[place * 4 + 1] = (color >> 8) & 0xff;
		map[place * 4 + 2] = (color >> 16) & 0xff;
	}
	return Buffer.concat([
		head({
			width: input.width ?? 1,
			height: input.height ?? 1,
			bitsPerPixel: input.bitsPerPixel,
			colors,
		}),
		map,
		input.body,
	]);
}

async function bytesOf(data: Buffer): Promise<Buffer> {
	const handle = await maplMi2ImageFormat.open(
		new BufferByteSource(data),
		"image.mi2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The place of the picture of a colour map of the file: the colour map of it stands at 0x36. */
function pixelOfColorMap(bytes: Buffer): number {
	return bytes[0x36 + 0x400] ?? 0;
}

/** The places of the colours of the picture of the engine: the three places of the place of it. */
function colorsOf(bytes: Buffer): number[] {
	return [bytes[0x36] ?? 0, bytes[0x37] ?? 0, bytes[0x38] ?? 0];
}

/** The places of the file of a block of the walk of the places of the picture: the counts of four of them. */
const LITERALS: Buffer = Buffer.from(
	Array.from({ length: 64 }, (_, at) => at + 1),
);

describe("Mapl engine image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readMi2Layout(
			mi2File({ bitsPerPixel: 8, colors: 4, body: Buffer.alloc(0x40, 0x00) }),
		);
		expect(layout).toEqual({
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			colors: 4,
		});
		// The count of the words of the colour map of a picture of nought stands of the whole map, and a
		// picture of a count of the places of a colour the engine knows none of stands of no walk of it.
		expect(
			readMi2Layout(
				mi2File({ bitsPerPixel: 8, colors: 0, body: Buffer.alloc(0x40, 0x00) }),
			)?.colors,
		).toBe(0x100);
		expect(
			readMi2Layout(
				mi2File({
					bitsPerPixel: 32,
					colors: 0,
					body: Buffer.alloc(0x40, 0x00),
				}),
			),
		).toBeUndefined();
		expect(readMi2Layout(Buffer.alloc(0x28, 0x00))).toBeUndefined();
	});

	it("reads the places of the file of the walk of the places of the picture as they stand", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			palette: [0x332211, 0x665544],
			body: Buffer.concat([Buffer.from([0x00]), LITERALS]),
		});
		const bytes = await bytesOf(data);
		// The colour of the walk of the places of the picture stands of the colour map of it.
		expect(pixelOfColorMap(bytes)).toBe(0x01);
		expect([...bytes.subarray(0x36, 0x3a)]).toEqual([0x11, 0x22, 0x33, 0x00]);
		expect([...bytes.subarray(0x3a, 0x3e)]).toEqual([0x44, 0x55, 0x66, 0x00]);
	});

	it("reads the places of the colours of a picture of three channels", async () => {
		// The places of the file of the three walks of the picture stand of the blue, the green and the
		// red of every place of it.
		const channel = (value: number): Buffer =>
			Buffer.concat([Buffer.from([0x00]), Buffer.alloc(0x40, value)]);
		const data = mi2File({
			bitsPerPixel: 24,
			body: Buffer.concat([channel(0x11), channel(0x22), channel(0x33)]),
		});
		const bytes = await bytesOf(data);
		expect(colorsOf(bytes)).toEqual([0x11, 0x22, 0x33]);
	});

	it("reads the places of the file of the walk of the picture of one place of the file", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([Buffer.from([0x01, 0x77])]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0x77);
	});

	it("reads the places of the file of the walk of the picture of the masks of them", async () => {
		// The places of the file of the walk of the picture stand of the mask of the row of the block of
		// them: the places of the file of the walk behind it stand of the places of the picture itself.
		const masks = Buffer.concat([
			Buffer.from([0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
			Buffer.alloc(7, 0x30),
		]);
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([Buffer.from([0x02, 0x11]), masks]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0x11);
	});

	it("reads the places of the file of the walk of the picture of the two places of the mask of them", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x03, 0x22, 0x33]),
				Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0x33);
	});

	it("reads the places of the file of the walk of the picture of the counts of two places of the file", async () => {
		// Every count of the walk of the places of the file stands of two places of the file: the places of
		// the file of the walk stand of the three places of the file of the counts of them.
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x04, 0x44, 0x55, 0x66]),
				Buffer.alloc(0x10, 0xaa),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0x55);
		const five = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x05, 0x10, 0x20, 0x30, 0x40]),
				Buffer.alloc(0x10, 0xaa),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(five))).toBe(0x30);
	});

	it("reads the places of the file of the walk of the picture of the colour map of it", async () => {
		// The counts of three places of the file stand of the counts of the walks of the picture, of the
		// places of the file of the colour map of the walk behind them.
		const bits: Buffer = Buffer.alloc(0x18, 0x00);
		bits[0] = 0x20;
		const body = Buffer.concat([
			Buffer.from([0x06, 0x02, 0xa1, 0xb2]),
			bits,
			Buffer.alloc(63, 0x00),
		]);
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body,
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0xa1);
	});

	it("reads the places of the file of the walk of the picture of the counts of four places of the file", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x07, 0x01, 0xc3]),
				Buffer.concat([Buffer.from([0x10]), Buffer.alloc(0x1f, 0x00)]),
				Buffer.alloc(63, 0x00),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0xc3);
	});

	it("reads the places of the file of the walk of the picture of the counts of the places of the block of it", async () => {
		// The places of the file of the walk of the picture stand of the counts of the places of the block
		// of them, of one place of the file to a count: every place of the block stands of the places of the
		// file of it of one place of the display behind.
		const masks = Buffer.concat([
			Buffer.from([0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
			Buffer.alloc(7, 0x00),
		]);
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x08, 0x0f]),
				masks,
				Buffer.alloc(8, 0x00),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(data))).toBe(0x1e);
		const two = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([
				Buffer.from([0x09, 0x11, 0x21]),
				masks,
				Buffer.alloc(8, 0x00),
			]),
		});
		expect(pixelOfColorMap(await bytesOf(two))).toBe(0x42);
	});

	it("stands of the walks of the places of the file of the picture of no walk of the engine", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.alloc(0x40, 0x00),
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = mi2File({
			bitsPerPixel: 8,
			colors: 2,
			body: Buffer.concat([Buffer.from([0x01, 0x00])]),
		});
		expect(await maplMi2ImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await maplMi2ImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x28, 0x00)),
			),
		).toBe(false);
	});
});
