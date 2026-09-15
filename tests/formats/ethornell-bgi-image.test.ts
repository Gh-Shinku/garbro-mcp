import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	bgiPixelBytes,
	ethornellBgiImageFormat,
	readBgiLayout,
	restoreBgiPixels,
} from "../../packages/formats/src/ethornell/bgi-image.js";

const HEADER_SIZE = 0x10;
const DATA_OFFSET = 0x36;
/** Where a grey picture keeps its pixels, behind the colour map the writer gives it. */
const GREY_DATA_OFFSET = 0x36 + 1024;

interface HeaderParts {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	flag?: number;
	/** Eight bytes that are not the nothing the reference wants. */
	dirty?: boolean;
}

/** The sixteen bytes the engine begins a picture with. */
function bgiHeader(parts: HeaderParts = {}): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt16LE(parts.width ?? 2, 0);
	head.writeInt16LE(parts.height ?? 2, 2);
	head.writeInt16LE(parts.bitsPerPixel ?? 24, 4);
	head.writeInt16LE(parts.flag ?? 0, 6);
	if (parts.dirty) head.writeBigInt64LE(1n, 8);
	return head;
}

/** A picture whose pixels stand as they are. */
function plainFile(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixels: Buffer,
): Buffer {
	return Buffer.concat([bgiHeader({ width, height, bitsPerPixel }), pixels]);
}

/**
 * The walk of `RestorePixels` run the other way: every plane is a row that goes forwards, a row that goes
 * backwards, and a sum that runs on across the turn, and each byte is the step from the one before it.
 */
function scramble(
	pixels: Buffer,
	width: number,
	height: number,
	bytesPerPixel: number,
): Buffer {
	const out: Buffer = Buffer.alloc(pixels.length, 0x00);
	let position = 0;
	for (let plane = 0; plane < bytesPerPixel; plane += 1) {
		let previous = 0;
		for (let row = 0; row < height; row += 1) {
			const forward = 0 === row % 2;
			for (let index = 0; index < width; index += 1) {
				const x = forward ? index : width - 1 - index;
				const value = pixels[(row * width + x) * bytesPerPixel + plane] ?? 0;
				out[position] = (value - previous) & 0xff;
				position += 1;
				previous = value;
			}
		}
	}
	return out;
}

