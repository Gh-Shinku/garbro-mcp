import { BufferByteSource } from "@garbro-mcp/core";
import { ankhMskImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x6d, 0x73, 0x6b, 0x00]);
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 3;
const HEIGHT = 2;

/** The codec's control byte: one per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37 + 11) & 0xff;
	return pixels;
}

/**
 * With a zero flag the stream starts at sixteen; with a non-zero flag it starts at twelve, inside the flag
 * field itself, so that byte is the stream's first control byte.
 */
function buildMsk(
	pixels = buildPixels(),
	width = WIDTH,
	height = HEIGHT,
	shortHeader = false,
): Buffer {
	// The short form allocates one byte more than the header it declares, because the stream's first
	// control byte sits in the flag field itself.
	const header: Buffer = Buffer.alloc(shortHeader ? 13 : 16, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	if (shortHeader) {
		header[12] = 0xff;
		return Buffer.concat([header, pixels]);
	}
	return Buffer.concat([header, lzssLiterals(pixels)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ankh msk image", () => {
	it("declares the msk signature", () => {
		expect(ankhMskImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("writes a bottom up gray bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildMsk(pixels);
		const source = sourceOf(stored);
		expect(await ankhMskImageFormat.detect(source, "FACE.MSK")).toBe(true);
		const archive = await ankhMskImageFormat.open(source, "FACE.MSK");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["FACE.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: WIDTH,
				height: HEIGHT,
				headerSize: 16,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// `ImageData.CreateFlipped` means bottom up rows, which a positive height records.
			expect(output.readInt32LE(22)).toBe(HEIGHT);
			expect(output.readUInt16LE(28)).toBe(8);
			const stride = (WIDTH + 3) & ~3;
			const body = output.subarray(DATA_OFFSET);
			expect(body.length).toBe(stride * HEIGHT);
			for (let row = 0; row < HEIGHT; row += 1) {
				expect(body.subarray(row * stride, row * stride + WIDTH)).toEqual(
					pixels.subarray(row * WIDTH, row * WIDTH + WIDTH),
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("starts the stream at twelve when the flag field is set", async () => {
		const pixels = buildPixels();
		const stored = buildMsk(pixels, WIDTH, HEIGHT, true);
		// The stream begins inside the flag field, so the file is four bytes shorter.
		expect(stored.length).toBe(12 + 1 + pixels.length);
		const source = sourceOf(stored);
		const archive = await ankhMskImageFormat.open(source, "FACE.MSK");
		try {
			expect(archive.metadata).toMatchObject({ headerSize: 12 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const stride = (WIDTH + 3) & ~3;
			const body = output.subarray(DATA_OFFSET);
			expect(body.subarray(0, WIDTH)).toEqual(pixels.subarray(0, WIDTH));
			expect(body.length).toBe(stride * HEIGHT);
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when the stream ends early", async () => {
		// Two pixels of a six pixel image, so the remaining four keep their zero fill.
		const stored = buildMsk(Buffer.from([0x11, 0x22]), WIDTH, HEIGHT);
		const archive = await ankhMskImageFormat.open(sourceOf(stored), "FACE.MSK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const stride = (WIDTH + 3) & ~3;
			expect(output.subarray(DATA_OFFSET, DATA_OFFSET + 6)).toEqual(
				Buffer.from([0x11, 0x22, 0x00, 0x00, 0x00, 0x00]),
			);
			expect(stride).toBe(4);
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions", async () => {
		expect(
			await ankhMskImageFormat.detect(
				sourceOf(buildMsk(Buffer.alloc(0), 0, HEIGHT)),
				"FACE.MSK",
			),
		).toBe(false);
	});

	it("declines a file too short for the selected header", async () => {
		// Sixteen bytes with a zero flag needs the stream to start at sixteen, and twelve with a set
		// flag needs the same. Twelve bytes cannot be either.
		expect(
			await ankhMskImageFormat.detect(
				sourceOf(Buffer.alloc(12, 0x00)),
				"FACE.MSK",
			),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const stored = buildMsk();
		stored[2] = 0x6c;
		expect(await ankhMskImageFormat.detect(sourceOf(stored), "FACE.MSK")).toBe(
			false,
		);
	});
});
