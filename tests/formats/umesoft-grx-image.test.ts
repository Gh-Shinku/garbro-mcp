import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	grxOutputDepth,
	readGrxLayout,
	umesoftGrxImageFormat,
	unpackGrx,
} from "../../packages/formats/src/umesoft/grx-image.js";

const HEADER_SIZE = 0x10;

/** A run of pixels that stand in the stream themselves. */
function raw(pixels: number[], bytesPerPixel = 1): Buffer {
	const count = pixels.length / bytesPerPixel;
	const head = countFlag(count, 0x08);
	return Buffer.concat([Buffer.from(head), Buffer.from(pixels)]);
}

/** A run repeating the pixel the stream brings. */
function repeat(pixel: number[], count: number): Buffer {
	const head = countFlag(count, 0x00);
	return Buffer.concat([Buffer.from(head), Buffer.from(pixel)]);
}

/** A run copied from a place behind, a whole run at a time. */
function block(index: number, count: number): Buffer {
	return Buffer.from(countFlag(count, 0x08 | (index << 4)));
}

/** A run copied from a place behind, a pixel at a time. */
function single(index: number, count: number): Buffer {
	return Buffer.from(countFlag(count, index << 4));
}

/** The control byte of a run, and the byte behind it where the count needs one. */
function countFlag(count: number, flags: number): number[] {
	const low = count - 1;
	if (low < 4) return [flags | low];
	return [flags | 0x04 | (low & 3), (low - (low & 3)) >> 2];
}

interface FileParts {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The runs of the picture, a row at a time. */
	rows: Buffer[];
	packed?: boolean;
	alpha?: Buffer;
	alphaOffset?: number;
	/** The runs of the plane of alpha, which are one byte to a pixel. */
	alphaRows?: Buffer[];
}

/** A whole file: the header, the rows of the picture and the plane of alpha behind them. */
function grxFile(parts: FileParts): Buffer {
	const packed = parts.packed ?? true;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	Buffer.from([0x47, 0x52, 0x58, 0x1a]).copy(head, 0);
	head[4] = packed ? 1 : 0;
	head[5] = parts.alpha ? 1 : 0;
	head.writeUInt16LE(parts.bitsPerPixel, 6);
	head.writeUInt16LE(parts.width, 8);
	head.writeUInt16LE(parts.height, 10);
	const rows = Buffer.concat(parts.rows);
	head.writeInt32LE(parts.alpha ? (parts.alphaOffset ?? rows.length) : 0, 12);
	return Buffer.concat([
		head,
		rows,
		parts.alphaRows
			? Buffer.concat(parts.alphaRows)
			: (parts.alpha ?? Buffer.alloc(0)),
	]);
}

