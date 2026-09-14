import { BufferByteSource } from "@garbro-mcp/core";
import { ai5Msk16ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 4;
const BMP_HEADER_SIZE = 54;
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + 0x100 * 4;

/** A stored mask: four bytes of measurements and one byte a pixel, and nothing else. */
function buildMsk16(width: number, height: number, pixels: number[]): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt16LE(width, 0);
	header.writeInt16LE(height, 2);
	return Buffer.concat([header, Buffer.from(pixels)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.msk"): Promise<Buffer> {
	const archive = await ai5Msk16ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Ai5 engine stored image mask (MSK/G16)", () => {
	it("claims the msk extension and no word", () => {
		expect(ai5Msk16ImageFormat.detection?.signatures).toEqual([]);
		expect(ai5Msk16ImageFormat.descriptor.extensions).toEqual(["msk"]);
	});

	it("wants the file to be exactly the pixels and its four bytes", async () => {
		const file = buildMsk16(2, 2, [1, 2, 3, 4]);
		expect(await ai5Msk16ImageFormat.detect(sourceOf(file), "a.msk")).toBe(
			true,
		);
		expect(await ai5Msk16ImageFormat.detect(sourceOf(file), "a.MSK")).toBe(
			true,
		);
		// A mask of another name is none of its own, however well it holds together.
		expect(await ai5Msk16ImageFormat.detect(sourceOf(file), "a.g24")).toBe(
			false,
		);
		// One byte more or less than the pixels is one too many or too few.
		expect(
			await ai5Msk16ImageFormat.detect(
				sourceOf(buildMsk16(2, 2, [1, 2, 3, 4, 5])),
				"a.msk",
			),
		).toBe(false);
		expect(
			await ai5Msk16ImageFormat.detect(
				sourceOf(buildMsk16(2, 2, [1, 2, 3])),
				"a.msk",
			),
		).toBe(false);
		expect(
			await ai5Msk16ImageFormat.detect(sourceOf(buildMsk16(0, 2, [])), "a.msk"),
		).toBe(false);
		expect(
			await ai5Msk16ImageFormat.detect(
				sourceOf(buildMsk16(2, 0x1001, [])),
				"a.msk",
			),
		).toBe(false);
	});

	it("scales the eight levels of the mask in whole numbers, wrap and all", async () => {
		const file = buildMsk16(4, 1, [0, 4, 8, 9]);
		const archive = await ai5Msk16ImageFormat.open(sourceOf(file), "CG01.msk");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// The stored pixels are not compressed, and the mask keeps no position of its own.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 1,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.metadata).not.toHaveProperty("offsetX");
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
				width: 4,
				height: 1,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(bmp.readInt32LE(22)).toBe(-1);
		// Eight levels of a mask reach two hundred and fifty six of grey; a level above the eighth is scaled
		// in whole numbers and then held to a byte, which wraps it around rather than making it white.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 4)).toEqual(
			Buffer.from([0x00, 0x7f, 0xff, 0x1e]),
		);
	});

	it("pads its rows the way a bitmap of eight bits does", async () => {
		const bmp = await extract(buildMsk16(3, 2, [1, 2, 3, 4, 5, 6]));
		// The rows of a bitmap are a multiple of four, and this one is not padded by the file at all.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 8)).toEqual(
			Buffer.from([0x1f, 0x3f, 0x5f, 0x00, 0x7f, 0x9f, 0xbf, 0x00]),
		);
		expect(bmp.length).toBe(BMP_PIXELS_OFFSET + 8);
	});
});
