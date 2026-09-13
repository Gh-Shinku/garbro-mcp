import { BufferByteSource } from "@garbro-mcp/core";
import { kurumiGraImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x56, 0x69, 0x72, 0x67]);
const MAGIC = Buffer.from("Virgin Snow Compressed Data 1.0", "ascii");
const HEADER_SIZE = 0x20;
const KEY = [0x5a, 0xa5] as const;

const WIDTH = 2;
const HEIGHT = 2;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

/** A minimal eight bit gray bitmap with a grey palette, exactly `WIDTH * HEIGHT` pixels. */
function buildBmp(tail = 0): Buffer {
	const stride = (WIDTH + 3) & ~3;
	const pixels = Buffer.alloc(stride * HEIGHT);
	for (let i = 0; i < WIDTH * HEIGHT; i += 1) pixels[i] = (i * 53 + 7) & 0xff;
	// The bitmap declares its own size, which the extra `tail` bytes are not part of.
	const bitmapSize = DATA_OFFSET + stride * HEIGHT;
	const bmp: Buffer = Buffer.alloc(bitmapSize + tail, 0xee);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(bitmapSize, 2);
	bmp.writeUInt32LE(DATA_OFFSET, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(WIDTH, 18);
	bmp.writeInt32LE(HEIGHT, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(8, 28);
	bmp.writeUInt32LE(stride * HEIGHT, 34);
	for (let i = 0; i < 256; i += 1) {
		bmp[54 + i * 4] = i;
		bmp[54 + i * 4 + 1] = i;
		bmp[54 + i * 4 + 2] = i;
	}
	pixels.copy(bmp, DATA_OFFSET);
	return bmp;
}

function mask(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ (KEY[i % KEY.length] ?? 0);
	return output;
}

function buildGra(bmp = buildBmp(), magic = MAGIC): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE);
	magic.copy(header, 0);
	return Buffer.concat([header, mask(deflateSync(bmp))]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("kurumi gra image", () => {
	it("declares the signature and the mask key relation", () => {
		expect(kurumiGraImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// The signature is the first four characters of the header text, not a separate constant.
		expect(SIGNATURE.toString("latin1")).toBe(MAGIC.subarray(0, 4).toString());
	});

	it("unmasks and inflates the bitmap", async () => {
		const bmp = buildBmp();
		const stored = buildGra(bmp);
		const compressed = deflateSync(bmp);
		// The compressed stream begins at the header end, masked with the repeating two byte key.
		expect(stored[HEADER_SIZE]).toBe((compressed[0] ?? 0) ^ KEY[0]);
		expect(stored[HEADER_SIZE + 1]).toBe((compressed[1] ?? 0) ^ KEY[1]);
		expect(stored[HEADER_SIZE + 2]).toBe((compressed[2] ?? 0) ^ KEY[0]);
		const source = sourceOf(stored);
		expect(await kurumiGraImageFormat.detect(source, "CG01.GRA")).toBe(true);
		const archive = await kurumiGraImageFormat.open(source, "CG01.GRA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "zlib",
				encrypted: true,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bmp);
		} finally {
			await archive.close();
		}
	});

	it("trims data past the declared bitmap size", async () => {
		// Sixteen bytes of slack after the pixels; the bitmap's own size wins.
		const padded = buildBmp(16);
		const stored = buildGra(padded);
		const archive = await kurumiGraImageFormat.open(
			sourceOf(stored),
			"CG02.GRA",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(padded.length - 16);
			expect(output.equals(padded)).toBe(false);
			expect(output.subarray(0, 8)).toEqual(padded.subarray(0, 8));
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose header text is wrong", async () => {
		const magic = Buffer.from("Virgin Snow Compressed Data 1.1", "ascii");
		const stored = buildGra(buildBmp(), magic);
		// The registry signature still matches, so the text check is what rejects the file.
		expect(stored.subarray(0, 4).equals(SIGNATURE)).toBe(true);
		expect(
			await kurumiGraImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
	});

	it("declines a stream that is not compressed data", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE);
		MAGIC.copy(header, 0);
		const stored = Buffer.concat([header, Buffer.alloc(0x40, 0x11)]);
		expect(
			await kurumiGraImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
	});

	it("declines a payload that does not inflate to a bitmap", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE);
		MAGIC.copy(header, 0);
		const stored = Buffer.concat([
			header,
			mask(deflateSync(Buffer.from("not a bitmap at all", "latin1"))),
		]);
		expect(
			await kurumiGraImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildGra().subarray(0, HEADER_SIZE);
		expect(
			await kurumiGraImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
	});

	it("declines a stream masked with the wrong key", async () => {
		const stored = buildGra();
		stored[HEADER_SIZE + 4] = (stored[HEADER_SIZE + 4] ?? 0) ^ 0xff;
		expect(
			await kurumiGraImageFormat.detect(sourceOf(stored), "CG01.GRA"),
		).toBe(false);
	});
});
