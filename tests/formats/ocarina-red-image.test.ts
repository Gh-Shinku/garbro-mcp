import { BufferByteSource } from "@garbro-mcp/core";
import { redImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 4;
const BMP_HEADER_SIZE = 54;
const WIDTH = 800;
const HEIGHT = 600;
const PIXEL_COUNT = WIDTH * HEIGHT;
const BYTES_PER_PIXEL = 4;

/** A stored pixel word; the alpha byte is set so that the word is never zero. */
function pixel(index: number): Buffer {
	const word = Buffer.alloc(4);
	// The bitwise or yields a signed int32, so the word has to be made unsigned again.
	word.writeUInt32LE(((index + 1) | 0xff000000) >>> 0, 0);
	return word;
}

/** A skip marker: a zero word and the byte count of pixels to leave transparent. */
function skip(count: number): Buffer {
	return Buffer.from([0, 0, 0, 0, count & 0xff]);
}

function buildRed(body: Buffer): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	head.write("RE0", 0, "latin1");
	return Buffer.concat([head, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ocarina red image", () => {
	it("declares the RE0 signature for the registry", () => {
		expect(redImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x52, 0x45, 0x30, 0x00]) },
		]);
	});

	it("decodes stored pixels and leaves skipped ones transparent", async () => {
		const built = buildRed(
			Buffer.concat([pixel(0), pixel(1), skip(3), pixel(4), pixel(5)]),
		);
		const source = sourceOf(built);
		expect(await redImageFormat.detect(source, "CG01.RED")).toBe(true);
		const archive = await redImageFormat.open(source, "CG01.RED");
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
			// The image is a fixed size, whatever the stream holds.
			expect(output.length).toBe(BMP_HEADER_SIZE + PIXEL_COUNT * 4);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readInt32LE(18)).toBe(WIDTH);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readUInt32LE(34)).toBe(PIXEL_COUNT * 4);
			const pixelAt = (index: number): number =>
				output.readUInt32LE(BMP_HEADER_SIZE + index * BYTES_PER_PIXEL);
			expect(pixelAt(0)).toBe(0xff000001);
			expect(pixelAt(1)).toBe(0xff000002);
			// Three pixels were skipped by the marker and stay zero.
			expect(pixelAt(2)).toBe(0);
			expect(pixelAt(3)).toBe(0);
			expect(pixelAt(4)).toBe(0);
			// The next stored pixel lands after the skipped run.
			expect(pixelAt(5)).toBe(0xff000005);
			expect(pixelAt(6)).toBe(0xff000006);
			expect(pixelAt(7)).toBe(0);
			// Everything past the stream is transparent too.
			expect(pixelAt(PIXEL_COUNT - 1)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("stops when a skip runs past the end of the image", async () => {
		const built = buildRed(Buffer.concat([pixel(0), skip(0xff)]));
		const archive = await redImageFormat.open(sourceOf(built), "CG02.RED");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + PIXEL_COUNT * 4);
			expect(output.readUInt32LE(BMP_HEADER_SIZE + 1 * BYTES_PER_PIXEL)).toBe(
				0,
			);
			expect(output.readUInt32LE(BMP_HEADER_SIZE)).toBe(0xff000001);
		} finally {
			await archive.close();
		}
	});

	it("ignores a short tail instead of reading a partial word", async () => {
		const built = buildRed(
			Buffer.concat([pixel(0), Buffer.from([0x11, 0x22])]),
		);
		const archive = await redImageFormat.open(sourceOf(built), "CG03.RED");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt32LE(BMP_HEADER_SIZE)).toBe(0xff000001);
			expect(output.readUInt32LE(BMP_HEADER_SIZE + 1 * BYTES_PER_PIXEL)).toBe(
				0,
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts a file that holds only the signature, as the reference does", async () => {
		const built = buildRed(Buffer.alloc(0));
		expect(await redImageFormat.detect(sourceOf(built), "CG04.RED")).toBe(true);
		const archive = await redImageFormat.open(sourceOf(built), "CG04.RED");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + PIXEL_COUNT * 4);
			expect(output.readUInt32LE(BMP_HEADER_SIZE)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const built = buildRed(pixel(0));
		built[0] = 0x53;
		expect(await redImageFormat.detect(sourceOf(built), "CG01.RED")).toBe(
			false,
		);
	});

	it("declines a file shorter than the signature", async () => {
		expect(
			await redImageFormat.detect(sourceOf(Buffer.from([0x52])), "CG01.RED"),
		).toBe(false);
	});
});
