import { BufferByteSource } from "@garbro-mcp/core";
import { pbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const STREAM_OFFSET = 4;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 4;
const HEIGHT = 2;
const STRIDE = 4;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/** An eight bit grey bitmap, which is the shape `readBmpMetaData` accepts. */
function buildBmp(): Buffer {
	const fileSize = DATA_OFFSET + STRIDE * HEIGHT;
	const bmp: Buffer = Buffer.alloc(fileSize, 0x00);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(fileSize, 2);
	bmp.writeUInt32LE(DATA_OFFSET, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(WIDTH, 18);
	bmp.writeInt32LE(HEIGHT, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(8, 28);
	bmp.writeUInt32LE(STRIDE * HEIGHT, 34);
	for (let i = 0; i < 256; i += 1) {
		bmp[BMP_HEADER_SIZE + i * 4] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 1] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 2] = i;
	}
	for (let i = 0; i < STRIDE * HEIGHT; i += 1)
		bmp[DATA_OFFSET + i] = (i * 31 + 6) & 0xff;
	return bmp;
}

function buildPbm(payload = buildBmp(), declared?: number): Buffer {
	const unpackedSize = declared ?? payload.length;
	const size: Buffer = Buffer.alloc(4);
	size.writeUInt32LE(unpackedSize, 0);
	return Buffer.concat([size, lzssLiterals(payload)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("nekopunch pbm image", () => {
	it("declares no signature and the pbm extension", () => {
		expect(pbmImageFormat.detection?.signatures).toEqual([]);
		expect(pbmImageFormat.descriptor.extensions).toEqual(["pbm"]);
	});

	it("decompresses a bitmap whose markers come from the stream", async () => {
		const bmp = buildBmp();
		const stored = buildPbm(bmp);
		// The size word is followed by the stream, so offset four is its first control byte and the `BM` in
		// the bitmap is what the reference's marker check reads.
		expect((stored[STREAM_OFFSET] ?? 0) & 7).toBe(7);
		expect(stored.subarray(5, 7).toString("latin1")).toBe("BM");
		const source = sourceOf(stored);
		expect(await pbmImageFormat.detect(source, "CG01.PBM")).toBe(true);
		const archive = await pbmImageFormat.open(source, "CG01.PBM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
				unpackedSize: bmp.length,
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
		const bmp = buildBmp();
		const padded = Buffer.concat([bmp, Buffer.alloc(16, 0x5a)]);
		const stored = buildPbm(padded, padded.length);
		const archive = await pbmImageFormat.open(sourceOf(stored), "CG01.PBM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(bmp.length);
			expect(output).toEqual(bmp);
		} finally {
			await archive.close();
		}
	});

	it("pads a short stream with zeros", async () => {
		// Only the first sixteen bytes of the bitmap are stored; the rest of the declared size is zeros, so
		// the bitmap header cannot be read and the file is declined.
		const bmp = buildBmp();
		const stored = buildPbm(bmp.subarray(0, 16), bmp.length);
		expect(await pbmImageFormat.detect(sourceOf(stored), "CG01.PBM")).toBe(
			false,
		);
	});

	it("declines a stream whose output is not a bitmap", async () => {
		const stored = buildPbm(Buffer.from("not a bitmap at all", "latin1"));
		expect(await pbmImageFormat.detect(sourceOf(stored), "CG01.PBM")).toBe(
			false,
		);
	});

	it("declines a control byte without the low bits set", async () => {
		const stored = buildPbm();
		stored[STREAM_OFFSET] = 0xf8;
		expect(await pbmImageFormat.detect(sourceOf(stored), "CG01.PBM")).toBe(
			false,
		);
	});

	it("declines a zero or absurd declared size", async () => {
		const bmp = buildBmp();
		const zero = buildPbm(bmp, 0);
		expect(zero.readUInt32LE(0)).toBe(0);
		expect(await pbmImageFormat.detect(sourceOf(zero), "CG01.PBM")).toBe(false);
		const huge = buildPbm(bmp, 0x20000000);
		expect(await pbmImageFormat.detect(sourceOf(huge), "CG01.PBM")).toBe(false);
	});

	it("requires the pbm extension and a full header", async () => {
		const stored = buildPbm();
		expect(await pbmImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			false,
		);
		expect(await pbmImageFormat.detect(sourceOf(stored), "CG01.pbm")).toBe(
			true,
		);
		expect(
			await pbmImageFormat.detect(sourceOf(stored.subarray(0, 7)), "CG01.PBM"),
		).toBe(false);
	});
});
