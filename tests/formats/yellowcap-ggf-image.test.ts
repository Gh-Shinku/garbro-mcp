import { BufferByteSource } from "@garbro-mcp/core";
import { ggfImageDescriptor, ggfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_OFFSET = 8;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	bitmap: Buffer;
	width: number;
	height: number;
}

/** A twenty four bit bitmap; a negative height makes it top down, which the header records unsigned. */
function buildBmp(width = 3, height = 2, topDown = false): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const pixels: Buffer = Buffer.alloc(stride * Math.abs(height), 0x50);
	const bitmap: Buffer = Buffer.alloc(BMP_HEADER_SIZE + pixels.length, 0);
	bitmap.write("BM", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length, 2);
	bitmap.writeUInt32LE(BMP_HEADER_SIZE, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(width, 18);
	bitmap.writeInt32LE(topDown ? -height : height, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(24, 28);
	bitmap.writeUInt32LE(pixels.length, 34);
	pixels.copy(bitmap, BMP_HEADER_SIZE);
	return bitmap;
}

/** Eight bytes that repeat the bitmap's dimensions, then the bitmap itself. */
function buildGgf(
	bitmap = buildBmp(),
	trailing = 0,
	declared?: { width: number; height: number },
): Built {
	const width = declared?.width ?? bitmap.readInt32LE(18);
	const height = declared?.height ?? Math.abs(bitmap.readInt32LE(22));
	const header: Buffer = Buffer.alloc(BMP_OFFSET, 0x24);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	return {
		file: Buffer.concat([header, bitmap, Buffer.alloc(trailing, 0x66)]),
		bitmap,
		width,
		height,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("yellowcap ggf image", () => {
	it("declares no signature and the ggf extension", () => {
		expect(ggfImageFormat.detection?.signatures).toEqual([]);
		expect(ggfImageDescriptor.extensions).toEqual(["ggf"]);
	});

	it("extracts the embedded bitmap unchanged", async () => {
		const built = buildGgf();
		const source = sourceOf(built.file);
		expect(await ggfImageFormat.detect(source, "EV01.GGF")).toBe(true);
		const archive = await ggfImageFormat.open(source, "EV01.GGF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(built.bitmap.length));
			expect(built.file.length - BMP_OFFSET).toBe(built.bitmap.length);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.bitmap);
			// The eight byte header is not part of the extracted stream.
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.length).toBe(built.bitmap.length);
		} finally {
			await archive.close();
		}
	});

	it("accepts a top down bitmap whose height is stored negative", async () => {
		const bitmap = buildBmp(4, 3, true);
		expect(bitmap.readInt32LE(22)).toBe(-3);
		const built = buildGgf(bitmap);
		expect(built.height).toBe(3);
		expect(await ggfImageFormat.detect(sourceOf(built.file), "EV02.GGF")).toBe(
			true,
		);
		const archive = await ggfImageFormat.open(sourceOf(built.file), "EV02.GGF");
		try {
			// GARbro reports the absolute height, and the header's copy agrees with it.
			expect(archive.metadata).toMatchObject({ width: 4, height: 3 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bitmap);
		} finally {
			await archive.close();
		}
	});

	it("passes trailing bytes through, since the embedded stream is the bitmap", async () => {
		const built = buildGgf(buildBmp(3, 2), 0x10);
		const archive = await ggfImageFormat.open(sourceOf(built.file), "EV03.GGF");
		try {
			expect(archive.entries[0]?.size).toBe(BigInt(built.bitmap.length + 0x10));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(built.bitmap.length + 0x10);
			expect(output.subarray(0, built.bitmap.length)).toEqual(built.bitmap);
		} finally {
			await archive.close();
		}
	});

	it("declines a bitmap whose height differs from the header copy", async () => {
		const built = buildGgf(buildBmp(3, 2), 0, { width: 3, height: 5 });
		expect(await ggfImageFormat.detect(sourceOf(built.file), "EV01.GGF")).toBe(
			false,
		);
	});

	it("declines a bitmap whose width differs from the header copy", async () => {
		const built = buildGgf(buildBmp(3, 2), 0, { width: 4, height: 2 });
		expect(await ggfImageFormat.detect(sourceOf(built.file), "EV01.GGF")).toBe(
			false,
		);
	});

	it("declines a file without the embedded BM marker", async () => {
		const built = buildGgf();
		// 0x42 is 'B', so break the second byte of the marker instead.
		built.file[BMP_OFFSET + 1] = 0x4e;
		expect(await ggfImageFormat.detect(sourceOf(built.file), "EV01.GGF")).toBe(
			false,
		);
	});

	it("declines an OS/2 core header", async () => {
		const bitmap = buildBmp();
		bitmap.writeUInt32LE(12, 14);
		expect(
			await ggfImageFormat.detect(sourceOf(buildGgf(bitmap).file), "EV01.GGF"),
		).toBe(false);
	});

	it("declines a file shorter than the embedded bitmap header", async () => {
		expect(
			await ggfImageFormat.detect(
				sourceOf(Buffer.alloc(BMP_OFFSET + 0x20)),
				"EV01.GGF",
			),
		).toBe(false);
	});
});
