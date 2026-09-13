import { BufferByteSource } from "@garbro-mcp/core";
import { mwpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4d, 0x57, 0x50, 0x10]);
const ALT_SIGNATURE = Buffer.from([0x54, 0x45, 0x59, 0x4c]);
const BMP_HEADER_SIZE = 54;
const PIXEL_OFFSET = 0x0c;

const WIDTH = 3;
const HEIGHT = 2;

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 3 + 1) & 0xff;
	return pixels;
}

function buildMwp(
	signature = SIGNATURE,
	width = WIDTH,
	height = HEIGHT,
	pixels = buildPixels(width, height),
): Buffer {
	const header: Buffer = Buffer.alloc(PIXEL_OFFSET, 0x00);
	signature.copy(header, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	return Buffer.concat([header, pixels]);
}

/** A 32 bit bitmap the way the shared writer produces one: header, then pixels, top down. */
function expectedBmp(pixels: Buffer, width = WIDTH, height = HEIGHT): Buffer {
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(-height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(32, 28);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("emic mwp image", () => {
	it("declares both signatures the reference registers", () => {
		expect(mwpImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
			{ bytes: ALT_SIGNATURE },
		]);
	});

	it("wraps the pixels in a 32 bit bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildMwp(SIGNATURE, WIDTH, HEIGHT, pixels);
		const source = sourceOf(stored);
		expect(await mwpImageFormat.detect(source, "CG01.MWP")).toBe(true);
		const archive = await mwpImageFormat.open(source, "CG01.MWP");
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
			expect(output).toEqual(expectedBmp(pixels));
			// Top down rows, as `ImageData.Create` produces.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			// The pixels are copied, not reordered.
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("accepts the engine's second signature", async () => {
		const stored = buildMwp(ALT_SIGNATURE);
		expect(await mwpImageFormat.detect(sourceOf(stored), "CG02.BMP")).toBe(
			true,
		);
		const archive = await mwpImageFormat.open(sourceOf(stored), "CG02.BMP");
		try {
			expect(archive.metadata).toMatchObject({ width: WIDTH, height: HEIGHT });
		} finally {
			await archive.close();
		}
	});

	it("lists a file whose pixels are missing but declines to extract it", async () => {
		const stored = buildMwp(SIGNATURE, WIDTH, HEIGHT, Buffer.alloc(4));
		// The reference reads the header without touching the pixel data, so listing succeeds.
		expect(await mwpImageFormat.detect(sourceOf(stored), "CG03.MWP")).toBe(
			true,
		);
		const archive = await mwpImageFormat.open(sourceOf(stored), "CG03.MWP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(
				/Invalid Emic MWP image/,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions", async () => {
		expect(
			await mwpImageFormat.detect(
				sourceOf(buildMwp(SIGNATURE, 0, HEIGHT)),
				"CG01.MWP",
			),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const stored = buildMwp();
		stored[2] = 0x51;
		expect(await mwpImageFormat.detect(sourceOf(stored), "CG01.MWP")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await mwpImageFormat.detect(sourceOf(Buffer.alloc(8)), "CG01.MWP"),
		).toBe(false);
	});
});
