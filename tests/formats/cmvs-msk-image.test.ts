import { BufferByteSource } from "@garbro-mcp/core";
import { mskImageDescriptor, mskImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
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

/** Builds an image: the signature, the dimensions and one byte per pixel. */
function buildMsk(width = 0x11, height = 4, trailer = 0): Built {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 11) & 0xff;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x2f);
	head.write("MSK0", 0, "latin1");
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 12);
	const extra: Buffer =
		trailer > 0 ? Buffer.alloc(trailer, 0x5e) : Buffer.alloc(0);
	return {
		file: Buffer.concat([head, pixels, extra]),
		pixels,
		width,
		height,
		stride: (width + 3) & ~3,
	};
}

/** The rows the port is expected to produce, padding included. */
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

describe("cmvs msk image", () => {
	it("declares the MSK0 signature and the msk extension", () => {
		expect(mskImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("MSK0", "ascii") },
		]);
		expect(mskImageDescriptor.extensions).toEqual(["msk"]);
	});

	it("wraps the pixels in a gray bitmap", async () => {
		const built = buildMsk();
		const source = sourceOf(built.file);
		expect(await mskImageFormat.detect(source, "MASK01.MSK")).toBe(true);
		const archive = await mskImageFormat.open(source, "MASK01.MSK");
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
			expect(output.length).toBe(DATA_OFFSET + rows.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.readInt32LE(18)).toBe(0x11);
			expect(output.readInt32LE(22)).toBe(-4);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(34)).toBe(rows.length);
			expect(output.readUInt32LE(46)).toBe(256);
			// The grey palette is the identity, so entry 11 is the byte 0x0b three times.
			expect(output.readUInt8(BMP_HEADER_SIZE + 11 * 4)).toBe(0x0b);
			expect(output.readUInt8(BMP_HEADER_SIZE + 11 * 4 + 1)).toBe(0x0b);
			expect(output.readUInt8(BMP_HEADER_SIZE + 11 * 4 + 2)).toBe(0x0b);
			expect(output.subarray(DATA_OFFSET)).toEqual(rows);
			// Eight bit bitmap rows are padded to four bytes.
			expect(output.readUInt8(DATA_OFFSET + 0x11)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("ignores a trailing region the header does not account for", async () => {
		const built = buildMsk(8, 2, 0x20);
		const archive = await mskImageFormat.open(sourceOf(built.file), "M02.MSK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// Two rows of eight pixels need no padding, so the pixels are byte exact.
			expect(output.subarray(DATA_OFFSET)).toEqual(built.pixels);
			expect(output.length).toBe(DATA_OFFSET + built.pixels.length);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const built = buildMsk();
		built.file[0] = 0x4e;
		expect(await mskImageFormat.detect(sourceOf(built.file), "M01.MSK")).toBe(
			false,
		);
	});

	it("declines a zero dimension", async () => {
		const built = buildMsk();
		built.file.writeUInt32LE(0, 12);
		expect(await mskImageFormat.detect(sourceOf(built.file), "M01.MSK")).toBe(
			false,
		);
	});

	it("declines pixels that do not fit the file", async () => {
		const built = buildMsk();
		built.file.writeUInt32LE(0x1000, 8);
		expect(await mskImageFormat.detect(sourceOf(built.file), "M01.MSK")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await mskImageFormat.detect(sourceOf(Buffer.alloc(8)), "M01.MSK"),
		).toBe(false);
	});
});
