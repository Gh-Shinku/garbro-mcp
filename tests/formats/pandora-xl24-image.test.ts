import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	pandoraXl24ImageFormat,
	readXl24Layout,
	unpackXl24,
} from "../../packages/formats/src/pandora/xl24-image.js";

const HEADER_SIZE = 0x10;
const DATA_OFFSET = 0x36;

/** A whole file: the four letters, four bytes the reference skips, the measurements and the rows behind. */
function xl24File(width: number, height: number, rows: Buffer[]): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x7e);
	head.write("XL24", 0, "latin1");
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 12);
	return Buffer.concat([head, ...rows]);
}

/** One pixel put down as a run of one, which is how the reference writes a single pixel. */
function pixel(b: number, g: number, r: number): Buffer {
	return Buffer.from([0x81, b, g, r]);
}

/** The stream of a row of raw pixels, which the control byte counts. */
function raw(...values: number[]): Buffer {
	if (values.length % 3 !== 0) throw new Error("a row holds whole pixels");
	return Buffer.from([values.length / 3, ...values]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bmp"): Promise<Buffer> {
	const handle = await pandoraXl24ImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap the size of a picture, row by row as the writer stored them. */
function pixelRows(bitmap: Buffer, width: number, height: number): string[] {
	const stride = (width * 3 + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width * 3,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("Pandora.box image format", () => {
	it("finds a picture by the four letters of its signature", async () => {
		const data = xl24File(1, 1, [pixel(1, 2, 3)]);
		expect(await pandoraXl24ImageFormat.detect(sourceOf(data), "cg.bmp")).toBe(
			true,
		);
		const odd = Buffer.from(data);
		odd.write("XL25", 0, "latin1");
		expect(await pandoraXl24ImageFormat.detect(sourceOf(odd), "cg.bmp")).toBe(
			false,
		);
		// A picture of no width or height has nothing in it.
		expect(readXl24Layout(xl24File(0, 4, []))).toBeUndefined();
		expect(
			await pandoraXl24ImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1, 0)),
				"cg.bmp",
			),
		).toBe(false);
	});

	it("reports the measurements the header holds and always calls the depth twenty four", async () => {
		const data = xl24File(2, 3, []);
		const handle = await pandoraXl24ImageFormat.open(
			sourceOf(data),
			"dir/cg.bmp",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 3,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
			width: 2,
			height: 3,
		});
	});

	it("unfolds the rows from the bottom row of the picture up", async () => {
		// The first row of the stream is the bottom row of the picture, so the bitmap, which stands from the
		// top down, holds it last. The row above it holds the differences of the colours it stands for and the
		// row below it, which is what makes them come out as written here.
		const data = xl24File(2, 2, [
			raw(1, 2, 3, 4, 5, 6),
			raw(0x0b, 0x09, 0x0f, 0x09, 0x0b, 0x09),
		]);
		const bitmap = await extract(data);
		expect(bitmap.readInt32LE(0x16)).toBe(-2);
		expect(pixelRows(bitmap, 2, 2)).toEqual(["0a0b0c0d0e0f", "010203040506"]);
	});

	it("skips the pixels of a stream that puts down nothing", async () => {
		// Nothing and the byte behind it stand for that many pixels plus two, and one byte stands for one.
		const data = xl24File(4, 1, [
			Buffer.from([0x00, 0x00, 0x01, 0x81, 1, 2, 3]),
		]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 4, 1)).toEqual(["000000000000000000010203"]);
	});

	it("ends a row where the stream says so", async () => {
		const data = xl24File(3, 1, [
			Buffer.concat([pixel(1, 2, 3), Buffer.from([0x80])]),
		]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 3, 1)).toEqual(["010203000000000000"]);
	});

	it("carries one pixel through the rest of a row", async () => {
		const data = xl24File(4, 1, [Buffer.from([0xff, 0x21, 0x22, 0x23])]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 4, 1)).toEqual(["212223212223212223212223"]);
	});

	it("carries one pixel through as many pixels as the control says", async () => {
		// Three pixels for the control `0x83`: the one the stream holds and two more behind it.
		const data = xl24File(4, 1, [
			Buffer.concat([
				Buffer.from([0x83, 0x31, 0x32, 0x33]),
				Buffer.from([0x01]),
			]),
		]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 4, 1)).toEqual(["313233313233313233000000"]);
	});

	it("exclusive-ors every row with the one below it", async () => {
		// The bottom row stands as it is; the row above it is exclusive-or'd with it.
		const data = xl24File(1, 2, [
			pixel(0x10, 0x10, 0x10),
			pixel(0x30, 0x30, 0x30),
		]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 1, 2)).toEqual(["202020", "101010"]);
	});

	it("lets a row run past its own end into the row below it", async () => {
		// The rows are unfolded from the bottom up, so a run of the top row that reaches past the row lands in
		// the row below it, which was exclusive-or'd already and is not touched again — except by the row that
		// reaches into it, whose own turn to be exclusive-or'd comes right after.
		const data = xl24File(1, 3, [
			pixel(0x11, 0x22, 0x33),
			pixel(0x40, 0x50, 0x60),
			Buffer.from([0x82, 0x0a, 0x0b, 0x0c]),
		]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 1, 3)).toEqual(["000000", "0a0b0c", "112233"]);
	});

	it("leaves a pixel that the stream stops inside of as it stands", async () => {
		const data = xl24File(2, 1, [Buffer.from([0x02, 0x01, 0x02])]);
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 2, 1)).toEqual(["010200000000"]);
	});

	it("refuses a stream that stops where a control byte is wanted", async () => {
		// The row is two pixels wide and the stream holds one byte, which skips one pixel and no more.
		const data = xl24File(2, 1, [Buffer.from([0x01])]);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Pandora picture is cut short of its stream",
		);
	});

	it("refuses a run that reaches past the picture", async () => {
		// A picture one pixel wide and one row tall cannot hold a run of two pixels.
		const data = xl24File(1, 1, [Buffer.from([0x02, 1, 2, 3, 4, 5, 6])]);
		await expect(extract(data)).rejects.toThrow(
			"Pandora picture writes past its own end",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = xl24File(20000, 20000, []);
		expect(await pandoraXl24ImageFormat.detect(sourceOf(data), "cg.bmp")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("unfolds a row of raw pixels the way the reference walks it", () => {
		// A row of two pixels put down as their own bytes, which is the control the walk counts.
		const data = xl24File(2, 1, [raw(9, 8, 7, 6, 5, 4)]);
		const layout = readXl24Layout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackXl24(data, layout).toString("hex")).toBe("090807060504");
		expect(unpackXl24(data, layout).length).toBe(6);
	});
});
