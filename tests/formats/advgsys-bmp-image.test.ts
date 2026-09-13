import { BufferByteSource } from "@garbro-mcp/core";
import { advgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;
const STREAM_OFFSET = 4;

const WIDTH = 4;
const HEIGHT = 3;

/** A minimal valid eight bit bitmap with a grey palette. */
function buildBmp(width = WIDTH, height = HEIGHT, extra = 0): Buffer {
	const stride = (width + 3) & ~3;
	const imageSize = stride * height;
	const fileSize = DATA_OFFSET + imageSize;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(fileSize, 2);
	header.writeUInt32LE(DATA_OFFSET, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(-height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(8, 28);
	header.writeUInt32LE(imageSize, 34);
	header.writeUInt32LE(256, 46);
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = i;
		palette[i * 4 + 2] = i;
	}
	const body: Buffer = Buffer.alloc(imageSize + extra);
	for (let i = 0; i < imageSize; i += 1) body[i] = (i * 5) & 0xff;
	if (extra > 0) body.fill(0x5a, imageSize);
	return Buffer.concat([header, palette, body]);
}

/** The codec's control byte: one per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/**
 * Four prefix bytes, then the LZSS stream. The marker is not a separate field: the stream's first byte is
 * its control byte, `0xFF` for a full group of literals, and the marker check is that this byte's low
 * nibble is set — while bytes five and six are the first two literals, which read `BM`.
 */
function buildAdvg(bmp: Buffer): Buffer {
	return Buffer.concat([Buffer.alloc(STREAM_OFFSET, 0x20), lzssLiterals(bmp)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("advgsys bmp image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(advgImageFormat.detection?.signatures).toEqual([]);
	});

	it("decompresses the bitmap and reports its header", async () => {
		const bmp = buildBmp();
		const stored = buildAdvg(bmp);
		// The marker's `BM` is the stream's own first two literal bytes.
		expect(stored.subarray(5, 7).toString("latin1")).toBe("BM");
		const source = sourceOf(stored);
		expect(await advgImageFormat.detect(source, "CG01")).toBe(true);
		const archive = await advgImageFormat.open(source, "CG01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
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
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(stored.length - STREAM_OFFSET));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bmp);
			expect(output.readUInt16LE(0)).toBe(0x4d42);
		} finally {
			await archive.close();
		}
	});

	it("trims the bitmap to the length its header declares", async () => {
		const bmp = buildBmp(WIDTH, HEIGHT, 0x20);
		const declared = DATA_OFFSET + ((WIDTH + 3) & ~3) * HEIGHT;
		expect(bmp.length).toBeGreaterThan(declared);
		const archive = await advgImageFormat.open(
			sourceOf(buildAdvg(bmp)),
			"CG02",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(declared);
			expect(output).toEqual(bmp.subarray(0, declared));
		} finally {
			await archive.close();
		}
	});

	it("declines a stream whose control byte has a clear nibble", async () => {
		const stored = buildAdvg(buildBmp());
		// `0xE0` has a clear low nibble, which the marker check rejects before anything is decoded.
		stored[STREAM_OFFSET] = 0xe0;
		expect(await advgImageFormat.detect(sourceOf(stored), "CG01")).toBe(false);
	});

	it("declines a prefix whose bytes are not BM", async () => {
		const stored = buildAdvg(buildBmp());
		// The nibble still matches, so this exercises the `BM` half of the marker.
		stored[6] = 0x4e;
		expect(await advgImageFormat.detect(sourceOf(stored), "CG01")).toBe(false);
	});

	it("declines a stream that does not decompress to a bitmap", async () => {
		const stored = Buffer.concat([
			Buffer.alloc(STREAM_OFFSET, 0x20),
			lzssLiterals(Buffer.alloc(0x40, 0x42)),
		]);
		expect(await advgImageFormat.detect(sourceOf(stored), "CG01")).toBe(false);
	});

	it("declines a bitmap with an OS/2 header", async () => {
		const bmp = buildBmp();
		bmp.writeUInt32LE(12, 14);
		expect(await advgImageFormat.detect(sourceOf(buildAdvg(bmp)), "CG01")).toBe(
			false,
		);
	});

	it("declines a truncated file", async () => {
		expect(
			await advgImageFormat.detect(sourceOf(Buffer.alloc(6)), "CG01"),
		).toBe(false);
	});
});
