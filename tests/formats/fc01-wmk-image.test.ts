import { BufferByteSource } from "@garbro-mcp/core";
import { wmkImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const LENGTH_BASE = 0x10;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 256 * 4;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
	stride: number;
}

/**
 * Builds a mask: the dimensions, eight header bytes of which the first eight are the pixels, and the
 * eight extra bytes the length check accounts for.
 */
function buildWmk(width = 0x10, height = 4): Built {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 9) & 0xff;
	const head = Buffer.alloc(HEADER_SIZE);
	head.writeUInt32LE(width, 0);
	head.writeUInt32LE(height, 4);
	const trailer: Buffer = Buffer.alloc(LENGTH_BASE - HEADER_SIZE, 0x3c);
	return {
		file: Buffer.concat([head, pixels, trailer]),
		pixels,
		width,
		height,
		stride: (width + 3) & ~3,
	};
}

/** The rows the port is expected to produce for the gray bitmap, padding included. */
function expectedRows(built: Built): Buffer {
	const rows: Buffer[] = [];
	for (let row = 0; row < built.height; row += 1) {
		const line = Buffer.alloc(built.stride);
		built.pixels.copy(
			line,
			0,
			row * built.width,
			row * built.width + built.width,
		);
		rows.push(line);
	}
	return Buffer.concat(rows);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("fc01 wmk mask", () => {
	it("has no signature, so the length relation is its detection", () => {
		expect(wmkImageFormat.detection?.signatures).toEqual([]);
	});

	it("wraps the mask pixels in a gray bitmap", async () => {
		const built = buildWmk(0x11, 4);
		const source = sourceOf(built.file);
		expect(await wmkImageFormat.detect(source, "MASK01.WMK")).toBe(true);
		const archive = await wmkImageFormat.open(source, "MASK01.WMK");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"MASK01.bmp",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x11,
				height: 4,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({ image: "bmp", width: 0x11 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const rows = expectedRows(built);
			// The eight trailing bytes are not part of the image.
			expect(output.length).toBe(DATA_OFFSET + rows.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.readInt32LE(18)).toBe(0x11);
			expect(output.readInt32LE(22)).toBe(-4);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(34)).toBe(rows.length);
			expect(output.readUInt32LE(46)).toBe(256);
			expect(output.readUInt8(BMP_HEADER_SIZE + 9 * 4)).toBe(9);
			expect(output.subarray(DATA_OFFSET)).toEqual(rows);
			// The row padding of an eight bit bitmap is visible in the last byte of a row.
			expect(output.readUInt8(DATA_OFFSET + 0x11)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("accepts an image whose width needs no padding", async () => {
		const built = buildWmk(0x10, 2);
		const archive = await wmkImageFormat.open(sourceOf(built.file), "M02.WMK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(DATA_OFFSET)).toEqual(built.pixels);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose length does not match the dimensions", async () => {
		const built = buildWmk();
		expect(
			await wmkImageFormat.detect(
				sourceOf(built.file.subarray(0, built.file.length - 1)),
				"M01.WMK",
			),
		).toBe(false);
	});

	it("declines a zero dimension", async () => {
		const built = buildWmk();
		built.file.writeUInt32LE(0, 0);
		expect(await wmkImageFormat.detect(sourceOf(built.file), "M01.WMK")).toBe(
			false,
		);
	});

	it("declines a file that is too short", async () => {
		expect(
			await wmkImageFormat.detect(sourceOf(Buffer.alloc(0x10)), "M01.WMK"),
		).toBe(false);
	});
});
