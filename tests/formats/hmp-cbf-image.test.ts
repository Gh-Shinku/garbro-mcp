import { BufferByteSource } from "@garbro-mcp/core";
import { cbfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4d, 0x41, 0x2d, 0x43]);
const HEADER_SIZE = 0x1c;
const PIXEL_OFFSET = 0x24;
const DATA_OFFSET = 66;

const WIDTH = 3;
const HEIGHT = 2;

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 2);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 23 + 9) & 0xff;
	return pixels;
}

/**
 * The header is 0x1C bytes and the pixels start at 0x24, so eight bytes in between are never read; they are
 * filled with a marker that the test can look for.
 */
function buildCbf(
	pixels = buildPixels(),
	width = WIDTH,
	height = HEIGHT,
): Buffer {
	const header: Buffer = Buffer.alloc(PIXEL_OFFSET, 0xab);
	SIGNATURE.copy(header, 0);
	header.write("MA-CBF", 0, "latin1");
	header.writeUInt32LE(width, 0x10);
	header.writeUInt32LE(height, 0x14);
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("hmp cbf image", () => {
	it("declares the MA-C signature", () => {
		expect(cbfImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("writes a bottom up 555 bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildCbf(pixels);
		const source = sourceOf(stored);
		expect(await cbfImageFormat.detect(source, "CG01.CBF")).toBe(true);
		const archive = await cbfImageFormat.open(source, "CG01.CBF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 15,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readInt32LE(22)).toBe(HEIGHT);
			expect(output.readUInt16LE(28)).toBe(16);
			expect(output.readUInt32LE(54)).toBe(0x7c00);
			// Three pixels per row are six stored bytes, padded to eight.
			const stride = 8;
			const body = output.subarray(DATA_OFFSET);
			expect(body.length).toBe(stride * HEIGHT);
			for (let row = 0; row < HEIGHT; row += 1) {
				expect(body.subarray(row * stride, row * stride + WIDTH * 2)).toEqual(
					pixels.subarray(row * WIDTH * 2, (row + 1) * WIDTH * 2),
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("ignores the eight bytes between the header and the pixels", async () => {
		// A distinctive pixel pattern, so a port that read from 0x1C instead of 0x24 would produce a
		// different image rather than the same one by coincidence.
		const pixels = buildPixels();
		expect(pixels.subarray(0, 8).includes(0xab)).toBe(false);
		const stored = buildCbf(pixels);
		expect(stored[HEADER_SIZE]).toBe(0xab);
		expect(stored[PIXEL_OFFSET]).toBe(pixels[0]);
		const archive = await cbfImageFormat.open(sourceOf(stored), "CG01.CBF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const body = output.subarray(DATA_OFFSET);
			expect(body.subarray(0, WIDTH * 2)).toEqual(
				pixels.subarray(0, WIDTH * 2),
			);
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when the pixels are short", async () => {
		const stored = buildCbf(Buffer.from([0x33, 0x44]));
		const archive = await cbfImageFormat.open(sourceOf(stored), "CG01.CBF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(DATA_OFFSET, DATA_OFFSET + 6)).toEqual(
				Buffer.from([0x33, 0x44, 0x00, 0x00, 0x00, 0x00]),
			);
		} finally {
			await archive.close();
		}
	});

	it("treats a header without pixel data as a zeroed image", async () => {
		const stored = buildCbf(Buffer.alloc(0));
		expect(await cbfImageFormat.detect(sourceOf(stored), "CG01.CBF")).toBe(
			true,
		);
		const archive = await cbfImageFormat.open(sourceOf(stored), "CG01.CBF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(DATA_OFFSET)).toEqual(Buffer.alloc(8 * HEIGHT));
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose header text is wrong", async () => {
		const stored = buildCbf();
		// Only the sixth character changes, so the four byte signature still matches.
		stored[5] = 0x47;
		expect(await cbfImageFormat.detect(sourceOf(stored), "CG01.CBF")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await cbfImageFormat.detect(
				sourceOf(buildCbf(Buffer.alloc(0), 0, HEIGHT)),
				"CG01.CBF",
			),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildCbf().subarray(0, HEADER_SIZE - 1);
		expect(await cbfImageFormat.detect(sourceOf(stored), "CG01.CBF")).toBe(
			false,
		);
	});
});
