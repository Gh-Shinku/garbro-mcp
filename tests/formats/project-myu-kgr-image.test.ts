import { BufferByteSource } from "@garbro-mcp/core";
import { kgrImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x36;
const BMP_HEADER_SIZE = 54;

function buildPixels(size: number): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 47 + 13) & 0xff;
	return pixels;
}

function buildKgr(options: {
	width: number;
	height: number;
	bpp: number;
	pixels?: Buffer;
	sizeFields?: boolean;
	tail?: number;
}): Buffer {
	const bytesPerRow = (options.width * options.bpp) / 8;
	const pixels = options.pixels ?? buildPixels(bytesPerRow * options.height);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	if (options.sizeFields) {
		// The reference never reads either of these.
		header.writeUInt32LE(0xdeadbeef, 2);
		header.writeUInt32LE(0x11223344, 0x0a);
	} else {
		header.writeUInt32LE(HEADER_SIZE + pixels.length, 2);
		header.writeUInt32LE(HEADER_SIZE, 0x0a);
	}
	header.writeUInt32LE(options.width, 0x12);
	header.writeUInt32LE(options.height, 0x16);
	header.writeUInt16LE(options.bpp, 0x1c);
	return Buffer.concat([header, pixels, Buffer.alloc(options.tail ?? 0, 0x77)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("project-myu kgr image", () => {
	it("declares no signature and the kgr extension", () => {
		expect(kgrImageFormat.detection?.signatures).toEqual([]);
		expect(kgrImageFormat.descriptor.extensions).toEqual(["kgr"]);
	});

	it("writes a bottom up 24 bit bitmap from packed rows", async () => {
		// Three pixels a row is nine bytes, which the bitmap pads to twelve.
		const stored = buildKgr({ width: 3, height: 2, bpp: 24 });
		const source = sourceOf(stored);
		expect(await kgrImageFormat.detect(source, "CG01.KGR")).toBe(true);
		const archive = await kgrImageFormat.open(source, "CG01.KGR");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
				bytesPerRow: 9,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(24);
			expect(output.readInt32LE(22)).toBe(2);
			expect(output.length).toBe(BMP_HEADER_SIZE + 12 * 2);
			const body = output.subarray(BMP_HEADER_SIZE);
			const pixels = buildPixels(9 * 2);
			for (let row = 0; row < 2; row += 1) {
				expect(body.subarray(row * 12, row * 12 + 9)).toEqual(
					pixels.subarray(row * 9, row * 9 + 9),
				);
				expect(body.subarray(row * 12 + 9, (row + 1) * 12)).toEqual(
					Buffer.alloc(3),
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("declares six green bits for a sixteen bit image", async () => {
		const pixels = buildPixels(4 * 2);
		const stored = buildKgr({ width: 2, height: 2, bpp: 16, pixels });
		const archive = await kgrImageFormat.open(sourceOf(stored), "CG01.KGR");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(16);
			expect(output.readUInt32LE(30)).toBe(3);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + 12);
			// `Bgr565` means the red mask is 0xF800; a five bit writer would put 0x7C00 here.
			expect(output.readUInt32LE(54)).toBe(0xf800);
			expect(output.readUInt32LE(58)).toBe(0x07e0);
			expect(output.readUInt32LE(62)).toBe(0x001f);
			expect(output.readInt32LE(22)).toBe(2);
			expect(output.subarray(BMP_HEADER_SIZE + 12)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("ignores the bitmap size and pixel offset fields", async () => {
		// The reference reads neither, and the pixels always start at the end of its header.
		const stored = buildKgr({
			width: 2,
			height: 2,
			bpp: 24,
			sizeFields: true,
		});
		expect(stored.readUInt32LE(2)).toBe(0xdeadbeef);
		expect(stored.readUInt32LE(0x0a)).toBe(0x11223344);
		const archive = await kgrImageFormat.open(sourceOf(stored), "CG01.KGR");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const pixels = buildPixels(6 * 2);
			expect(output.readUInt16LE(28)).toBe(24);
			// Two pixel rows are six bytes each and the bitmap pads them to eight.
			expect(output.length).toBe(BMP_HEADER_SIZE + 8 * 2);
			const body = output.subarray(BMP_HEADER_SIZE);
			expect(body.subarray(0, 6)).toEqual(pixels.subarray(0, 6));
			expect(body.subarray(6, 8)).toEqual(Buffer.alloc(2));
			expect(body.subarray(8, 14)).toEqual(pixels.subarray(6, 12));
			expect(body.subarray(14, 16)).toEqual(Buffer.alloc(2));
		} finally {
			await archive.close();
		}
	});

	it("declines an unsupported bit depth", async () => {
		// Eight and thirty two bit images are not accepted, and neither is a sixteen bit value written in the
		// wrong byte order.
		expect(
			await kgrImageFormat.detect(
				sourceOf(buildKgr({ width: 2, height: 2, bpp: 8 })),
				"CG01.KGR",
			),
		).toBe(false);
		expect(
			await kgrImageFormat.detect(
				sourceOf(buildKgr({ width: 2, height: 2, bpp: 32 })),
				"CG01.KGR",
			),
		).toBe(false);
	});

	it("requires the kgr extension", async () => {
		const stored = buildKgr({ width: 2, height: 2, bpp: 24 });
		expect(await kgrImageFormat.detect(sourceOf(stored), "CG01.BMP")).toBe(
			false,
		);
		expect(await kgrImageFormat.detect(sourceOf(stored), "CG01.kgr")).toBe(
			true,
		);
	});

	it("lists a short image but fails to extract it", async () => {
		const full = buildKgr({ width: 2, height: 2, bpp: 24 });
		const short = full.subarray(0, full.length - 3);
		expect(await kgrImageFormat.detect(sourceOf(short), "CG01.KGR")).toBe(true);
		const archive = await kgrImageFormat.open(sourceOf(short), "CG01.KGR");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions, a short header and a wrong marker", async () => {
		expect(
			await kgrImageFormat.detect(
				sourceOf(
					buildKgr({ width: 0, height: 2, bpp: 24, pixels: Buffer.alloc(0) }),
				),
				"CG01.KGR",
			),
		).toBe(false);
		expect(
			await kgrImageFormat.detect(
				sourceOf(
					buildKgr({ width: 2, height: 2, bpp: 24 }).subarray(
						0,
						HEADER_SIZE - 1,
					),
				),
				"CG01.KGR",
			),
		).toBe(false);
		const wrong = buildKgr({ width: 2, height: 2, bpp: 24 });
		wrong[1] = 0x4e;
		expect(await kgrImageFormat.detect(sourceOf(wrong), "CG01.KGR")).toBe(
			false,
		);
	});
});
