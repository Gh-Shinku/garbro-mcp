import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	ikuraDoImageFormat,
	readDoLayout,
	unpackDo,
} from "../../packages/formats/src/ikura/do-image.js";

const PALETTE_OFFSET = 0x36;
const GREY_PALETTE_SIZE = 0x400;
const DATA_OFFSET = 0x36 + GREY_PALETTE_SIZE;

/** A whole file: the two letters, two bytes of nothing, the measurements, the colour map and the pixels. */
function doFile(width: number, height: number, ops: Buffer[]): Buffer {
	const head: Buffer = Buffer.alloc(12, 0x00);
	head.write("DO", 0, "latin1");
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	// The colour map of the reference stands blue, red, green, and holds two hundred and fifty six entries.
	const palette: Buffer = Buffer.alloc(0x300, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		palette[index * 3] = (0x11 + index) & 0xff;
		palette[index * 3 + 1] = (0x22 + index) & 0xff;
		palette[index * 3 + 2] = (0x33 + index) & 0xff;
	}
	return Buffer.concat([head, palette, ...ops]);
}

/** A control byte of the first kind: that many pixels stand in the stream themselves. */
function raw(count: number, ...values: number[]): Buffer {
	if (count < 0x3f) return Buffer.from([count, ...values]);
	return Buffer.from([0x00, count - 0x40, ...values]);
}

/** A control byte of the second kind: that many repeats of the pixel before it, one more than it says. */
function fill(count: number): Buffer {
	if (count - 1 < 0x3f) return Buffer.from([0x40 | (count - 1)]);
	return Buffer.from([0x40, count - 1 - 0x40]);
}

/**
 * A control byte of the third kind: a run copied from a place behind, two more than the count says. The three
 * bits of the control byte behind its highest one hold the count, so the short form reaches six to nine
 * pixels, and a count of nothing there means the byte behind the control plus eight, which comes to ten
 * pixels or more — the counts between two and five have no way of being written at all.
 */
