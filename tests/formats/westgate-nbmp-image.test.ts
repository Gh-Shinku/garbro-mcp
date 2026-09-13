import { BufferByteSource } from "@garbro-mcp/core";
import { nbmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4e, 0x42, 0x4d, 0x50]);
const HEADER_SIZE = 0x2c;
const PALETTE_SIZE = 0x400;
const BMP_HEADER_SIZE = 54;

function strideOf(width: number, bpp: number): number {
	return ((width * bpp) / 8 + 3) & ~3;
}

function buildPixels(size: number): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 23 + 9) & 0xff;
	return pixels;
}

function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = (i * 3) & 0xff;
		palette[i * 4 + 2] = (i * 7) & 0xff;
		palette[i * 4 + 3] = 0x00;
	}
	return palette;
}

function buildNbmp(options: {
	width?: number;
	height?: number;
	bpp?: number;
	marker?: number;
	pixels?: Buffer;
}): Buffer {
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const bpp = options.bpp ?? 24;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeInt32LE(options.marker ?? 0x28, 4);
	header.writeUInt32LE(width, 8);
	header.writeUInt32LE(height, 0x0c);
	header.writeInt16LE(bpp, 0x12);
	const pixels = options.pixels ?? buildPixels(strideOf(width, bpp) * height);
	const palette = bpp === 8 ? buildPalette() : Buffer.alloc(0);
	return Buffer.concat([header, palette, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("westgate nbmp image", () => {
	it("declares the NBMP signature and no extension", () => {
		expect(nbmpImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(nbmpImageFormat.descriptor.extensions).toEqual([]);
	});

	it("writes a bottom up 24 bit bitmap", async () => {
		const pixels = buildPixels(strideOf(3, 24) * 2);
		const stored = buildNbmp({ width: 3, height: 2, bpp: 24, pixels });
		const source = sourceOf(stored);
		expect(await nbmpImageFormat.detect(source, "CG01.NBMP")).toBe(true);
		const archive = await nbmpImageFormat.open(source, "CG01.NBMP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
				stride: 12,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(24);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			expect(output.readInt32LE(22)).toBe(2);
			expect(output.length).toBe(BMP_HEADER_SIZE + 12 * 2);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("keeps the fourth byte of a 32 bit image", async () => {
		const pixels = buildPixels(8 * 2);
		// Every fourth byte is a marker rather than a real alpha value.
		for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0x11;
		const stored = buildNbmp({ width: 2, height: 2, bpp: 32, pixels });
		const archive = await nbmpImageFormat.open(sourceOf(stored), "CG01.NBMP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readInt32LE(22)).toBe(2);
			expect(output.length).toBe(BMP_HEADER_SIZE + 8 * 2);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("carries the palette of an eight bit image verbatim", async () => {
		const palette = buildPalette();
		const pixels = buildPixels(strideOf(3, 8) * 2);
		const stored = buildNbmp({ width: 3, height: 2, bpp: 8, pixels });
		const archive = await nbmpImageFormat.open(sourceOf(stored), "CG01.NBMP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + PALETTE_SIZE);
			expect(output.readInt32LE(22)).toBe(2);
			// The stored table is BGRX, which is the order a bitmap palette uses, so it is copied as it stands.
			expect(
				output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + PALETTE_SIZE),
			).toEqual(palette);
			expect(
				output.subarray(
					BMP_HEADER_SIZE + PALETTE_SIZE,
					BMP_HEADER_SIZE + PALETTE_SIZE + pixels.length,
				),
			).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("rejects a wrong header marker or bit depth", async () => {
		expect(
			await nbmpImageFormat.detect(
				sourceOf(buildNbmp({ marker: 0x29 })),
				"CG01.NBMP",
			),
		).toBe(false);
		expect(
			await nbmpImageFormat.detect(
				sourceOf(buildNbmp({ bpp: 16 })),
				"CG01.NBMP",
			),
		).toBe(false);
	});

	it("lists a short image but fails to extract it", async () => {
		const full = buildNbmp({ width: 3, height: 2, bpp: 24 });
		const short = full.subarray(0, full.length - 4);
		expect(await nbmpImageFormat.detect(sourceOf(short), "CG01.NBMP")).toBe(
			true,
		);
		const archive = await nbmpImageFormat.open(sourceOf(short), "CG01.NBMP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions, a short header and a wrong signature", async () => {
		expect(
			await nbmpImageFormat.detect(
				sourceOf(buildNbmp({ width: 0, pixels: Buffer.alloc(0) })),
				"CG01.NBMP",
			),
		).toBe(false);
		expect(
			await nbmpImageFormat.detect(
				sourceOf(buildNbmp({}).subarray(0, HEADER_SIZE - 1)),
				"CG01.NBMP",
			),
		).toBe(false);
		const wrong = buildNbmp({});
		wrong[0] = 0x4f;
		expect(await nbmpImageFormat.detect(sourceOf(wrong), "CG01.NBMP")).toBe(
			false,
		);
	});
});
