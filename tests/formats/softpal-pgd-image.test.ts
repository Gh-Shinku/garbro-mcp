// The walk of the places of the file of a picture of this port and of an apart walk of the same reference
// stand of the same places of the file of the pictures of the engine itself.
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	composePgd3,
	pgd00ImageFormat,
	pgd11ImageFormat,
	pgd3ImageFormat,
	pgdGeImageFormat,
	pgdTgaImageFormat,
	readPgd00Layout,
	readPgd11Layout,
	readPgd3Layout,
	readPgdTgaLayout,
	readPgdGeLayout,
	readPgd3Baseline,
	unpackPgd00Picture,
	unpackPgd11Pixels,
	unpackPgd3Pixels,
	unpackPgdGePixels,
	unpackPgdTgaPicture,
} from "../../packages/formats/src/softpal/pgd-image.js";

const PGD11 = Buffer.from([
	0x47, 0x45, 0x1c, 0x00, 0x07, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x31, 0x31, 0x5f, 0x43, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x10, 0x10, 0x11, 0x12, 0x13, 0x20, 0x21, 0x22, 0x23, 0x30, 0x31,
	0x32, 0x33, 0x40, 0x41, 0x42, 0x43,
]);

const PGD11_MATCH = Buffer.from([
	0x47, 0x45, 0x1c, 0x00, 0x07, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x03,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x31, 0x31, 0x5f, 0x43, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x02, 0x04, 0xb0, 0xb1, 0xb2, 0xb3, 0x00, 0x00, 0x08,
]);

const PGD00 = Buffer.from([
	0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x30,
	0x5f, 0x43, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0x00,
	0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
	0x02, 0x00, 0x18, 0x20, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
	0x0a, 0x0b, 0x0c,
]);

const PGD_TGA = Buffer.from([
	0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02,
	0x00, 0x18, 0x20, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
	0x0b, 0x0c,
]);

const PGD_GE1 = Buffer.from([
	0x47, 0x45, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x10, 0x40, 0x41, 0x42, 0x43, 0x30, 0x31, 0x32, 0x33, 0x20, 0x21,
	0x22, 0x23, 0x10, 0x11, 0x12, 0x13,
]);

const PGD_GE2 = Buffer.from([
	0x47, 0x45, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04,
	0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x28, 0x00, 0x0a, 0x14, 0x1e, 0x00, 0xf6, 0x14, 0xe2, 0x40, 0x41,
	0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e,
	0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b,
	0x5c, 0x5d, 0x5e, 0x5f,
]);

const PGD_GE3 = Buffer.from([
	0x47, 0x45, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09,
	0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x1a, 0x00, 0x00, 0x20, 0x00, 0x02, 0x00, 0x02, 0x00, 0x01, 0x01,
	0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x05, 0x06, 0x07, 0x08, 0x01,
	0x01, 0x01, 0x01,
]);

const PGD_GE9 = Buffer.from([
	0x47, 0x45, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x10, 0x40, 0x41, 0x42, 0x43, 0x30, 0x31, 0x32, 0x33, 0x20, 0x21,
	0x22, 0x23, 0x10, 0x11, 0x12, 0x13,
]);

const PGD3 = Buffer.from([
	0x50, 0x47, 0x44, 0x33, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x20,
	0x00, 0x62, 0x61, 0x73, 0x65, 0x2e, 0x67, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x01, 0x11, 0x22, 0x33, 0x44, 0x00, 0x00,
	0x00, 0x00,
]);

const BASE_PX = Buffer.from([
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
	0x0e, 0x0f, 0x10,
]);

/** The places of the file of a picture of the engine, of the places of the file of the BMP of it. */
function pixelsOf(bmp: Buffer, count: number): number[] {
	const at = bmp.readUInt32LE(0x0a);
	return [...bmp.subarray(at, at + count)];
}