function copy(offset: number, count: number): Buffer {
	const place = offset - 1;
	const high = (place >> 8) & 0x0f;
	const low = place & 0xff;
	if (count - 2 > 0 && count - 2 < 8) {
		return Buffer.from([0x80 | ((count - 2) << 4) | high, low]);
	}
	return Buffer.from([0x80 | high, low, count - 10]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.do"): Promise<Buffer> {
	const handle = await ikuraDoImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of a picture of this width, row by row as the writer stored them. */
function pixelRows(bitmap: Buffer, width: number, height: number): string[] {
	const stride = (width + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("D.O. image format", () => {
	it("finds a picture by the two letters of its signature", async () => {
		const data = doFile(3, 1, [raw(3, 1, 2, 3)]);
		expect(await ikuraDoImageFormat.detect(sourceOf(data), "cg.do")).toBe(true);
		const odd = Buffer.from(data);
		odd.write("DX", 0, "latin1");
		expect(await ikuraDoImageFormat.detect(sourceOf(odd), "cg.do")).toBe(false);
		// A picture of no width or height, and one whose colour map is not all there, are turned away.
		expect(readDoLayout(doFile(0, 1, []))).toBeUndefined();
		expect(readDoLayout(doFile(1, 0, []))).toBeUndefined();
		expect(readDoLayout(data.subarray(0, 12 + 0x300 - 1))).toBeUndefined();
	});

	it("reports the measurements of the header and calls the depth eight", async () => {
		const handle = await ikuraDoImageFormat.open(
			sourceOf(doFile(3, 2, [])),
			"dir/cg.do",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
			width: 3,
			height: 2,
		});
	});

	it("writes the colour map of the picture out the way the reference reads it", async () => {
		const bitmap = await extract(doFile(1, 1, [raw(1, 0x00)]));
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(bitmap.readInt32LE(0x16)).toBe(-1);
		expect(bitmap.readUInt32LE(0x2e)).toBe(0x100);
		expect(bitmap.readUInt32LE(0x0a)).toBe(DATA_OFFSET);
		// The first byte of an entry is its blue, the second its red and the third its green; a bitmap wants
		// them blue, green, red, nothing.
		expect(
			bitmap.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8).toString("hex"),
		).toBe("1133220012342300");
	});

	it("reads a run of pixels that stand in the stream themselves", async () => {
		const bitmap = await extract(doFile(3, 1, [raw(3, 0x11, 0x22, 0x33)]));
		expect(pixelRows(bitmap, 3, 1)).toEqual(["112233"]);
	});

	it("reads a long run of pixels that stand in the stream themselves", async () => {
		// A count of nothing means the byte behind the control plus `0x40`, which is a whole row here.
		const values = Array.from({ length: 0x40 }, (_, index) => index & 0xff);
		const bitmap = await extract(doFile(0x40, 1, [raw(0x40, ...values)]));
		expect(pixelRows(bitmap, 0x40, 1)).toEqual([
			Buffer.from(values).toString("hex"),
		]);
	});

	it("repeats the pixel before a run of the second kind", async () => {
		const bitmap = await extract(doFile(3, 1, [raw(1, 0xaa), fill(2)]));
		expect(pixelRows(bitmap, 3, 1)).toEqual(["aaaaaa"]);
	});

	it("reads a long run of the second kind", async () => {
		// A count of nothing means the byte behind the control plus `0x40`, and the run is one longer.
		const bitmap = await extract(doFile(66, 1, [raw(1, 0xaa), fill(0x41)]));
		expect(pixelRows(bitmap, 66, 1)).toEqual(["aa".repeat(66)]);
	});

	it("copies a run from a place behind it", async () => {
		// Six pixels from three places behind, which read the three the run has just written.
		const bitmap = await extract(doFile(9, 1, [raw(3, 1, 2, 3), copy(3, 6)]));
		expect(pixelRows(bitmap, 9, 1)).toEqual(["010203010203010203"]);
	});

	it("reads a long run of the third kind", async () => {
		const bitmap = await extract(
			doFile(20, 1, [raw(8, 1, 2, 3, 4, 5, 6, 7, 8), copy(8, 12)]),
		);
		expect(pixelRows(bitmap, 20, 1)).toEqual([
			"0102030405060708010203040506070801020304",
		]);
	});

	it("leaves the pixels a run reaches the end of the stream inside of as they stand", async () => {
		// The run declares four pixels and the stream holds two of them; the walk is done, so nothing else is
		// read and the rest of the pixels stand as they were.
		const bitmap = await extract(doFile(4, 1, [raw(4, 0x11, 0x22)]));
		expect(pixelRows(bitmap, 4, 1)).toEqual(["11220000"]);
	});

	it("refuses a run that reaches outside the picture", async () => {
		// A repeat of the pixel before it stands at the first pixel of the picture, where nothing is behind it.
		await expect(
			extract(doFile(3, 1, [fill(2), raw(1, 0x11)])),
		).rejects.toThrow(GarbroError);
		await expect(
			extract(doFile(3, 1, [fill(2), raw(1, 0x11)])),
		).rejects.toThrow("D.O. picture writes past its own end");
		// A copy from two places behind at the first pixel of the picture has nothing to copy.
		await expect(
			extract(doFile(8, 1, [copy(2, 6), raw(2, 1, 2)])),
		).rejects.toThrow("D.O. picture writes past its own end");
		// A run of pixels that stand in the stream themselves cannot be longer than the picture.
		await expect(extract(doFile(2, 1, [raw(3, 1, 2, 3)]))).rejects.toThrow(
			"D.O. picture writes past its own end",
		);
	});

	it("refuses a stream that stops where a control byte is wanted", async () => {
		const data = doFile(3, 1, [raw(2, 0x11, 0x22)]);
		await expect(extract(data)).rejects.toThrow(
			"D.O. picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = doFile(65535, 65535, []);
		expect(await ikuraDoImageFormat.detect(sourceOf(data), "cg.do")).toBe(true);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("walks the runs of a picture of one row", () => {
		// A copy from one place behind is a run of the pixel before it, since it reads what it writes.
		const data = doFile(9, 1, [raw(3, 1, 2, 3), copy(1, 6)]);
		const layout = readDoLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackDo(data, layout).toString("hex")).toBe("010203030303030303");
	});
});
