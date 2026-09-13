import { BufferByteSource } from "@garbro-mcp/core";
import { befAlpImageDescriptor, befAlpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const WIDTH = 320;
const HEIGHT = 480;
const FILE_SIZE = 0x25800;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

/** The stored mask, with samples cycling through the six bit range. */
function buildAlp(): Buffer {
	const pixels: Buffer = Buffer.alloc(FILE_SIZE);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = i & 0x3f;
	return pixels;
}

/** The reference's expansion: multiply, divide in integers, then truncate to a byte. */
function expand(value: number): number {
	return Math.trunc((value * 0xff) / 0x40) & 0xff;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("bef alp bitmap mask", () => {
	it("declares no signature and the alp extension", () => {
		expect(befAlpImageFormat.detection?.signatures).toEqual([]);
		expect(befAlpImageDescriptor.extensions).toEqual(["alp"]);
		// The reference's constant length is exactly the pixel count of its constant dimensions.
		expect(WIDTH * HEIGHT).toBe(FILE_SIZE);
	});

	it("expands the six bit samples into a grey bitmap", async () => {
		const stored = buildAlp();
		const source = sourceOf(stored);
		expect(await befAlpImageFormat.detect(source, "MASK01.ALP")).toBe(true);
		const archive = await befAlpImageFormat.open(source, "MASK01.ALP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"MASK01.bmp",
			]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(FILE_SIZE));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			// `ImageData.Create` is top down, so the bitmap stores a negative height.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			expect(output.readUInt32LE(18)).toBe(WIDTH);
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.length).toBe(DATA_OFFSET + FILE_SIZE);
			// The palette is the standard grey ramp.
			expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
				Buffer.from([0x00, 0x00, 0x00, 0x00]),
			);
			expect(output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8)).toEqual(
				Buffer.from([0x01, 0x01, 0x01, 0x00]),
			);
			// Spot check the expansion at the ends of the stored range.
			expect(output.readUInt8(DATA_OFFSET)).toBe(0);
			expect(output.readUInt8(DATA_OFFSET + 0x20)).toBe(expand(0x20));
			// Only an input of exactly 0x40 reaches full scale; 0x3F maps to 251, not 255.
			expect(expand(0x3f)).toBe(251);
			expect(expand(0x40)).toBe(255);
			expect(output.readUInt8(DATA_OFFSET + 0x3f)).toBe(expand(0x3f));
		} finally {
			await archive.close();
		}
	});

	it("wraps samples above the six bit range instead of saturating", async () => {
		const stored = buildAlp();
		stored[0] = 0xff;
		stored[1] = 0x41;
		stored[2] = 0x40;
		const archive = await befAlpImageFormat.open(
			sourceOf(stored),
			"MASK02.ALP",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The reference casts an `int` result to `byte`, so 0xFF wraps to 248 rather than staying 255.
			expect(expand(0xff)).toBe(248);
			expect(output.readUInt8(DATA_OFFSET)).toBe(248);
			expect(expand(0x41)).toBe(2);
			expect(output.readUInt8(DATA_OFFSET + 1)).toBe(2);
			// A sample of exactly 0x40 is the only one that saturates.
			expect(output.readUInt8(DATA_OFFSET + 2)).toBe(255);
		} finally {
			await archive.close();
		}
	});

	it("accepts an upper case extension", async () => {
		expect(
			await befAlpImageFormat.detect(sourceOf(buildAlp()), "MASK01.Alp"),
		).toBe(true);
	});

	it("declines a file whose name is not alp", async () => {
		expect(
			await befAlpImageFormat.detect(sourceOf(buildAlp()), "MASK01.BIN"),
		).toBe(false);
	});

	it("declines a file whose length is not exact", async () => {
		const shorter = buildAlp().subarray(0, FILE_SIZE - 1);
		expect(
			await befAlpImageFormat.detect(sourceOf(shorter), "MASK01.ALP"),
		).toBe(false);
		const longer = Buffer.concat([buildAlp(), Buffer.from([0x00])]);
		expect(await befAlpImageFormat.detect(sourceOf(longer), "MASK01.ALP")).toBe(
			false,
		);
	});
});