describe("Amuse Craft engine pictures", () => {
	it("reads the head of a picture of the first kind of the engine", () => {
		const layout = readPgd11Layout(PGD11);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.offsetX).toBe(7);
		expect(layout?.offsetY).toBe(9);
		expect(readPgd11Layout(PGD11.subarray(0, 0x1f))).toBeUndefined();
		const other = Buffer.from(PGD11);
		other[0x1c] = 0x21;
		expect(readPgd11Layout(other)).toBeUndefined();
	});

	it("walks the places of the file of a picture of the first kind of the engine", () => {
		expect([...unpackPgd11Pixels(PGD11)]).toEqual([
			0x10, 0x20, 0x30, 0x40, 0x11, 0x21, 0x31, 0x41, 0x12, 0x22, 0x32, 0x42,
			0x13, 0x23, 0x33, 0x43,
		]);
	});

	it("walks the places of the file of a picture of the first kind of the engine of a match of the walk of it", () => {
		// The places of the file of the walk of the engine of the places of the picture of it stand of the
		// places of the file of the walk of the picture before them: the places of the file of the walk of
		// this port and of an apart walk of the same reference stand of the same places of the file of the
		// picture of the engine itself.
		expect([...unpackPgd11Pixels(PGD11_MATCH)]).toEqual([
			0xb0, 0xb3, 0xb2, 0xb1, 0xb1, 0xb0, 0xb3, 0xb2, 0xb2, 0xb1, 0xb0, 0xb3,
		]);
	});

	it("reads the head of a picture of the second kind of the engine", () => {
		const layout = readPgd00Layout(PGD00);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.offsetX).toBe(3);
		expect(layout?.offsetY).toBe(4);
		expect(readPgd00Layout(PGD00.subarray(0, 0x23))).toBeUndefined();
	});

	it("walks the places of a picture of the second kind of the engine, of a TGA of it", () => {
		// The walk of the places of the file of the engine of the second kind stands of a picture of the
		// TGA behind the places of the file of the walk of it.
		const bmp = unpackPgd00Picture(PGD00);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(Math.abs(bmp.readInt32LE(0x16))).toBe(2);
		const at = bmp.readUInt32LE(0x0a);
		expect([...bmp.subarray(at, at + 6)]).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...bmp.subarray(at + 8, at + 14)]).toEqual([7, 8, 9, 10, 11, 12]);
	});

	it("reads the head of a picture of the third kind of the engine", () => {
		const layout = readPgdTgaLayout(PGD_TGA);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.offsetX).toBe(1);
		expect(layout?.offsetY).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		// The places of the file of the picture of the engine of the walk of the places of the file of the
		// walk of it of the places of the file of the picture of the engine before the walk of it stand of
		// no places of the file of the walk of the engine.
		const other = Buffer.from(PGD_TGA);
		other.writeUInt32LE(3, 8);
		expect(readPgdTgaLayout(other)).toBeUndefined();
		const far = Buffer.from(PGD_TGA);
		far.writeInt32LE(0x2001, 0);
		expect(readPgdTgaLayout(far)).toBeUndefined();
	});

	it("walks the places of a picture of the third kind of the engine", () => {
		const bmp = unpackPgdTgaPicture(PGD_TGA);
		const at = bmp.readUInt32LE(0x0a);
		expect([...bmp.subarray(at, at + 6)]).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...bmp.subarray(at + 8, at + 14)]).toEqual([7, 8, 9, 10, 11, 12]);
	});

	it("reads the head of a picture of the fourth kind of the engine", () => {
		const layout = readPgdGeLayout(PGD_GE1);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.method).toBe(1);
		const other = Buffer.from(PGD_GE1);
		other[1] = 0x46;
		expect(readPgdGeLayout(other)).toBeUndefined();
	});

	it("walks the places of a picture of the fourth kind of the engine, of the first walk of it", () => {
		const layout = readPgdGeLayout(PGD_GE1);
		if (!layout) throw new Error("no picture");
		const pixels = unpackPgdGePixels(PGD_GE1, layout);
		expect(pixels.format).toBe("bgra32");
		expect([...pixels.data]).toEqual([
			0x10, 0x20, 0x30, 0x40, 0x11, 0x21, 0x31, 0x41, 0x12, 0x22, 0x32, 0x42,
			0x13, 0x23, 0x33, 0x43,
		]);
	});

	it("walks the places of a picture of the fourth kind of the engine, of the second walk of it", () => {
		// The second walk of the engine stands of the places of the file of the picture of two tables of
		// the colour of it: the places of the file of the walk of this port and of an apart walk of the
		// same reference stand of the same places of the file of the picture of the engine itself.
		const layout = readPgdGeLayout(PGD_GE2);
		if (!layout) throw new Error("no picture");
		const pixels = unpackPgdGePixels(PGD_GE2, layout);
		expect(pixels.format).toBe("bgr24");
		expect([...pixels.data]).toEqual([
			0x40, 0x40, 0x40, 0x41, 0x41, 0x41, 0x53, 0x45, 0x34, 0x54, 0x46, 0x35,
			0x44, 0x44, 0x44, 0x45, 0x45, 0x45, 0x57, 0x49, 0x38, 0x58, 0x4a, 0x39,
			0x6b, 0x33, 0x63, 0x6c, 0x34, 0x64, 0x7e, 0x54, 0x20, 0x7f, 0x55, 0x21,
			0x6f, 0x37, 0x67, 0x70, 0x38, 0x68, 0x82, 0x58, 0x24, 0x83, 0x59, 0x25,
		]);
	});

	it("walks the places of a picture of the fourth kind of the engine, of the third walk of it", () => {
		// The third walk of the engine stands of the head of the walk of the places of the file of it: the
		// places of the file of the picture of the engine stand of the places of the file of the head of the
		// picture of it, of no places of the file of the head of the walk of the engine.
		const layout = readPgdGeLayout(PGD_GE3);
		if (!layout) throw new Error("no picture");
		const pixels = unpackPgdGePixels(PGD_GE3, layout);
		expect(pixels.format).toBe("bgra32");
		expect([...pixels.data]).toEqual([
			0x01, 0x02, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
			0x04, 0x05, 0x06, 0x07,
		]);
	});

	it("stands of a walk of a picture of the fourth kind of the engine of no places of the file of it", () => {
		const layout = readPgdGeLayout(PGD_GE9);
		if (!layout) throw new Error("no picture");
		expect(() => unpackPgdGePixels(PGD_GE9, layout)).toThrow(/no places/);
	});

	it("reads the head of a picture of the places of the picture of the engine", () => {
		const layout = readPgd3Layout(PGD3);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(32);
		expect(layout?.baseName).toBe("base.ge");
		expect(readPgd3Layout(PGD3.subarray(0, 0x2f))).toBeUndefined();
	});

	it("walks the places of the picture of the places of the picture of the engine", () => {
		const layout = readPgd3Layout(PGD3);
		if (!layout) throw new Error("no picture");
		expect([...unpackPgd3Pixels(PGD3, layout).data]).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44,
		]);
	});

	it("stands of the picture of the places of the picture of the engine of the picture before it", () => {
		const layout = readPgd3Layout(PGD3);
		if (!layout) throw new Error("no picture");
		const base = { format: "bgra32" as const, data: BASE_PX };
		const composite = composePgd3(
			base,
			2,
			unpackPgd3Pixels(PGD3, layout),
			layout,
		);
		expect([...composite.data]).toEqual([
			0x10, 0x20, 0x30, 0x40, 0x14, 0x24, 0x34, 0x4c, 0x09, 0x0a, 0x0b, 0x0c,
			0x0d, 0x0e, 0x0f, 0x10,
		]);
	});

	it("stands of no walk of a picture of the places of the picture of the engine of no places of it", async () => {
		// The places of the file of the picture before the walk of the picture of the engine stand of the
		// file of the places of the file of the picture of the engine itself: the walk of the places of the
		// file of the picture of the engine stands of the walk of the places of the file of it of no
		// places of the file of the picture of the engine.
		await expect(readPgd3Baseline("../base.ge", "/tmp/x.pgd")).rejects.toThrow(
			/outside the file/,
		);
		await expect(readPgd3Baseline("C:ase.ge", "/tmp/x.pgd")).rejects.toThrow(
			/outside the file/,
		);
		await expect(
			readPgd3Baseline("base.ge", "/tmp/pgd-of-no-places/x.pgd"),
		).rejects.toThrow(/no places of the file/);
	});

	it("reads the places of the file of a picture of the places of the picture of the engine", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pgd-"));
		try {
			const basePath = join(dir, "base.ge");
			const overlayPath = join(dir, "over.pgd");
			await writeFile(basePath, PGD_GE1);
			await writeFile(overlayPath, PGD3);
			const source = await FileByteSource.open(overlayPath);
			const handle = await pgd3ImageFormat.open(source, overlayPath);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const content = await consumeBuffer(await handle.openEntry(entry.id));
			expect(content.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(content.readInt32LE(0x12)).toBe(2);
			expect(Math.abs(content.readInt32LE(0x16))).toBe(2);
			expect(pixelsOf(content, 16)).toEqual([
				0x01, 0x02, 0x03, 0x04, 0x00, 0x03, 0x02, 0x05, 0x12, 0x22, 0x32, 0x42,
				0x13, 0x23, 0x33, 0x43,
			]);
			// The head of the picture of the engine of the walk of the places of the file of it.
			const listed = await pgd3ImageFormat.open(source, overlayPath);
			expect(listed.metadata?.width).toBe(2);
			expect(listed.metadata?.height).toBe(2);
			expect(listed.metadata?.bitsPerPixel).toBe(32);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("stands of the walk of the places of the file of the four kinds of the engine", async () => {
		for (const [format, data, name] of [
			[pgd11ImageFormat, PGD11, "a.pgd"],
			[pgd00ImageFormat, PGD00, "b.pgd"],
			[pgdTgaImageFormat, PGD_TGA, "c.pgd"],
			[pgdGeImageFormat, PGD_GE1, "d.pgd"],
		] as const) {
			expect(await format.detect(new BufferByteSource(data), name)).toBe(true);
			expect(
				await format.detect(new BufferByteSource(Buffer.alloc(0x40)), name),
			).toBe(false);
			const handle = await format.open(new BufferByteSource(data), name);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const content = await consumeBuffer(await handle.openEntry(entry.id));
			expect(content.subarray(0, 2).toString("latin1")).toBe("BM");
		}
	});
});
