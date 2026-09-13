import { BufferByteSource } from "@garbro-mcp/core";
import { bgraImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x42, 0x47, 0x52, 0x41]);
const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;

const WIDTH = 2;
const HEIGHT = 3;

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 17 + 5) & 0xff;
	return pixels;
}

function buildBgra(
	pixels = buildPixels(),
	width = WIDTH,
	height = HEIGHT,
	tail = 0,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(0x08080808, 4);
	header.writeUInt32LE(width, 8);
	header.writeUInt32LE(height, 0x0c);
	return Buffer.concat([header, pixels, Buffer.alloc(tail, 0x99)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("g2 bgra image", () => {
	it("declares the signature and the documented extensions", () => {
		expect(bgraImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// The reference registers these two spellings, neither of which is the four letter tag.
		expect(bgraImageFormat.descriptor.extensions).toEqual(["argb", "arg"]);
	});

	it("writes a top down 32 bit bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildBgra(pixels);
		const source = sourceOf(stored);
		expect(await bgraImageFormat.detect(source, "CG01.ARGB")).toBe(true);
		const archive = await bgraImageFormat.open(source, "CG01.ARGB");
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
				bitsPerPixel: 32,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// `ImageData.Create` stores rows top down, which a negative height records.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.length).toBe(BMP_HEADER_SIZE + WIDTH * HEIGHT * 4);
			// The stored channel order is passed through unchanged.
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("ignores data past the pixel buffer", async () => {
		const pixels = buildPixels();
		const stored = buildBgra(pixels, WIDTH, HEIGHT, 24);
		const archive = await bgraImageFormat.open(sourceOf(stored), "CG01.ARGB");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + WIDTH * HEIGHT * 4);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("lists a file with short pixel data but fails to extract it", async () => {
		// `ReadMetaData` never looks at the pixel data, while `Read` demands all of it.
		const short = buildBgra(buildPixels().subarray(0, 8));
		expect(await bgraImageFormat.detect(sourceOf(short), "CG01.ARGB")).toBe(
			true,
		);
		const archive = await bgraImageFormat.open(sourceOf(short), "CG01.ARGB");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose marker is wrong", async () => {
		const stored = buildBgra();
		stored.writeUInt32LE(0x08080809, 4);
		expect(await bgraImageFormat.detect(sourceOf(stored), "CG01.ARGB")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await bgraImageFormat.detect(
				sourceOf(buildBgra(Buffer.alloc(0), 0, HEIGHT)),
				"CG01.ARGB",
			),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildBgra().subarray(0, HEADER_SIZE - 1);
		expect(await bgraImageFormat.detect(sourceOf(stored), "CG01.ARGB")).toBe(
			false,
		);
	});
});
