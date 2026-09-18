import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readTxLayout,
	readTxPalette,
	tanakaBcImageFormat,
	unpackTx,
} from "../../packages/formats/src/tanaka/bc-image.js";

/** A picture: a plain bitmap head and then the block the pixels stand in. */
function bcFile(input: {
	width: number;
	height: number;
	bpp: number;
	colors?: number;
	stride?: number;
	blockHeight?: number;
	body: Buffer;
	palette?: Buffer;
	blockOffset?: number;
	mark?: string;
}): Buffer {
	const stride = input.stride ?? input.width * (input.bpp >> 3);
	const palette = input.palette ?? Buffer.alloc(0x400, 0x00);
	const blockOffset = input.blockOffset ?? 0x36 + palette.length;
	const head = Buffer.alloc(0x36, 0x00);
	Buffer.from(input.mark ?? "BC", "latin1").copy(head, 0);
	head.writeUInt32LE(blockOffset, 0x0a);
	head.writeUInt32LE(input.width, 0x12);
	head.writeUInt32LE(input.height, 0x16);
	head.writeInt16LE(input.bpp, 0x1c);
	head.writeInt32LE(input.colors ?? 0, 0x2e);
	const block = Buffer.alloc(8, 0x00);
	block.writeUInt32LE(0x34305854, 0);
	block.writeUInt16LE(stride, 4);
	block.writeUInt16LE(input.blockHeight ?? input.height, 6);
	return Buffer.concat([head, palette, block, input.body]);
}

/** A walk of bytes that stand as they are, thirty two at the most. */
function literal(bytes: Buffer): Buffer {
	if (bytes.length === 0 || bytes.length > 32) {
		throw new Error("a literal walk holds one to thirty two bytes");
	}
	return Buffer.concat([Buffer.from([0xe0 | (bytes.length - 1)]), bytes]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await tanakaBcImageFormat.open(
		new BufferByteSource(data),
		"pic.bmp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Tanaka Tatsuhiro's engine image", () => {
	it("reads the head and the block as the reference does", () => {
		const data = bcFile({
			width: 4,
			height: 2,
			bpp: 24,
			body: literal(Buffer.alloc(24, 0x00)),
		});
		expect(readTxLayout(data)).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			stride: 12,
			alignedStride: 12,
			dataOffset: 0x36 + 0x400 + 8,
		});
	});

	it("gates on the mark, the block mark and the height again", () => {
		const good = bcFile({
			width: 4,
			height: 2,
			bpp: 24,
			body: literal(Buffer.alloc(24, 0x00)),
		});
		expect(readTxLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("XX", 0, "latin1");
		expect(readTxLayout(mark)).toBeUndefined();
		// The block behind the pixels has to stand where the head says.
		const block = Buffer.from(good);
		block.writeUInt32LE(0, 0x436);
		expect(readTxLayout(block)).toBeUndefined();
		// The height stands again in the block and both have to agree.
		const height = Buffer.from(good);
		height.writeUInt16LE(3, 0x436 + 6);
		expect(readTxLayout(height)).toBeUndefined();
		const depth = Buffer.from(good);
		depth.writeInt16LE(12, 0x1c);
		expect(readTxLayout(depth)).toBeUndefined();
	});

	it("walks a row along a delta of the pixels before it", async () => {
		// Two rows of four pixels, every pixel standing as the difference from the one before it. The first
		// two bytes of the picture stand as they are, so the walk behind them holds the rest.
		const stored = Buffer.alloc(24, 0x00);
		stored[0] = 0x10;
		stored[3] = 0x05;
		stored[12] = 0x20;
		stored[15] = 0x02;
		const data = bcFile({
			width: 4,
			height: 2,
			bpp: 24,
			body: Buffer.concat([stored.subarray(0, 2), literal(stored.subarray(2))]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores the rows bottom up, so the height of the bitmap stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		// The delta runs along the whole row, every pixel standing on the one before it.
		expect(out.subarray(0x36, 0x36 + 24).toString("hex")).toBe(
			"100000150000150000150000200000220000220000220000",
		);
	});

	it("copies a run that reads the bytes it has just written", async () => {
		// Two pixels at twenty four bits: the first one comes from the walk, the second one is a run of two
		// bytes taken from the byte before it, and the rest stands as it is.
		const body = Buffer.concat([
			Buffer.from([0x11, 0x22]),
			Buffer.from([0x00]), // three places of offset nought and a count of two, within the row
			literal(Buffer.from([0x33, 0x44, 0x55, 0x66])),
		]);
		const out = await extract(bcFile({ width: 2, height: 1, bpp: 24, body }));
		// The row stands as 11 22 22 22 33 44 before the delta, so the second pixel is the difference from
		// the first: 22+11, 33+22 and 44+22.
		expect(out.subarray(0x36, 0x36 + 8).toString("hex")).toBe(
			"1122223355660000",
		);
	});

	it("walks back into the rows above", async () => {
		// An eight bit picture of eight by four with no delta to walk along, so the copies stand alone.
		const literals = Buffer.from(
			Array.from({ length: 14 }, (_, index) => 0x10 + index),
		);
		const body = Buffer.concat([
			Buffer.from([0x01, 0x02]),
			literal(literals),
			// A byte of nought with three places of offset and then a count of three bytes, the copy
			// reaching from the byte before the one being written.
			Buffer.from([0xc0, 0x00, 0x03]),
			Buffer.from([0x60]), // eight places of offset and a count of two, from the row above
			Buffer.from([0xa0]), // the same from the row two above
			literal(Buffer.alloc(9, 0xaa)),
		]);
		const data = bcFile({ width: 8, height: 4, bpp: 8, body });
		const layout = readTxLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = unpackTx(data, layout);
		expect(pixels.toString("hex")).toBe(
			"0102101112131415161718191a1b1c1d" +
				"1d1d1d191a1314" +
				"aaaaaaaaaaaaaaaaaa",
		);
	});

	it("writes an eight bit picture out with its colour map", async () => {
		const palette = Buffer.alloc(0x400, 0x00);
		palette.writeUInt8(0x11, 0);
		palette.writeUInt8(0x22, 1);
		palette.writeUInt8(0x33, 2);
		const body = Buffer.concat([
			Buffer.from([0x01, 0x02]),
			literal(Buffer.from([0x03, 0x04, 0x05, 0x06, 0x07, 0x08])),
		]);
		const data = bcFile({
			width: 8,
			height: 1,
			bpp: 8,
			colors: 1,
			palette,
			body,
		});
		const layout = readTxLayout(data);
		if (!layout) throw new Error("no layout");
		expect(readTxPalette(data, layout).subarray(0, 4).toString("hex")).toBe(
			"11223300",
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("11223300");
		expect(out.subarray(0x436, 0x43e).toString("hex")).toBe("0102030405060708");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = bcFile({
			width: 4,
			height: 2,
			bpp: 24,
			body: literal(Buffer.alloc(24, 0x00)),
		});
		data.write("XX", 0, "latin1");
		await expect(
			tanakaBcImageFormat.open(new BufferByteSource(data), "pic.bmp"),
		).rejects.toThrow(GarbroError);
		await expect(
			tanakaBcImageFormat.open(new BufferByteSource(data), "pic.bmp"),
		).rejects.toThrow("Not a Tanaka Tatsuhiro picture");
	});
});
