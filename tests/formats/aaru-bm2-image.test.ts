import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { aaruBm2ImageFormat } from "../../packages/formats/src/aaru/bm2-image.js";
import {
	readBmpImage,
	writeBmp32,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x16;

function paletteOf(): Buffer {
	const palette: Buffer = Buffer.alloc(0x400, 0);
	for (let index = 0; index < 256; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = 255 - index;
		palette[index * 4 + 2] = index ^ 0x5a;
		palette[index * 4 + 3] = 0x00;
	}
	return palette;
}

interface Bm2Parts {
	bitsPerPixel: number;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	palette?: boolean;
	pixels: Buffer;
}

function bm2File(parts: Bm2Parts): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.write("BM2A", 0, "latin1");
	header.writeUInt16LE(parts.bitsPerPixel, 8);
	header.writeInt16LE(parts.offsetX ?? 0, 0xa);
	header.writeInt16LE(parts.offsetY ?? 0, 0xc);
	header.writeUInt16LE(parts.width, 0xe);
	header.writeUInt16LE(parts.height, 0x10);
	const body: Buffer[] = [];
	if (parts.palette) body.push(paletteOf());
	body.push(parts.pixels);
	return Buffer.concat([header, ...body]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bm2"): Promise<Buffer> {
	const handle = await aaruBm2ImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function normalised(picture: Buffer): Buffer {
	const image = readBmpImage(picture);
	if (!image) throw new Error("the fixture is not a bitmap");
	return writeBmpImage(image);
}

describe("Aaru bitmap format", () => {
	// The stored blocks of a twenty four bit picture: the transparency first, then the three colours.
	const blocks: Buffer = Buffer.from([
		0x00, 0x01, 0x02, 0x03, 0x40, 0x11, 0x22, 0x33, 0xff, 0xaa, 0xbb, 0xcc,
	]);
	const turned = (): Buffer => {
		const out: Buffer = Buffer.alloc(blocks.length, 0);
		for (let index = 0; index < blocks.length; index += 4) {
			out[index] = blocks[index + 1] ?? 0;
			out[index + 1] = blocks[index + 2] ?? 0;
			out[index + 2] = blocks[index + 3] ?? 0;
			out[index + 3] = blocks[index] ?? 0;
		}
		return out;
	};

	it("finds a picture behind the word of the format", async () => {
		const data = bm2File({
			bitsPerPixel: 24,
			width: 3,
			height: 1,
			pixels: blocks,
		});
		expect(await aaruBm2ImageFormat.detect(sourceOf(data), "cg.bm2")).toBe(
			true,
		);
		const other = bm2File({
			bitsPerPixel: 24,
			width: 3,
			height: 1,
			pixels: blocks,
		});
		other[3] = 0x42;
		expect(await aaruBm2ImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("declines a depth the reference does not read", async () => {
		for (const bitsPerPixel of [4, 16, 32]) {
			const data = bm2File({
				bitsPerPixel,
				width: 2,
				height: 2,
				pixels: Buffer.alloc(16),
			});
			expect(await aaruBm2ImageFormat.detect(sourceOf(data))).toBe(false);
		}
	});

	it("reports what the header says, with the place of the picture", async () => {
		const data = bm2File({
			bitsPerPixel: 24,
			width: 3,
			height: 1,
			offsetX: -4,
			offsetY: 0x1234,
			pixels: blocks,
		});
		const handle = await aaruBm2ImageFormat.open(sourceOf(data), "dir/cg.bm2");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 3,
			height: 1,
			bitsPerPixel: 32,
			offsetX: -4,
			offsetY: 0x1234,
		});
	});

	it("turns a twenty four bit block over into a thirty two bit pixel", async () => {
		const data = bm2File({
			bitsPerPixel: 24,
			width: 3,
			height: 1,
			pixels: blocks,
		});
		expect(await extract(data)).toEqual(normalised(writeBmp32(3, 1, turned())));
	});

	it("reads the colour of an eight bit pixel out of the map and its transparency beside it", async () => {
		const palette = paletteOf();
		const indexed: Buffer = Buffer.from([0x80, 0x01, 0x40, 0xff, 0x00, 0x05]);
		const expected: Buffer = Buffer.alloc(3 * 4, 0);
		const pairs = [
			[0x80, 0x01],
			[0x40, 0xff],
			[0x00, 0x05],
		];
		for (const [index, [alpha, entry]] of pairs.entries()) {
			expected[index * 4] = palette[(entry ?? 0) * 4] ?? 0;
			expected[index * 4 + 1] = palette[(entry ?? 0) * 4 + 1] ?? 0;
			expected[index * 4 + 2] = palette[(entry ?? 0) * 4 + 2] ?? 0;
			expected[index * 4 + 3] = alpha ?? 0;
		}
		const data = bm2File({
			bitsPerPixel: 8,
			width: 3,
			height: 1,
			palette: true,
			pixels: indexed,
		});
		expect(await extract(data)).toEqual(normalised(writeBmp32(3, 1, expected)));
	});

	it("keeps the pixel rows the way they were stored", async () => {
		// Two rows of two pixels, whose rows must not be turned over on the way out.
		const rows: Buffer = Buffer.alloc(16, 0);
		rows.writeUInt8(1, 1);
		rows.writeUInt8(0xff, 8);
		const data = bm2File({
			bitsPerPixel: 24,
			width: 2,
			height: 2,
			pixels: rows,
		});
		const out = await extract(data);
		// The first pixel of the first row carries a one, and the first pixel of the second row carries the
		// transparency of the block it was stored in, so the rows are read in the order they were stored.
		expect(out.subarray(54, 54 + 16).toString("hex")).toBe(
			"0100000000000000000000ff00000000",
		);
	});

	it("repeats the block before it when the stream is cut short", async () => {
		const data = bm2File({
			bitsPerPixel: 24,
			width: 3,
			height: 1,
			pixels: blocks.subarray(0, 6),
		});
		const expected: Buffer = Buffer.alloc(3 * 4, 0);
		const block = Buffer.alloc(4, 0);
		blocks.copy(block, 0, 0, 4);
		expected[0] = block[1] ?? 0;
		expected[1] = block[2] ?? 0;
		expected[2] = block[3] ?? 0;
		expected[3] = block[0] ?? 0;
		// The second block is read half way, so the last two bytes are the ones before them.
		expected[4] = blocks[5] ?? 0;
		expected[5] = block[2] ?? 0;
		expected[6] = block[3] ?? 0;
		expected[7] = blocks[4] ?? 0;
		// The third block is read nowhere at all, so it holds the whole of the second one.
		expected[8] = blocks[5] ?? 0;
		expected[9] = block[2] ?? 0;
		expected[10] = block[3] ?? 0;
		expected[11] = blocks[4] ?? 0;
		expect(await extract(data)).toEqual(normalised(writeBmp32(3, 1, expected)));
	});

	it("refuses an eight bit picture cut short of its pixels", async () => {
		const data = bm2File({
			bitsPerPixel: 8,
			width: 4,
			height: 4,
			palette: true,
			pixels: Buffer.alloc(8),
		});
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses an eight bit picture cut short of its colour map", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
		header.write("BM2A", 0, "latin1");
		header.writeUInt16LE(8, 8);
		header.writeUInt16LE(1, 0xe);
		header.writeUInt16LE(1, 0x10);
		const data: Buffer = Buffer.concat([
			header,
			paletteOf().subarray(0, 0x200),
			Buffer.alloc(2),
		]);
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