/** A picture whose pixels are running sums over a walk that turns at every row. */
function scrambledFile(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixels: Buffer,
): Buffer {
	return Buffer.concat([
		bgiHeader({ width, height, bitsPerPixel, flag: 1 }),
		scramble(pixels, width, height, bitsPerPixel >> 3),
	]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bgi"): Promise<Buffer> {
	const handle = await ethornellBgiImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap the size of a picture, row by row as the writer stored them. */
function pixelRows(
	bitmap: Buffer,
	width: number,
	height: number,
	offset = DATA_OFFSET,
): string[] {
	const stride = (width * 3 + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(offset + row * stride, offset + row * stride + width * 3)
				.toString("hex"),
		);
	}
	return rows;
}

const PIXELS: Buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe("BGI/Ethornell image format", () => {
	it("finds a picture by the words of its header", async () => {
		for (const bits of [8, 24, 32]) {
			const size = 2 * 2 * (bits >> 3);
			const data = plainFile(2, 2, bits, Buffer.alloc(size, 0x11));
			expect(
				await ethornellBgiImageFormat.detect(sourceOf(data), "cg.bgi"),
			).toBe(true);
		}
		// A picture of no width or height, of another depth, with another flag, or with eight bytes that are
		// not nothing is turned away.
		expect(readBgiLayout(bgiHeader({ width: 0 }))).toBeUndefined();
		expect(readBgiLayout(bgiHeader({ height: -1 }))).toBeUndefined();
		expect(readBgiLayout(bgiHeader({ bitsPerPixel: 16 }))).toBeUndefined();
		expect(readBgiLayout(bgiHeader({ flag: 2 }))).toBeUndefined();
		expect(readBgiLayout(bgiHeader({ dirty: true }))).toBeUndefined();
		expect(readBgiLayout(Buffer.alloc(HEADER_SIZE - 1, 0))).toBeUndefined();
	});

	it("reports the measurements of the header and whether the pixels are scrambled", async () => {
		const handle = await ethornellBgiImageFormat.open(
			sourceOf(plainFile(2, 2, 24, PIXELS)),
			"dir/cg.bgi",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "none",
			width: 2,
			height: 2,
		});
		const scrambled = await ethornellBgiImageFormat.open(
			sourceOf(scrambledFile(2, 2, 24, PIXELS)),
			"dir/cg.bgi",
		);
		expect(scrambled.metadata).toMatchObject({ compression: "delta" });
	});

	it("hands on the pixels of a picture that stands as it is", async () => {
		const bitmap = await extract(plainFile(2, 2, 24, PIXELS));
		expect(bitmap.readUInt16LE(0x1c)).toBe(24);
		expect(bitmap.readInt32LE(0x16)).toBe(-2);
		expect(pixelRows(bitmap, 2, 2)).toEqual(["010203040506", "0708090a0b0c"]);
	});

	it("adds up the walk that turns at every row", async () => {
		const bitmap = await extract(scrambledFile(2, 2, 24, PIXELS));
		expect(bitmap.readUInt16LE(0x1c)).toBe(24);
		expect(pixelRows(bitmap, 2, 2)).toEqual(["010203040506", "0708090a0b0c"]);
	});

	it("adds up the walk of a picture with an odd number of rows", async () => {
		// The walk of the reference turns at the end of every row and runs on; with an odd number of rows the
		// last one is walked forwards and the walk ends there.
		const pixels: Buffer = Buffer.alloc(3 * 3 * 3, 0x00);
		for (let index = 0; index < pixels.length; index += 1) {
			pixels[index] = (index * 7 + 3) & 0xff;
		}
		const bitmap = await extract(scrambledFile(3, 3, 24, pixels));
		expect(pixelRows(bitmap, 3, 3)).toEqual([
			pixels.subarray(0, 9).toString("hex"),
			pixels.subarray(9, 18).toString("hex"),
			pixels.subarray(18, 27).toString("hex"),
		]);
	});

	it("adds up the walk of a picture of four channels", async () => {
		const pixels: Buffer = Buffer.alloc(2 * 2 * 4, 0x00);
		for (let index = 0; index < pixels.length; index += 1) {
			pixels[index] = (index * 13 + 1) & 0xff;
		}
		const bitmap = await extract(scrambledFile(2, 2, 32, pixels));
		expect(bitmap.readUInt16LE(0x1c)).toBe(32);
		const stride = 2 * 4;
		expect(
			bitmap.subarray(DATA_OFFSET, DATA_OFFSET + stride * 2).toString("hex"),
		).toBe(pixels.toString("hex"));
	});

	it("writes a grey picture out with the colour map of the writer", async () => {
		const pixels: Buffer = Buffer.from([0x00, 0x40, 0x80, 0xc0]);
		const bitmap = await extract(scrambledFile(2, 2, 8, pixels));
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(bitmap.readUInt32LE(0x2e)).toBe(0x100);
		expect(bitmap.readUInt32LE(0x0a)).toBe(GREY_DATA_OFFSET);
		const stride = (2 + 3) & ~3;
		expect(
			bitmap
				.subarray(GREY_DATA_OFFSET, GREY_DATA_OFFSET + stride * 2)
				.toString("hex"),
		).toBe("0040000080c00000");
	});

	it("refuses a picture the stream is too short for", async () => {
		// The measurements say four pixels of three channels and the stream holds two of them.
		const data = plainFile(2, 2, 24, Buffer.from([1, 2, 3, 4, 5, 6]));
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"BGI picture is cut short of its pixels",
		);
		const scrambled = scrambledFile(2, 2, 24, PIXELS);
		await expect(
			extract(Buffer.concat([scrambled.subarray(0, scrambled.length - 3)])),
		).rejects.toThrow("BGI picture is cut short of its pixels");
	});

	it("refuses a picture it cannot hold", async () => {
		const data = plainFile(20000, 20000, 32, Buffer.alloc(0));
		expect(await ethornellBgiImageFormat.detect(sourceOf(data), "cg.bgi")).toBe(
			true,
		);
		expect(
			bgiPixelBytes({
				width: 20000,
				height: 20000,
				bitsPerPixel: 32,
				scrambled: false,
			}),
		).toBe(1600000000);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("adds the planes of a picture up one behind the other", () => {
		// Two pixels of three channels: the planes stand one behind the other and each is a running sum.
		const data: Buffer = Buffer.concat([
			bgiHeader({ width: 2, height: 1, bitsPerPixel: 24, flag: 1 }),
			Buffer.from([0x05, 0x02, 0x10, 0x01, 0x20, 0xff]),
		]);
		const layout = readBgiLayout(data);
		if (!layout) throw new Error("no layout");
		expect(restoreBgiPixels(data, layout).toString("hex")).toBe("05102007111f");
	});
});
