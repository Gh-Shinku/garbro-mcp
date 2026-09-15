import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeMoe,
	greyRampPalette,
	isValidMoeInput,
	ivoryMoeImageFormat,
	readMoeLayout,
} from "../../packages/formats/src/ivory/moe-image.js";

const DATA_OFFSET = 0x36;
const GREY_PALETTE_SIZE = 0x400;
const GREY_DATA_OFFSET = 0x36 + GREY_PALETTE_SIZE;

/** A run of pixels that stand in the stream themselves. */
function raw(...pixels: number[][]): Buffer {
	return Buffer.from([0x80 | pixels.length, ...pixels.flat()]);
}

/** A run that repeats the pixel behind it, which stands in the stream once. */
function repeat(count: number, pixel: number[]): Buffer {
	return Buffer.from([count, ...pixel]);
}

/** A whole file: the measurements and the stream behind them. */
function moeFile(width: number, height: number, stream: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(4, 0x00);
	head.writeUInt32LE((width & 0xffff) | ((height & 0xffff) << 16), 0);
	return Buffer.concat([head, stream]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.moe"): Promise<Buffer> {
	const handle = await ivoryMoeImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap, row by row. */
function pixelRows(
	bitmap: Buffer,
	width: number,
	height: number,
	bytesPerPixel: number,
	offset = DATA_OFFSET,
): string[] {
	const stride = (width * bytesPerPixel + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					offset + row * stride,
					offset + row * stride + width * bytesPerPixel,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("Ivory picture format", () => {
	it("finds a picture by the measurements at its front", async () => {
		const data = moeFile(2, 1, raw([1, 2, 3], [4, 5, 6]));
		expect(await ivoryMoeImageFormat.detect(sourceOf(data), "cg.moe")).toBe(
			true,
		);
		expect(readMoeLayout(data, false)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
		});
		// The picture may measure up to eight hundred by six hundred and not a pixel less than one.
		expect(
			readMoeLayout(moeFile(0, 1, Buffer.alloc(4)), false),
		).toBeUndefined();
		expect(
			readMoeLayout(moeFile(801, 1, Buffer.alloc(4)), false),
		).toBeUndefined();
		expect(
			readMoeLayout(moeFile(1, 0, Buffer.alloc(4)), false),
		).toBeUndefined();
		expect(
			readMoeLayout(moeFile(1, 601, Buffer.alloc(4)), false),
		).toBeUndefined();
		expect(readMoeLayout(Buffer.alloc(3, 0x00), false)).toBeUndefined();
	});

	it("takes the depth of the picture from the name of the file", async () => {
		const grey = moeFile(2, 1, raw([1], [2]));
		expect(readMoeLayout(grey, true)?.bitsPerPixel).toBe(8);
		const colour = moeFile(2, 1, raw([1, 2, 3], [4, 5, 6]));
		expect(readMoeLayout(colour, false)?.bitsPerPixel).toBe(24);
		// A file named `.shw` holds a grey picture, and the letters of the name may stand either way.
		const handle = await ivoryMoeImageFormat.open(sourceOf(grey), "cg.SHW");
		expect(handle.entries[0]?.metadata).toMatchObject({
			bitsPerPixel: 8,
			width: 2,
			height: 1,
		});
		expect(handle.metadata).toMatchObject({ bitsPerPixel: 8 });
		const lower = await ivoryMoeImageFormat.open(sourceOf(grey), "cg.shw");
		expect(lower.metadata).toMatchObject({ bitsPerPixel: 8 });
	});

	it("walks the stream to see whether it holds a whole picture", () => {
		const stream = Buffer.concat([
			raw([1, 2, 3], [4, 5, 6], [7, 8, 9]),
			repeat(2, [4, 5, 6]),
		]);
		const data = moeFile(5, 1, stream);
		expect(isValidMoeInput(data, 5, 1, 3)).toBe(true);
		// A walk that would ask for a pixel past the stream leaves the picture turned away.
		expect(isValidMoeInput(data, 6, 1, 3)).toBe(false);
		expect(isValidMoeInput(data.subarray(0, 12), 5, 1, 3)).toBe(false);
	});

	it("writes the pixels of a picture of three channels out as they stand", async () => {
		const data = moeFile(
			2,
			2,
			Buffer.concat([raw([1, 2, 3], [4, 5, 6]), repeat(2, [7, 8, 9])]),
		);
		const bitmap = await extract(data);
		expect(bitmap.readUInt16LE(0x1c)).toBe(24);
		expect(bitmap.readInt32LE(0x16)).toBe(-2);
		expect(pixelRows(bitmap, 2, 2, 3)).toEqual([
			"010203040506",
			"070809070809",
		]);
	});

	it("repeats the pixel behind a run as many times as the run says", async () => {
		// A run of one pixel and then a run of five that repeats it.
		const data = moeFile(
			6,
			1,
			Buffer.concat([raw([9, 8, 7]), repeat(5, [1, 2, 3])]),
		);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 6, 1, 3)).toEqual([
			"090807010203010203010203010203010203",
		]);
	});

	it("writes a grey picture out with its ramp of seventeen shades", async () => {
		const data = moeFile(2, 1, raw([0x00], [0x10]));
		const bitmap = await extract(data, "cg.shw");
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(bitmap.readUInt32LE(0x2e)).toBe(0x100);
		// The ramp holds seventeen shades, black at the front and white at the back, and nothing behind them.
		expect(bitmap.subarray(DATA_OFFSET, DATA_OFFSET + 8).toString("hex")).toBe(
			"000000000f0f0f00",
		);
		expect(bitmap.readUInt32LE(DATA_OFFSET + 0x10 * 4)).toBe(0x00ffffff);
		expect(bitmap.readUInt32LE(DATA_OFFSET + 0x11 * 4)).toBe(0x00000000);
		expect(
			bitmap.subarray(GREY_DATA_OFFSET, GREY_DATA_OFFSET + 2).toString("hex"),
		).toBe("0010");
	});

	it("turns away a picture the stream does not hold all of", async () => {
		// A stream that runs out inside the picture never reaches the reading of it: the walk leaves it turned
		// away, which is what the reference's own metadata pass does as well.
		const data = moeFile(2, 1, raw([1, 2, 3]));
		expect(await ivoryMoeImageFormat.detect(sourceOf(data), "cg.moe")).toBe(
			false,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow("Not an Ivory picture");
	});

	it("refuses a stream that runs out inside the picture where it is read", () => {
		// Reading a picture on its own, without the walk in front of it: a stream that ends where a control
		// byte is wanted is refused, and so is a run of no pixels or one that writes past the picture.
		const layout = { width: 2, height: 1, bitsPerPixel: 24, bytesPerPixel: 3 };
		expect(() => decodeMoe(moeFile(2, 1, raw([1, 2, 3])), layout)).toThrow(
			"Ivory picture is cut short of its stream",
		);
		expect(() =>
			decodeMoe(moeFile(2, 1, repeat(0, [1, 2, 3])), layout),
		).toThrow("Ivory picture holds a run of no pixels");
		expect(() =>
			decodeMoe(moeFile(2, 1, repeat(5, [1, 2, 3])), layout),
		).toThrow("Ivory picture writes past its own end");
	});

	it("reads the pixels of a picture of one pixel on its own", () => {
		const data = moeFile(1, 1, raw([0x21, 0x22]));
		const layout = readMoeLayout(data, true);
		if (!layout) throw new Error("no layout");
		// The picture holds one pixel of one byte, and the run behind it holds two of them.
		expect(decodeMoe(data, layout).toString("hex")).toBe("21");
		expect(greyRampPalette().readUInt32LE(0x10 * 4)).toBe(0x00ffffff);
	});
});
