import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	b5Offsets,
	b5PixelBytes,
	cswareB5ImageFormat,
	readB5Layout,
	unpackB5,
} from "../../packages/formats/src/csware/b5-image.js";

const HEADER_SIZE = 8;
const MASKS_OFFSET = 0x36;
const DATA_OFFSET = MASKS_OFFSET + 12;

/** A whole file: the three letters, the letter of the colours, two bytes of nothing and the measurements. */
function b5File(
	width: number,
	height: number,
	words: number[],
	letter = "w",
): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write(`b5${letter}`, 0, "latin1");
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	const body: Buffer = Buffer.alloc(words.length * 2, 0x00);
	words.forEach((word, index) => {
		body.writeUInt16LE(word, index * 2);
	});
	return Buffer.concat([head, body]);
}

/** A word that holds a pixel in the fifteen bits behind its highest one. */
function literal(value: number): number {
	return 0x8000 | (value & 0x7fff);
}

/** A word that holds a run: the place it copies from and how many pixels it stands for. */
function run(place: number, count: number): number {
	return ((place & 0x7f) << 8) | (count & 0xff);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.b5"): Promise<Buffer> {
	const handle = await cswareB5ImageFormat.open(sourceOf(data), sourcePath);
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
	const stride = (width * 2 + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width * 2,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("CsWare picture format", () => {
	it("finds a picture by the three letters of its signature", async () => {
		const data = b5File(2, 1, [literal(0x1234), literal(0x5678)]);
		expect(await cswareB5ImageFormat.detect(sourceOf(data), "cg.b5")).toBe(
			true,
		);
		// The signature the reference registers holds the letter of the colours itself, so the letter can
		// never be another one for a picture the format is asked about.
		const odd = Buffer.from(data);
		odd.write("b5x", 0, "latin1");
		expect(await cswareB5ImageFormat.detect(sourceOf(odd), "cg.b5")).toBe(
			false,
		);
		odd.write("b6w", 0, "latin1");
		expect(await cswareB5ImageFormat.detect(sourceOf(odd), "cg.b5")).toBe(
			false,
		);
		// A picture of no width or height is turned away.
		expect(readB5Layout(b5File(0, 1, []))).toBeUndefined();
		expect(readB5Layout(b5File(1, 0, []))).toBeUndefined();
		expect(readB5Layout(Buffer.alloc(HEADER_SIZE - 1, 0))).toBeUndefined();
	});

	it("reports the measurements of the header and calls the depth sixteen", async () => {
		const handle = await cswareB5ImageFormat.open(
			sourceOf(b5File(2, 3, [])),
			"dir/cg.b5",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 3,
			bitsPerPixel: 16,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
			width: 2,
			height: 3,
		});
	});

	it("writes the pixels out as a bitmap of fifteen bit colour", async () => {
		const bitmap = await extract(
			b5File(2, 1, [literal(0x1234), literal(0x5678)]),
		);
		expect(bitmap.readUInt16LE(0x1c)).toBe(16);
		expect(bitmap.readInt32LE(0x16)).toBe(-1);
		expect(bitmap.readUInt32LE(0x1e)).toBe(3);
		expect(bitmap.readUInt32LE(MASKS_OFFSET)).toBe(0x7c00);
		expect(bitmap.readUInt32LE(MASKS_OFFSET + 4)).toBe(0x03e0);
		expect(bitmap.readUInt32LE(MASKS_OFFSET + 8)).toBe(0x001f);
		expect(bitmap.readUInt32LE(0x0a)).toBe(DATA_OFFSET);
		expect(pixelRows(bitmap, 2, 1)).toEqual(["34127856"]);
	});

	it("turns the red and the blue about where the letter of the header says so", () => {
		// The words of a header never ask for this, since the signature of the reference holds the letter that
		// stands for the colours being where they are; the walk is asked for it here directly. The highest bit
		// of a pixel stands at the end of the turn, since the reader of the reference takes fifteen bit colour
		// and looks past that bit.
		const words = [literal(0x7c1f), literal(0x0123)];
		const body: Buffer = Buffer.concat([
			Buffer.alloc(HEADER_SIZE, 0x00),
			Buffer.alloc(4, 0x00),
		]);
		words.forEach((word, index) => {
			body.writeUInt16LE(word, HEADER_SIZE + index * 2);
		});
		const plain = unpackB5(body, { width: 2, height: 1, swapRgb: false });
		expect(plain.toString("hex")).toBe("1f7c2301");
		const swapped = unpackB5(body, { width: 2, height: 1, swapRgb: true });
		expect(swapped.toString("hex")).toBe("1ffc208d");
	});

	it("builds the places a run copies from the way the reference walks them", () => {
		const offsets = b5Offsets(4);
		expect(offsets.length).toBe(128);
		// The eight places behind the pixel itself, then the rows above from the nearest one up.
		expect(offsets.slice(0, 8)).toEqual([-1, -2, -3, -4, -5, -6, -7, -8]);
		expect(offsets[8]).toBe(-4 + 6);
		expect(offsets[14]).toBe(-4);
		expect(offsets[119]).toBe(-32);
		expect(offsets[127]).toBe(-32 - 8);
	});

	it("repeats the pixel behind a run", async () => {
		// A run whose place is the first of the table copies the pixel it has just stood behind.
		const data = b5File(4, 1, [literal(0x1234), run(0, 3)]);
		expect(pixelRows(await extract(data), 4, 1)).toEqual(["3412341234123412"]);
	});

	it("copies a row from the row above it", async () => {
		// The nearest row above at the place of the pixel itself is the fifteenth place of the table.
		const data = b5File(2, 2, [literal(0x1234), literal(0x5678), run(14, 2)]);
		expect(pixelRows(await extract(data), 2, 2)).toEqual([
			"34127856",
			"34127856",
		]);
	});

	it("reads a run of no pixels as nothing at all", async () => {
		const data = b5File(2, 1, [run(0, 0), literal(0x1111), literal(0x2222)]);
		expect(pixelRows(await extract(data), 2, 1)).toEqual(["11112222"]);
	});

	it("lets a run reach past its row into the row below", async () => {
		// The run writes three pixels from the first one of the row, the last of which stands in the row below;
		// the row below is walked right afterwards and writes over it, which is what the reference allows as
		// long as the run stays inside the picture.
		const data = b5File(2, 2, [
			literal(0x1234),
			run(0, 3),
			literal(0x5678),
			literal(0x1abc),
		]);
		expect(pixelRows(await extract(data), 2, 2)).toEqual([
			"34123412",
			"7856bc1a",
		]);
	});

	it("refuses a run that reaches outside the picture", async () => {
		// The first pixel of the picture has eight places behind it, so a run from one of them has nothing to
		// copy at the start of the picture.
		await expect(
			extract(b5File(2, 1, [run(0, 1), literal(0x1234), literal(0x5678)])),
		).rejects.toThrow(GarbroError);
		await expect(
			extract(b5File(2, 1, [run(0, 1), literal(0x1234), literal(0x5678)])),
		).rejects.toThrow("CsWare picture writes past its own end");
	});

	it("refuses a stream that stops before its pixels are all there", async () => {
		const data = b5File(2, 2, [literal(0x1234)]);
		await expect(extract(data)).rejects.toThrow(
			"CsWare picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = b5File(65535, 65535, []);
		expect(await cswareB5ImageFormat.detect(sourceOf(data), "cg.b5")).toBe(
			true,
		);
		expect(
			b5PixelBytes({ width: 65535, height: 65535, swapRgb: false }),
		).toBeGreaterThan(256 * 1024 * 1024);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("hands a picture of one row to the walk of the reference", () => {
		const data = b5File(2, 1, [literal(0x0c1f), literal(0x7c00)]);
		const layout = readB5Layout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackB5(data, layout).toString("hex")).toBe("1f0c007c");
	});
});
