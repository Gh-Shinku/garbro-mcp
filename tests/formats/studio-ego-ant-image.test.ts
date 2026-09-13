import { BufferByteSource } from "@garbro-mcp/core";
import { antImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("ANTI", "latin1");
const HEADER_SIZE = 0x18;
const BMP_HEADER_SIZE = 54;

/** A literal pixel: three colour bytes and the alpha byte that decides the branch. */
function literal(r: number, g: number, b: number, a: number): number[] {
	return [a, r, g, b];
}

/** A skip run of `count` transparent pixels. */
function skip(count: number): number[] {
	return [0, count];
}

/** The end of a row. */
const ROW_END = [0, 0];

function buildAnt(width: number, height: number, body: number[]): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 0xc);
	header.writeUInt32LE(height, 0x10);
	return Buffer.concat([header, Buffer.from(body)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.ANT"): Promise<Buffer> {
	const archive = await antImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The bytes a bitmap holds, after its header. */
function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE);
}

describe("studio ego ant bitmap", () => {
	it("declares the ANTI signature and no extension", () => {
		expect(antImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("ANTI");
		expect(antImageFormat.descriptor.extensions).toEqual([]);
	});

	it("reads a literal pixel as three colour bytes and an alpha byte", async () => {
		// Two by two, every pixel a literal, each row closed by the zero pair.
		const stored = buildAnt(2, 2, [
			...literal(0x11, 0x22, 0x33, 0xff),
			...literal(0x44, 0x55, 0x66, 0x80),
			...ROW_END,
			...literal(0x77, 0x88, 0x99, 0xff),
			...literal(0xaa, 0xbb, 0xcc, 0x40),
			...ROW_END,
		]);
		const source = sourceOf(stored);
		expect(await antImageFormat.detect(source, "IMAGE.ANT")).toBe(true);
		const archive = await antImageFormat.open(source, "IMAGE.ANT");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 2,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		expect(output.readInt32LE(22)).toBe(-2);
		// The alpha byte leads in the file and ends up in the alpha position of the bitmap.
		expect(body(output)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80, 0x77, 0x88, 0x99, 0xff,
				0xaa, 0xbb, 0xcc, 0x40,
			]),
		);
	});

	it("skips transparent runs", async () => {
		// Two rows of three: one pixel, two skipped, then a pixel, and so on.
		const stored = buildAnt(3, 2, [
			...literal(0x01, 0x02, 0x03, 0xff),
			...skip(2),
			...ROW_END,
			...skip(1),
			...literal(0x04, 0x05, 0x06, 0xff),
			...skip(1),
			...ROW_END,
		]);
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
				0x00, 0x00, 0x00, 0x00, 0x04, 0x05, 0x06, 0xff, 0x00, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("tolerates a skip that runs past the end of the buffer", async () => {
		// A skip only moves the position, so nothing is written out of range and the loop simply ends.
		const stored = buildAnt(2, 1, [
			...literal(0x01, 0x02, 0x03, 0xff),
			...skip(200),
		]);
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0xff, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("fails when a row marker leaves the next row with nothing to read", async () => {
		// The write position runs on across rows, but the outer loop starts a fresh inner loop for each one, so
		// a marker that ends a row early leaves the next row reading — and nothing is left.
		const stored = buildAnt(2, 2, [
			...literal(0x01, 0x02, 0x03, 0xff),
			...ROW_END,
		]);
		expect(await antImageFormat.detect(sourceOf(stored), "IMAGE.ANT")).toBe(
			true,
		);
		const archive = await antImageFormat.open(sourceOf(stored), "IMAGE.ANT");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fills across row markers when the file has fewer of them than rows", async () => {
		// Four pixels and one marker for two rows: the marker ends a row and the next row's inner loop keeps
		// filling, so the image comes out complete. Row boundaries are nominal; only the buffer and the marker
		// count matter. Note that the position always advances in steps of four, which makes the out of range
		// store the reference can make on a literal unreachable.
		const stored = buildAnt(2, 2, [
			...literal(0x01, 0x02, 0x03, 0xff),
			...literal(0x04, 0x05, 0x06, 0xff),
			...ROW_END,
			...literal(0x07, 0x08, 0x09, 0xff),
			...literal(0x0a, 0x0b, 0x0c, 0xff),
		]);
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0xff, 0x07, 0x08, 0x09, 0xff,
				0x0a, 0x0b, 0x0c, 0xff,
			]),
		);
	});

	it("fails when the stream ends in the middle of a pixel", async () => {
		const stored = buildAnt(2, 1, [
			...literal(0x01, 0x02, 0x03, 0xff),
			0xff,
			0x00,
		]);
		const archive = await antImageFormat.open(sourceOf(stored), "IMAGE.ANT");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("accepts an empty image and declines a short header", async () => {
		const empty = buildAnt(0, 0, []);
		expect(await antImageFormat.detect(sourceOf(empty), "IMAGE.ANT")).toBe(
			true,
		);
		const output = await extract(empty);
		expect(output.length).toBe(BMP_HEADER_SIZE);
		expect(
			await antImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.ANT",
			),
		).toBe(false);
	});
});