/** A picture that stands in the file as it is, four bytes to the pixel. */
function plainFile(width: number, height: number, pixels: number[]): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	Buffer.from([0x47, 0x52, 0x58, 0x1a]).copy(head, 0);
	head[4] = 0;
	head[5] = 0;
	head.writeUInt16LE(24, 6);
	head.writeUInt16LE(width, 8);
	head.writeUInt16LE(height, 10);
	return Buffer.concat([head, Buffer.from(pixels)]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.grx"): Promise<Buffer> {
	const handle = await umesoftGrxImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of four bytes to the pixel, row by row. */
function pixelRows(
	bitmap: Buffer,
	width: number,
	height: number,
	bytesPerPixel = 4,
	offset = 0x36,
): string[] {
	// The rows of a bitmap are aligned to a whole four bytes like every other bitmap here.
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

describe("U-Me Soft picture format", () => {
	it("finds a picture by its four bytes", async () => {
		const data = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [raw([1, 2, 3, 4])],
		});
		expect(await umesoftGrxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		expect(readGrxLayout(data)).toMatchObject({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			packed: true,
		});
		// The depth has to be one the reader knows, and the picture has to measure something.
		const odd = Buffer.from(data);
		odd.writeUInt16LE(12, 6);
		expect(readGrxLayout(odd)).toBeUndefined();
		const flat = Buffer.from(data);
		flat.writeUInt16LE(0, 8);
		expect(readGrxLayout(flat)).toBeUndefined();
		const short = Buffer.from(data);
		short.writeUInt16LE(0, 10);
		expect(readGrxLayout(short)).toBeUndefined();
		expect(readGrxLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
	});

	it("reports the depth it writes out rather than the one the picture holds", async () => {
		const data = grxFile({
			width: 1,
			height: 1,
			bitsPerPixel: 24,
			rows: [raw([1, 2, 3, 0x00], 4)],
		});
		const handle = await umesoftGrxImageFormat.open(
			sourceOf(data),
			"dir/cg.grx",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		// A picture of three bytes to the pixel is written out with four, which is what the reference does.
		expect(handle.metadata).toMatchObject({
			width: 1,
			height: 1,
			bitsPerPixel: 32,
		});
		expect(readGrxLayout(data)?.bitsPerPixel).toBe(24);
		expect(
			grxOutputDepth({
				width: 1,
				height: 1,
				bitsPerPixel: 16,
				packed: true,
				alpha: false,
				alphaOffset: 0,
			}),
		).toBe(16);
	});

	it("reads the pixels of a picture that stands in the file as they are", async () => {
		const data = plainFile(
			2,
			1,
			[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
		);
		const bitmap = await extract(data);
		expect(bitmap.readUInt16LE(0x1c)).toBe(32);
		expect(pixelRows(bitmap, 2, 1)).toEqual(["0102030405060708"]);
	});

	it("reads a row of runs that stand in the stream and copy from above", async () => {
		// A picture eight pixels wide and two rows deep: the first row stands in the stream, and the second
		// copies the whole row from above a byte at a time.
		const data = grxFile({
			width: 8,
			height: 2,
			bitsPerPixel: 8,
			rows: [raw([1, 2, 3, 4, 5, 6, 7, 8]), block(1, 8)],
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 8, 2, 1, 0x436)).toEqual([
			"0102030405060708",
			"0102030405060708",
		]);
	});

	it("repeats the pixel a run brings and copies one pixel at a time", async () => {
		// A picture four pixels wide and two rows deep: the first row brings one pixel, repeats it, and then
		// copies the pixel two behind it one at a time, which is the pixel it has just written.
		const data = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [Buffer.concat([raw([9]), repeat([7], 2), single(4, 1)])],
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 4, 1, 1, 0x436)).toEqual(["09070707"]);
	});

	it("packs the rows of a picture whose width is not a whole four", async () => {
		// A picture six pixels wide: the reference keeps its rows eight bytes long, and the port packs them.
		const data = grxFile({
			width: 6,
			height: 2,
			bitsPerPixel: 8,
			rows: [raw([1, 2, 3, 4, 5, 6]), raw([7, 8, 9, 10, 11, 12])],
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 6, 2, 1, 0x436)).toEqual([
			"010203040506",
			"0708090a0b0c",
		]);
	});

	it("takes the plane of alpha as the fourth byte of a picture of three", async () => {
		const data = grxFile({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			rows: [raw([0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 3)],
			alpha: Buffer.alloc(0),
			alphaRows: [raw([0x99, 0x88])],
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 2, 1)).toEqual([
			"3322119944556688"
				.replace("33221199", "11223399")
				.replace("44556688", "44556688"),
		]);
	});

	it("stretches the colours of a picture of two that carries alpha", async () => {
		// Two pixels of the high colour kind, one of them white and one of them the purest red.
		const data = grxFile({
			width: 2,
			height: 1,
			bitsPerPixel: 16,
			rows: [raw([0xff, 0xff, 0x00, 0xf8], 2)],
			alpha: Buffer.alloc(0),
			alphaRows: [raw([0x80, 0x40])],
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 2, 1)).toEqual(["ffffff800000ff40"]);
	});

	it("refuses a run that copies from before the start of the picture", async () => {
		// The first run of the picture copies the row above it, where there is none.
		const data = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [block(1, 4)],
		});
		expect(await umesoftGrxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"U-Me Soft picture copies from before its start",
		);
	});

	it("refuses a stream that runs out inside the picture", () => {
		const data = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [Buffer.from([0x08, 1, 2])],
		});
		const layout = readGrxLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackGrx(data, layout, 0)).toThrow(
			"U-Me Soft picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = grxFile({
			width: 0xffff,
			height: 0xffff,
			bitsPerPixel: 8,
			rows: [raw([1])],
		});
		expect(await umesoftGrxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the runs of a picture of one pixel on its own", () => {
		const data = grxFile({
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			rows: [raw([0x5a])],
		});
		const layout = readGrxLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGrx(data, layout, 0).pixels.toString("hex")).toBe("5a");
	});
});
