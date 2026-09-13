import { BufferByteSource } from "@garbro-mcp/core";
import { texbImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const PIXEL_OFFSET = 8;

const WIDTH = 3;
const HEIGHT = 2;

/** Sixteen distinct bytes per pixel so a reordered or flipped row would show up. */
function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7 + 3) & 0xff;
	return pixels;
}

function buildTexb(
	width = WIDTH,
	height = HEIGHT,
	pixels = buildPixels(width, height),
): Buffer {
	const header: Buffer = Buffer.alloc(PIXEL_OFFSET, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("gamesystem texb image", () => {
	it("declares no signature and the texb extension", () => {
		expect(texbImageFormat.detection?.signatures).toEqual([]);
	});

	it("writes a bottom up 32 bit bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildTexb(WIDTH, HEIGHT, pixels);
		const source = sourceOf(stored);
		expect(await texbImageFormat.detect(source, "CG01.TEXB")).toBe(true);
		const archive = await texbImageFormat.open(source, "CG01.TEXB");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// `ImageData.CreateFlipped` means bottom up rows, which a positive height records.
			expect(output.readInt32LE(22)).toBe(HEIGHT);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.length).toBe(BMP_HEADER_SIZE + pixels.length);
			// The stored rows reach the bitmap in the order they were read.
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
			// The first stored row is the bottom of the image, so it keeps its place.
			expect(
				output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + WIDTH * 4),
			).toEqual(pixels.subarray(0, WIDTH * 4));
		} finally {
			await archive.close();
		}
	});

	it("declines a length that does not match the dimensions", async () => {
		const stored = buildTexb();
		expect(
			await texbImageFormat.detect(
				sourceOf(stored.subarray(0, stored.length - 1)),
				"CG01.TEXB",
			),
		).toBe(false);
		const padded = Buffer.concat([stored, Buffer.alloc(1)]);
		expect(await texbImageFormat.detect(sourceOf(padded), "CG01.TEXB")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await texbImageFormat.detect(sourceOf(buildTexb(0, HEIGHT)), "CG01.TEXB"),
		).toBe(false);
		expect(
			await texbImageFormat.detect(
				sourceOf(buildTexb(WIDTH, 0, Buffer.alloc(0))),
				"CG01.TEXB",
			),
		).toBe(false);
	});

	it("declines a file without the texb extension", async () => {
		const stored = buildTexb();
		expect(await texbImageFormat.detect(sourceOf(stored), "CG01.BMP")).toBe(
			false,
		);
		expect(await texbImageFormat.detect(sourceOf(stored), "CG01")).toBe(false);
		// The extension is compared without regard to case.
		expect(await texbImageFormat.detect(sourceOf(stored), "cg01.texb")).toBe(
			true,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await texbImageFormat.detect(sourceOf(Buffer.alloc(4)), "CG01.TEXB"),
		).toBe(false);
	});
});
