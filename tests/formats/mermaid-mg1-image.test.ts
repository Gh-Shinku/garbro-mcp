import { BufferByteSource } from "@garbro-mcp/core";
import { mermaidMg1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x36;
const PIXEL_OFFSET = 54;

function buildMg1(
	width: number,
	height: number,
	bits: number,
	imageOffset: number,
	body: Buffer,
): Buffer {
	const header: Buffer = Buffer.alloc(Math.max(imageOffset, HEADER_SIZE), 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(imageOffset, 0x0a);
	header.writeInt32LE(width, 0x12);
	header.writeUInt32LE(height, 0x16);
	header.writeInt16LE(bits, 0x1c);
	return Buffer.concat([header, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer, name: string): Promise<Buffer> {
	const archive = await mermaidMg1ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Mermaid obfuscated bitmap", () => {
	it("finds its files by either of two names", async () => {
		const body = Buffer.alloc(0x33, 0x00);
		const file = buildMg1(11, 1, 24, 0x40, body);
		expect(
			await mermaidMg1ImageFormat.detect(sourceOf(file), "image.mg1"),
		).toBe(true);
		expect(
			await mermaidMg1ImageFormat.detect(sourceOf(file), "image.mg2"),
		).toBe(true);
		// The reference asks for its own two extensions.
		expect(
			await mermaidMg1ImageFormat.detect(sourceOf(file), "image.bmp"),
		).toBe(false);
		const plain = buildMg1(11, 1, 24, 0x40, body);
		plain.write("BM", 0, "latin1");
		plain[0] = 0x00;
		expect(
			await mermaidMg1ImageFormat.detect(sourceOf(plain), "image.mg1"),
		).toBe(false);
		expect(
			await mermaidMg1ImageFormat.detect(
				sourceOf(buildMg1(0, 1, 24, 0x40, body)),
				"image.mg1",
			),
		).toBe(false);
		expect(
			await mermaidMg1ImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1, 0x00)),
				"image.mg1",
			),
		).toBe(false);
	});

	it("puts five columns of an image back into its rows", async () => {
		// Five pixels to a row, three bytes a pixel, so a piece of the image is one pixel wide and one tall.
		const file = buildMg1(
			5,
			5,
			24,
			0x40,
			// The pieces are stored by column from the last one up, and within a piece by row.
			Buffer.from(
				Array.from({ length: 5 }, (_, column) =>
					Array.from({ length: 5 }, (_, row) => [row, 4 - column, 0xee]),
				)
					.flat(2)
					.flat(),
			),
		);
		const archive = await mermaidMg1ImageFormat.open(
			sourceOf(file),
			"picture.mg1",
		);
		try {
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 5,
				height: 5,
				bitsPerPixel: 24,
				imageOffset: 0x40,
				tileCount: 5,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "tile-shuffled",
				tileCount: 5,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file, "picture.mg1");
		expect(bmp.readUInt32LE(18)).toBe(5);
		expect(bmp.readInt32LE(22)).toBe(-5);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// A row of five pixels is fifteen bytes, padded to sixteen.
		for (let row = 0; row < 5; row += 1) {
			const start = PIXEL_OFFSET + row * 16;
			const expected = Array.from({ length: 5 }, (_, column) => [
				row,
				column,
				0xee,
			]).flat();
			expect(bmp.subarray(start, start + 15)).toEqual(Buffer.from(expected));
			expect(bmp[start + 15]).toBe(0);
		}
	});

	it("reads a second kind of image as one piece when it is thirty two pixels wide", async () => {
		const row = Buffer.from(
			Array.from({ length: 32 }, (_, pixel) => [pixel, 0x40, 0x80]).flat(),
		);
		const file = buildMg1(32, 1, 24, 0x40, row);
		const archive = await mermaidMg1ImageFormat.open(
			sourceOf(file),
			"wide.mg2",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ tileCount: 1 });
		} finally {
			await archive.close();
		}
		const bmp = await render(file, "wide.mg2");
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 96)).toEqual(row);
	});

	it("skips the bytes of a piece that would run past the image", async () => {
		// Eleven pixels to a row are thirty three bytes, which the reference cuts into five pieces of six
		// bytes, and every piece but the first of a column lands past the end of the image and is skipped over
		// in the file — so the last three bytes of the row are never written at all.
		const body: Buffer = Buffer.alloc(180, 0x00);
		for (const [offset, value] of [
			[0, 0xa0],
			[36, 0xa1],
			[72, 0xa2],
			[108, 0xa3],
			[144, 0xa4],
		] as [number, number][]) {
			// A piece of the image is six bytes, so each one is marked with six of the same.
			body.fill(value, offset, offset + 6);
		}
		const file = buildMg1(11, 1, 24, 0x40, body);
		const bmp = await render(file, "ragged.mg1");
		expect(bmp.readUInt32LE(18)).toBe(11);
		// A row of thirty three bytes is padded to thirty six.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 36)).toEqual(
			Buffer.concat([
				Buffer.alloc(6, 0xa4),
				Buffer.alloc(6, 0xa3),
				Buffer.alloc(6, 0xa2),
				Buffer.alloc(6, 0xa1),
				Buffer.alloc(6, 0xa0),
				Buffer.alloc(6, 0x00),
			]),
		);
	});

	it("stops with an error where the reference would", async () => {
		const body = Buffer.alloc(0x40, 0x00);
		// A depth that is neither twenty four nor thirty two bits is found and then refused.
		const odd = buildMg1(4, 1, 8, 0x40, body);
		expect(await mermaidMg1ImageFormat.detect(sourceOf(odd), "odd.mg1")).toBe(
			true,
		);
		await expect(render(odd, "odd.mg1")).rejects.toThrow(
			/Not supported Mermaid bitmap depth/,
		);
		// The second kind of image is in one piece for every thirty two pixels of its width, so an image
		// narrower than that would divide by nothing.
		const narrow = buildMg1(16, 1, 24, 0x40, body);
		expect(
			await mermaidMg1ImageFormat.detect(sourceOf(narrow), "narrow.mg2"),
		).toBe(true);
		await expect(render(narrow, "narrow.mg2")).rejects.toThrow(
			/Invalid Mermaid bitmap piece count/,
		);
	});
});
