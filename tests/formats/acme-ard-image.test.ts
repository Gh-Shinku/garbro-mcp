import { BufferByteSource } from "@garbro-mcp/core";
import { ardImageDescriptor, ardImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const WIDTH = 640;
const HEIGHT = 480;
const FILE_SIZE = 0x12c000;
const BMP_HEADER_SIZE = 54;

/** A stored pixel group with four distinct bytes, so a rotation cannot be confused with a swap. */
const GROUP = Buffer.from([0x11, 0x22, 0x33, 0x44]);

/** The whole image, with each group differing from its neighbour. */
function buildArd(): Buffer {
	const pixels: Buffer = Buffer.alloc(FILE_SIZE);
	for (let i = 0; i < pixels.length; i += 4) {
		const index = i / 4;
		pixels[i] = GROUP[0] as number;
		pixels[i + 1] = (GROUP[1] as number) + (index & 0x0f);
		pixels[i + 2] = GROUP[2] as number;
		pixels[i + 3] = GROUP[3] as number;
	}
	return pixels;
}

/** The reference rotates each group left by one byte. */
function rotate(pixels: Buffer): Buffer {
	const output = Buffer.from(pixels);
	for (let i = 0; i < output.length; i += 4) {
		const first = output[i] as number;
		output[i] = output[i + 1] as number;
		output[i + 1] = output[i + 2] as number;
		output[i + 2] = output[i + 3] as number;
		output[i + 3] = first;
	}
	return output;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("acme ard image", () => {
	it("declares no signature and the ard extension", () => {
		expect(ardImageFormat.detection?.signatures).toEqual([]);
		expect(ardImageDescriptor.extensions).toEqual(["ard"]);
		// The reference's constant length is exactly the pixel count of its constant dimensions.
		expect(WIDTH * HEIGHT * 4).toBe(FILE_SIZE);
	});

	it("rotates the stored channels into a bgra bitmap", async () => {
		const stored = buildArd();
		const source = sourceOf(stored);
		expect(await ardImageFormat.detect(source, "CG01.ARD")).toBe(true);
		const archive = await ardImageFormat.open(source, "CG01.ARD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 32,
				pixelFormat: "bgra32",
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(FILE_SIZE));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(18)).toBe(WIDTH);
			// `ImageData.Create` is top down, so the bitmap stores a negative height.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			expect(output.length).toBe(BMP_HEADER_SIZE + FILE_SIZE);
			// A left rotation, not a swap: `11 22 33 44` becomes `22 33 44 11`.
			expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
				Buffer.from([0x22, 0x33, 0x44, 0x11]),
			);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(rotate(stored));
			// The last pixel is rotated too, so the whole image was covered.
			expect(output.subarray(output.length - 4)).toEqual(
				Buffer.from([0x22 + 0x0f, 0x33, 0x44, 0x11]),
			);
		} finally {
			await archive.close();
		}
	}, 30000);

	it("accepts a lower case extension", async () => {
		expect(await ardImageFormat.detect(sourceOf(buildArd()), "cg01.ard")).toBe(
			true,
		);
	});

	it("declines a file whose name is not ard", async () => {
		expect(await ardImageFormat.detect(sourceOf(buildArd()), "CG01.BIN")).toBe(
			false,
		);
	});

	it("declines a file whose length is not exact", async () => {
		const shorter = buildArd().subarray(0, FILE_SIZE - 4);
		expect(await ardImageFormat.detect(sourceOf(shorter), "CG01.ARD")).toBe(
			false,
		);
		const longer = Buffer.concat([buildArd(), Buffer.alloc(4)]);
		expect(await ardImageFormat.detect(sourceOf(longer), "CG01.ARD")).toBe(
			false,
		);
	}, 30000);
});
