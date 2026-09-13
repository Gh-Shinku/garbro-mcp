import { BufferByteSource } from "@garbro-mcp/core";
import { lgfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("lff", "latin1");
const HEADER_SIZE = 8;
const PALETTE_OFFSET = 12;
const PALETTE_SIZE = 1024;
const BMP_HEADER_SIZE = 54;

function buildPixels(size: number, seed = 19): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * seed + 11) & 0xff;
	return pixels;
}

/** A palette in the reader's own order: red, green, blue, unused. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = (i * 5) & 0xff;
		palette[i * 4 + 1] = (i * 7) & 0xff;
		palette[i * 4 + 2] = (i * 11) & 0xff;
		palette[i * 4 + 3] = 0x00;
	}
	return palette;
}

function buildLgf(options: {
	width: number;
	height: number;
	depth: number;
	pixels: Buffer;
	palette?: Buffer;
	tail?: number;
	gapMarker?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header[3] = options.depth;
	header.writeUInt16LE(options.width, 4);
	header.writeUInt16LE(options.height, 6);
	const gap: Buffer = Buffer.alloc(4, options.gapMarker ?? 0x00);
	return Buffer.concat([
		header,
		gap,
		options.palette ?? Buffer.alloc(0),
		options.pixels,
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await lgfImageFormat.open(sourceOf(stored), "CG01.LGF");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("leaf lgf image", () => {
	it("declares the three byte prefix and no extension", () => {
		expect(lgfImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("lff");
		expect(lgfImageFormat.descriptor.extensions).toEqual([]);
	});

	it("decodes a 24 bit image", async () => {
		const pixels = buildPixels(3 * 2 * 3);
		const stored = buildLgf({ width: 3, height: 2, depth: 24, pixels });
		const source = sourceOf(stored);
		expect(await lgfImageFormat.detect(source, "CG01.LGF")).toBe(true);
		const archive = await lgfImageFormat.open(source, "CG01.LGF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(-2);
		// Rows are packed at three bytes a pixel and padded to four.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.concat([
				pixels.subarray(0, 9),
				Buffer.alloc(3),
				pixels.subarray(9, 18),
				Buffer.alloc(3),
			]),
		);
	});

	it("decodes a 32 bit image", async () => {
		const pixels = buildPixels(4 * 4);
		const stored = buildLgf({ width: 2, height: 2, depth: 32, pixels });
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("swaps the palette of an eight bit image from rgb to bgr", async () => {
		const palette = buildPalette();
		const pixels = buildPixels(2 * 3);
		// Eight bit files are marked with a depth byte of nine, which is how the reference writes them.
		const stored = buildLgf({
			width: 2,
			height: 3,
			depth: 9,
			pixels,
			palette,
		});
		const archive = await lgfImageFormat.open(sourceOf(stored), "CG01.LGF");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		// Entry one is stored red 5, green 7, blue 11 and reaches the bitmap as blue, green, red, unused.
		expect(output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([11, 7, 5, 0]),
		);
		const last = BMP_HEADER_SIZE + 255 * 4;
		expect(output[last]).toBe(palette[255 * 4 + 2]);
		expect(output[last + 1]).toBe(palette[255 * 4 + 1]);
		expect(output[last + 2]).toBe(palette[255 * 4]);
		// The pixels follow the palette at the bitmap's own offsets.
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE)).toEqual(
			Buffer.concat([
				pixels.subarray(0, 2),
				Buffer.alloc(2),
				pixels.subarray(2, 4),
				Buffer.alloc(2),
				pixels.subarray(4, 6),
				Buffer.alloc(2),
			]),
		);
	});

	it("treats a depth of nine as eight", async () => {
		// The reference's third signature has a fourth byte of nine and its metadata maps it to eight, which
		// is the depth that decides the palette and the stride.
		const palette = buildPalette();
		const pixels = buildPixels(1);
		const stored = buildLgf({
			width: 1,
			height: 1,
			depth: 9,
			pixels,
			palette,
		});
		const source = sourceOf(stored);
		expect(await lgfImageFormat.detect(source, "CG01.LGF")).toBe(true);
		const archive = await lgfImageFormat.open(source, "CG01.LGF");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + PALETTE_SIZE);
		expect(output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([11, 7, 5, 0]),
		);
	});

	it("declines a depth that is not one of the three signatures", async () => {
		// Eight is the depth nine maps to and sixteen is a real depth, but neither is a signature.
		for (const depth of [8, 16, 4, 0]) {
			const stored = buildLgf({
				width: 1,
				height: 1,
				depth,
				pixels: buildPixels(1),
			});
			expect(await lgfImageFormat.detect(sourceOf(stored), "CG01.LGF")).toBe(
				false,
			);
		}
	});

	it("ignores the four bytes before the palette and any trailing bytes", async () => {
		const palette = buildPalette();
		const pixels = buildPixels(2);
		const stored = buildLgf({
			width: 2,
			height: 1,
			depth: 9,
			pixels,
			palette,
			gapMarker: 0xab,
			tail: 12,
		});
		expect(stored.subarray(8, PALETTE_OFFSET)).toEqual(Buffer.alloc(4, 0xab));
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE)).toEqual(
			Buffer.from([pixels[0] ?? 0, pixels[1] ?? 0, 0, 0]),
		);
	});

	it("lists a short payload but fails to extract it", async () => {
		// Two rows of three bytes are needed but only four bytes follow the header.
		const stored = buildLgf({
			width: 3,
			height: 2,
			depth: 24,
			pixels: buildPixels(4),
		});
		const source = sourceOf(stored);
		expect(await lgfImageFormat.detect(source, "CG01.LGF")).toBe(true);
		const archive = await lgfImageFormat.open(source, "CG01.LGF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
		const short = buildLgf({
			width: 1,
			height: 1,
			depth: 32,
			pixels: buildPixels(2),
		});
		// The reference's probe needs the eight byte header and nothing else.
		expect(await lgfImageFormat.detect(sourceOf(short), "CG01.LGF")).toBe(true);
		expect(
			await lgfImageFormat.detect(sourceOf(short.subarray(0, 7)), "CG01.LGF"),
		).toBe(false);
	});
});
