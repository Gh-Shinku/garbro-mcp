import { BufferByteSource } from "@garbro-mcp/core";
import { applePieGtImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const PALETTE_OFFSET = 54;
const GREY_PIXELS = PALETTE_OFFSET + 1024;

function buildGt(
	flags: number,
	width: number,
	height: number,
	dataOffset: number,
	body: Buffer,
): Buffer {
	const header: Buffer = Buffer.alloc(Math.max(dataOffset, HEADER_SIZE), 0x00);
	header.write("GT", 0, "latin1");
	header[2] = 0x10;
	header[3] = flags;
	header.writeUInt16LE(width, 4);
	header.writeUInt16LE(height, 6);
	header.writeUInt32LE(dataOffset, 8);
	return Buffer.concat([header, body]);
}

/** One fragment of a packed image: this many pixels skipped, then a run written from the bytes behind it. */
function fragment(skipped: number, pixels: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(8, 0x00);
	head.writeInt32LE(skipped, 0);
	head.writeInt32LE(pixels.length / 4, 4);
	return Buffer.concat([head, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await applePieGtImageFormat.open(sourceOf(file), "image.gt");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Apple Pie image", () => {
	it("finds its files by three bytes and reads the fourth as flags", async () => {
		expect(applePieGtImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x47, 0x54, 0x10]) },
		]);
		const body = Buffer.alloc(24, 0x00);
		// The reference's four words differ only in the fourth byte, which the file itself carries.
		for (const flags of [0x00, 0x01, 0x06, 0x0b, 0x0f]) {
			expect(
				await applePieGtImageFormat.detect(
					sourceOf(buildGt(flags, 2, 1, HEADER_SIZE, body)),
					"image.gt",
				),
			).toBe(true);
		}
		expect(
			await applePieGtImageFormat.detect(
				sourceOf(Buffer.from("GT", "latin1")),
				"image.gt",
			),
		).toBe(false);
		expect(
			await applePieGtImageFormat.detect(
				sourceOf(buildGt(0, 0, 1, HEADER_SIZE, body)),
				"image.gt",
			),
		).toBe(false);
	});

	it("reads a twenty four bit image from the offset the header gives", async () => {
		// Two rows of two pixels, with room between the header and the pixels.
		const dataOffset = 0x20;
		const body = Buffer.from([
			1,
			5,
			9,
			2,
			6,
			10, // first row
			3,
			7,
			11,
			4,
			8,
			12, // second row
		]);
		const file = buildGt(0x00, 2, 2, dataOffset, body);
		const archive = await applePieGtImageFormat.open(
			sourceOf(file),
			"picture.gt",
		);
		try {
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				dataOffset,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(2);
		// The reference builds its rows top down.
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// Two pixel rows of six bytes are padded to eight.
		expect(bmp.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8)).toEqual(
			Buffer.from([1, 5, 9, 2, 6, 10, 0, 0]),
		);
		expect(bmp.subarray(PALETTE_OFFSET + 8, PALETTE_OFFSET + 16)).toEqual(
			Buffer.from([3, 7, 11, 4, 8, 12, 0, 0]),
		);
	});

	it("reads a greyscale image as eight bits of one byte each", async () => {
		const file = buildGt(0x01, 2, 1, 0x10, Buffer.from([0x00, 0xff]));
		const archive = await applePieGtImageFormat.open(sourceOf(file), "grey.gt");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		// The palette behind the header is a grey ramp.
		expect(bmp.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 4)).toEqual(
			Buffer.from([0, 0, 0, 0]),
		);
		expect(
			bmp.subarray(PALETTE_OFFSET + 255 * 4, PALETTE_OFFSET + 255 * 4 + 4),
		).toEqual(Buffer.from([255, 255, 255, 0]));
		expect(bmp.subarray(GREY_PIXELS, GREY_PIXELS + 2)).toEqual(
			Buffer.from([0x00, 0xff]),
		);
	});

	it("skips the pixels a fragment leaves behind", async () => {
		const first = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		const second = Buffer.from([0x55, 0x66, 0x77, 0x88]);
		const file = buildGt(
			0x08,
			2,
			2,
			0x10,
			Buffer.concat([fragment(1, first), fragment(1, second)]),
		);
		const archive = await applePieGtImageFormat.open(
			sourceOf(file),
			"alpha.gt",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				bitsPerPixel: 32,
				flags: 0x08,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({ compression: "run-length" });
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		// The pixels a fragment skips are the ones the buffer was left with, and are never written.
		expect(bmp.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 16)).toEqual(
			Buffer.concat([
				Buffer.alloc(4, 0x00),
				first,
				Buffer.alloc(4, 0x00),
				second,
			]),
		);
	});

	it("describes a file with both flags as eight bits and reads it as thirty two", async () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const file = buildGt(0x09, 1, 1, 0x10, fragment(0, pixels));
		const archive = await applePieGtImageFormat.open(sourceOf(file), "both.gt");
		try {
			// The reference reads its own flags in one order to describe an image and another to read it.
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 4)).toEqual(pixels);
	});

	it("stops with an error where the reference would", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		header.write("GT", 0, "latin1");
		header[2] = 0x10;
		header[3] = 0x08;
		header.writeUInt16LE(2, 4);
		header.writeUInt16LE(1, 6);
		header.writeUInt32LE(HEADER_SIZE, 8);
		// A fragment whose run length is not in the file at all.
		await expect(
			render(Buffer.concat([header, Buffer.alloc(4, 0x00)])),
		).rejects.toThrow(/Invalid Apple Pie image fragment/);
		// A run longer than the image it is written into.
		const long: Buffer = Buffer.alloc(8, 0x00);
		long.writeInt32LE(3, 4);
		await expect(render(Buffer.concat([header, long]))).rejects.toThrow(
			/Invalid Apple Pie image fragment/,
		);
		// A fragment that skips backwards.
		const backwards: Buffer = Buffer.alloc(8, 0x00);
		backwards.writeInt32LE(-1, 0);
		await expect(render(Buffer.concat([header, backwards]))).rejects.toThrow(
			/Invalid Apple Pie image fragment/,
		);
		// An image that is not packed and is shorter than it says it is.
		const plain = buildGt(0x00, 4, 4, HEADER_SIZE, Buffer.alloc(4, 0x00));
		await expect(render(plain)).rejects.toThrow(/Truncated Apple Pie image/);
	});
});
