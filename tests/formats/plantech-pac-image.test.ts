import { BufferByteSource } from "@garbro-mcp/core";
import { plantechPacImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_OFFSET = 8;
const DIB_HEADER_SIZE = 40;
const BMP_HEADER_SIZE = 14 + DIB_HEADER_SIZE;
const PALETTE_SIZE = 1024;

function strideOf(width: number, bitsPerPixel: number): number {
	return (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
}

function buildPixels(size: number, seed = 11): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * seed + 13) & 0xff;
	return pixels;
}

/** A coloured palette, to show that the decoder treats eight bit samples as gray. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = (i * 3) & 0xff;
		palette[i * 4 + 1] = 0x00;
		palette[i * 4 + 2] = 0xff;
		palette[i * 4 + 3] = 0x00;
	}
	return palette;
}

function buildBmp(options: {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	palette?: Buffer;
	extraBeforePixels?: number;
}): Buffer {
	const palette = options.palette ?? Buffer.alloc(0);
	const extra = Buffer.alloc(options.extraBeforePixels ?? 0, 0xee);
	const imageOffset = BMP_HEADER_SIZE + palette.length + extra.length;
	const size = imageOffset + options.pixels.length;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(size, 2);
	header.writeUInt32LE(imageOffset, 10);
	header.writeUInt32LE(DIB_HEADER_SIZE, 14);
	header.writeInt32LE(options.width, 18);
	// A bitmap stores rows bottom up, which a positive height records.
	header.writeInt32LE(options.height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(options.bitsPerPixel, 28);
	return Buffer.concat([header, palette, extra, options.pixels]);
}

/** The wrapper: four zero bytes, the mirrored size, then the bitmap at offset eight. */
function buildPac(bmp: Buffer): Buffer {
	const prefix: Buffer = Buffer.alloc(BMP_OFFSET, 0x00);
	prefix.writeUInt32LE(bmp.readUInt32LE(2), 4);
	return Buffer.concat([prefix, bmp]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await plantechPacImageFormat.open(
		sourceOf(stored),
		"CG01.PAC",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("plantech pac image", () => {
	it("registers the zero signature and no extension", () => {
		expect(plantechPacImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x00, 0x00, 0x00, 0x00]) },
		]);
		expect(plantechPacImageFormat.descriptor.extensions).toEqual([]);
	});

	it("decodes a 24 bit bitmap through the wrapper", async () => {
		// Three pixels a row pads to twelve bytes.
		const stride = strideOf(3, 24);
		expect(stride).toBe(12);
		const pixels = buildPixels(stride * 2);
		const stored = buildPac(
			buildBmp({ width: 3, height: 2, bitsPerPixel: 24, pixels }),
		);
		const source = sourceOf(stored);
		expect(await plantechPacImageFormat.detect(source, "CG01.PAC")).toBe(true);
		const archive = await plantechPacImageFormat.open(source, "CG01.PAC");
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
		// The reference's `ImageData.Create` keeps rows top down, so the bitmap takes a negative height.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("reads the pixels at the offset the stored bitmap declares", async () => {
		// Ten unused bytes sit between the header and the pixel data, so a port that assumed a fixed data
		// offset would read the wrong bytes.
		const stride = strideOf(3, 24);
		const pixels = buildPixels(stride);
		const bmp = buildBmp({
			width: 3,
			height: 1,
			bitsPerPixel: 24,
			pixels,
			extraBeforePixels: 10,
		});
		expect(bmp.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + 10);
		const output = await extract(buildPac(bmp));
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("keeps the color masks of a 16 bit bitmap", async () => {
		const stride = strideOf(2, 16);
		expect(stride).toBe(4);
		const pixels = buildPixels(stride * 2);
		const stored = buildPac(
			buildBmp({ width: 2, height: 2, bitsPerPixel: 16, pixels }),
		);
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(16);
		// `Bgr565`: the reference decodes the stored words with these masks.
		expect(output.readUInt32LE(54)).toBe(0xf800);
		expect(output.readUInt32LE(58)).toBe(0x07e0);
		expect(output.readUInt32LE(62)).toBe(0x001f);
		expect(output.subarray(66)).toEqual(pixels);
	});

	it("reads eight bit samples as gray and ignores the stored palette", async () => {
		const stride = strideOf(3, 8);
		expect(stride).toBe(4);
		const pixels = buildPixels(stride);
		const stored = buildPac(
			buildBmp({
				width: 3,
				height: 1,
				bitsPerPixel: 8,
				pixels,
				palette: buildPalette(),
			}),
		);
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		// The ramp `writeBmp8` writes, not the red and blue table the stored bitmap carried.
		for (const index of [0, 1, 200, 255]) {
			const at = BMP_HEADER_SIZE + index * 4;
			expect(output.subarray(at, at + 3)).toEqual(
				Buffer.from([index, index, index]),
			);
		}
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE)).toEqual(pixels);
	});

	it("decodes a 32 bit bitmap", async () => {
		const stride = strideOf(2, 32);
		const pixels = buildPixels(stride * 2);
		const stored = buildPac(
			buildBmp({ width: 2, height: 2, bitsPerPixel: 32, pixels }),
		);
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("declines a mismatched size field, a moved marker and a wrong signature", async () => {
		const pixels = buildPixels(strideOf(2, 24));
		const good = buildPac(
			buildBmp({ width: 2, height: 1, bitsPerPixel: 24, pixels }),
		);
		const mismatched = Buffer.from(good);
		mismatched.writeUInt32LE(mismatched.readUInt32LE(4) + 4, 4);
		expect(
			await plantechPacImageFormat.detect(sourceOf(mismatched), "CG01.PAC"),
		).toBe(false);
		const moved = Buffer.from(good);
		moved[8] = 0x58;
		moved[9] = 0x58;
		expect(
			await plantechPacImageFormat.detect(sourceOf(moved), "CG01.PAC"),
		).toBe(false);
		const signed = Buffer.from(good);
		signed[0] = 0x01;
		expect(
			await plantechPacImageFormat.detect(sourceOf(signed), "CG01.PAC"),
		).toBe(false);
	});

	it("lists a short pixel payload but fails to extract it", async () => {
		const stride = strideOf(3, 24);
		// Two rows are needed but only one and a half are stored, so the size fields stay consistent enough
		// for the header and only the pixel read fails.
		const bmp = buildBmp({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels: buildPixels(stride + 6),
		});
		const stored = buildPac(bmp);
		const source = sourceOf(stored);
		expect(await plantechPacImageFormat.detect(source, "CG01.PAC")).toBe(true);
		const archive = await plantechPacImageFormat.open(source, "CG01.PAC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("lists a bitmap of an unsupported depth but fails to extract it", async () => {
		const bmp = buildBmp({
			width: 4,
			height: 1,
			bitsPerPixel: 4,
			pixels: buildPixels(4),
			palette: buildPalette(),
		});
		const stored = buildPac(bmp);
		const source = sourceOf(stored);
		expect(await plantechPacImageFormat.detect(source, "CG01.PAC")).toBe(true);
		const archive = await plantechPacImageFormat.open(source, "CG01.PAC");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 4 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
