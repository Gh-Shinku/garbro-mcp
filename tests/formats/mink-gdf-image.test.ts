import { BufferByteSource } from "@garbro-mcp/core";
import { gdfImageDescriptor, gdfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const TAG = "GD";

/** A thirty two bit bitmap whose first two bytes are replaced by the tag. */
function buildGdf(width = 2, height = 2): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 4, 0x33);
	const bitmap: Buffer = Buffer.alloc(BMP_HEADER_SIZE + pixels.length, 0);
	bitmap.write("BM", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length, 2);
	bitmap.writeUInt32LE(BMP_HEADER_SIZE, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(width, 18);
	// A negative height marks the rows as top down, which the metadata reader reports unsigned.
	bitmap.writeInt32LE(-height, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(32, 28);
	bitmap.writeUInt32LE(pixels.length, 34);
	pixels.copy(bitmap, BMP_HEADER_SIZE);
	bitmap.write(TAG, 0, "latin1");
	return bitmap;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("mink gdf obfuscated bitmap", () => {
	it("declares no signature and the gdf extension", () => {
		expect(gdfImageFormat.detection?.signatures).toEqual([]);
		expect(gdfImageDescriptor.extensions).toEqual(["gdf"]);
	});

	it("restores the marker of a top down bitmap", async () => {
		const stored = buildGdf();
		const source = sourceOf(stored);
		expect(await gdfImageFormat.detect(source, "CG01.GDF")).toBe(true);
		const archive = await gdfImageFormat.open(source, "CG01.GDF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// The stored height is negative, but the reported one is its absolute value.
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				storedTag: TAG,
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(stored.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.subarray(2)).toEqual(stored.subarray(2));
			// The negative height survives untouched, since only the marker is rewritten.
			expect(output.readInt32LE(22)).toBe(-2);
		} finally {
			await archive.close();
		}
	});

	it("declines a bitmap tagged for another subclass", async () => {
		const stored = buildGdf();
		stored.write("NG", 0, "latin1");
		expect(await gdfImageFormat.detect(sourceOf(stored), "CG01.GDF")).toBe(
			false,
		);
	});

	it("declines a payload that is not a bitmap", async () => {
		const stored = buildGdf();
		stored.writeUInt16LE(0, 28);
		expect(await gdfImageFormat.detect(sourceOf(stored), "CG01.GDF")).toBe(
			false,
		);
	});
});
