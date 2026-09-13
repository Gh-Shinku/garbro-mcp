import { BufferByteSource } from "@garbro-mcp/core";
import { hillFieldImgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;

const WIDTH = 3;
const HEIGHT = 2;
/** A three pixel row is nine bytes, padded to twelve in the bitmap. */
const STRIDE = 12;

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 3);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 19 + 4) & 0xff;
	return pixels;
}

function buildImg(options: {
	width?: number;
	height?: number;
	pixels?: Buffer;
	trailing?: number;
}): Buffer {
	const width = options.width ?? WIDTH;
	const height = options.height ?? HEIGHT;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	const pixels = options.pixels ?? buildPixels(width, height);
	return Buffer.concat([
		header,
		pixels,
		Buffer.alloc(options.trailing ?? 0, 0x99),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("hillfield img image", () => {
	it("declares no signature and the img extension", () => {
		expect(hillFieldImgImageFormat.detection?.signatures).toEqual([]);
		expect(hillFieldImgImageFormat.descriptor.extensions).toEqual(["img"]);
	});

	it("writes a bottom up 24 bit bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildImg({ pixels });
		const source = sourceOf(stored);
		expect(await hillFieldImgImageFormat.detect(source, "CG01.IMG")).toBe(true);
		const archive = await hillFieldImgImageFormat.open(source, "CG01.IMG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 24,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(24);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			// `CreateFlipped` stores the rows bottom up, which a positive height records.
			expect(output.readInt32LE(22)).toBe(HEIGHT);
			expect(output.length).toBe(BMP_HEADER_SIZE + STRIDE * HEIGHT);
			const body = output.subarray(BMP_HEADER_SIZE);
			for (let row = 0; row < HEIGHT; row += 1) {
				// The stored order is BGR, which is what a 24 bit bitmap holds, so nothing is swapped.
				expect(body.subarray(row * STRIDE, row * STRIDE + WIDTH * 3)).toEqual(
					pixels.subarray(row * WIDTH * 3, (row + 1) * WIDTH * 3),
				);
				expect(
					body.subarray(row * STRIDE + WIDTH * 3, (row + 1) * STRIDE),
				).toEqual(Buffer.alloc(STRIDE - WIDTH * 3));
			}
		} finally {
			await archive.close();
		}
	});

	it("accepts two trailing bytes and rejects any other length", async () => {
		expect(
			await hillFieldImgImageFormat.detect(
				sourceOf(buildImg({ trailing: 2 })),
				"CG01.IMG",
			),
		).toBe(true);
		expect(
			await hillFieldImgImageFormat.detect(
				sourceOf(buildImg({ trailing: 1 })),
				"CG01.IMG",
			),
		).toBe(false);
		expect(
			await hillFieldImgImageFormat.detect(
				sourceOf(buildImg({ trailing: 3 })),
				"CG01.IMG",
			),
		).toBe(false);
	});

	it("ignores the trailing bytes when extracting", async () => {
		const pixels = buildPixels();
		const stored = buildImg({ pixels, trailing: 2 });
		const archive = await hillFieldImgImageFormat.open(
			sourceOf(stored),
			"CG01.IMG",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + STRIDE * HEIGHT);
			expect(
				output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + WIDTH * 3),
			).toEqual(pixels.subarray(0, WIDTH * 3));
		} finally {
			await archive.close();
		}
	});

	it("requires the img extension", async () => {
		const stored = buildImg({});
		expect(
			await hillFieldImgImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
		expect(
			await hillFieldImgImageFormat.detect(sourceOf(stored), "CG01.img"),
		).toBe(true);
	});

	it("declines zero dimensions", async () => {
		// The reference accepts an eight byte file as a zero sized image; the port declines it.
		const stored: Buffer = Buffer.alloc(HEADER_SIZE);
		expect(
			await hillFieldImgImageFormat.detect(sourceOf(stored), "CG01.IMG"),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildImg({}).subarray(0, HEADER_SIZE - 1);
		expect(
			await hillFieldImgImageFormat.detect(sourceOf(stored), "CG01.IMG"),
		).toBe(false);
	});
});
