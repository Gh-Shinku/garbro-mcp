import { BufferByteSource } from "@garbro-mcp/core";
import { tobeWbiImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x20;
const PIXEL_OFFSET = 54;
/** The byte the fixtures write runs with; the pixels themselves never carry it. */
const CODE = 0x80;

function buildWbi(
	width: number,
	height: number,
	rleCode: number,
	body: Buffer,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("WBI-", 0, "latin1");
	header.write("V1.00\0", 4, "latin1");
	header.writeUInt16LE(width, 0x0e);
	header.writeUInt16LE(height, 0x10);
	header[0x1c] = rleCode;
	return Buffer.concat([header, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await tobeWbiImageFormat.open(sourceOf(file), "image.wbi");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("TOBE image", () => {
	it("finds its word and its version", async () => {
		expect(tobeWbiImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("WBI-", "latin1") },
		]);
		const body = Buffer.alloc(9, 0x11);
		expect(
			await tobeWbiImageFormat.detect(
				sourceOf(buildWbi(1, 3, CODE, body)),
				"image.wbi",
			),
		).toBe(true);
		// A version that is not the one the reference asks for.
		const wrong = buildWbi(1, 3, CODE, body);
		wrong.write("V1.01\0", 4, "latin1");
		expect(await tobeWbiImageFormat.detect(sourceOf(wrong), "image.wbi")).toBe(
			false,
		);
		expect(
			await tobeWbiImageFormat.detect(
				sourceOf(buildWbi(0, 3, CODE, body)),
				"image.wbi",
			),
		).toBe(false);
		expect(
			await tobeWbiImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1, 0x00)),
				"image.wbi",
			),
		).toBe(false);
	});

	it("reads pixels of blue, green and red with the rows bottom up", async () => {
		// Three pixels in one row: two plain ones and then a run of the second.
		const body = Buffer.from([1, 2, 3, 4, 5, 6, CODE, 2]);
		const file = buildWbi(3, 1, CODE, body);
		const archive = await tobeWbiImageFormat.open(
			sourceOf(file),
			"picture.wbi",
		);
		try {
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 3,
				height: 1,
				bitsPerPixel: 24,
				rleCode: CODE,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "run-length",
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(3);
		// `CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		expect(bmp.readInt32LE(22)).toBe(1);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// Three pixels of three bytes are padded to four bytes a row.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 12)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 4, 5, 6, 0, 0, 0]),
		);
	});

	it("reads the count of a run as the second byte of its word", async () => {
		// The pair behind the code is little endian, so the count is the byte after the code.
		const body = Buffer.from([1, 2, 3, CODE, 4, 0, 0, 0]);
		const file = buildWbi(1, 4, CODE, body);
		const bmp = await render(file);
		expect(bmp.readInt32LE(22)).toBe(4);
		// One pixel to a row, and three bytes of pixels are padded to four bytes a row.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 16)).toEqual(
			Buffer.from([1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0]),
		);
	});

	it("turns a run of nothing into the pixel behind it", async () => {
		// A count of nothing steps back over the pair, so the code byte becomes the next pixel's blue and the
		// count byte behind it is the byte that pixel throws away.
		const body = Buffer.from([1, 2, 3, CODE, 0, 0xaa, 0xbb, 5, 6, 7]);
		const file = buildWbi(3, 1, CODE, body);
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(3);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 12)).toEqual(
			Buffer.from([1, 2, 3, CODE, 0xaa, 0xbb, 5, 6, 7, 0, 0, 0]),
		);
	});

	it("stops a run at the end of the image", async () => {
		// A run longer than the image writes what is left of it and no more.
		const body = Buffer.from([1, 2, 3, CODE, 5]);
		const file = buildWbi(1, 2, CODE, body);
		const bmp = await render(file);
		expect(bmp.readInt32LE(22)).toBe(2);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 8)).toEqual(
			Buffer.from([1, 2, 3, 0, 1, 2, 3, 0]),
		);
	});

	it("stops with an error where the reference would", async () => {
		// A file that ends in the middle of a pixel.
		await expect(
			render(buildWbi(2, 1, CODE, Buffer.from([1, 2, 3, 4, 5]))),
		).rejects.toThrow(/Truncated TOBE image/);
		// A run whose count is not in the file.
		await expect(
			render(buildWbi(2, 1, CODE, Buffer.from([1, 2, 3, CODE]))),
		).rejects.toThrow(/Truncated TOBE image/);
		// A file with no pixels at all.
		await expect(render(buildWbi(1, 1, CODE, Buffer.alloc(0)))).rejects.toThrow(
			/Truncated TOBE image/,
		);
	});
});
