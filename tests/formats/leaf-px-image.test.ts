import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	leafPxImageFormat,
	readLeafPxLayout,
} from "../../packages/formats/src/leaf/px-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x20;
/** The ways the head of a whole picture names. */
const KIND_BLOCKS = 0x0c;
const KIND_STORED = 0x90;
const KIND_OFFSETS = 0x40;
const KIND_ONE = 1;
/** The ways a block names itself. */
const WAY_PALETTE = 0;
const WAY_ONE = 1;
const WAY_RUNS = 4;
const WAY_COLOUR_MAP = 7;
const BITS_8 = 8;
const BITS_9 = 9;
const BITS_20 = 0x20;

/** A picture of the first way: a table of block numbers, then the blocks behind it. */
function buildBlocks(): Buffer {
	const blockSize = 2;
	const pixelSize = 4;
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt32LE(1, 0);
	head.writeInt32LE(blockSize, 4);
	head.writeUInt16LE(KIND_BLOCKS, 0x10);
	head.writeUInt16LE(32, 0x12);
	head.writeUInt16LE(blockSize, 0x14);
	head.writeUInt16LE(blockSize, 0x16);
	head.writeUInt16LE(1, 0x1c);
	head.writeUInt16LE(1, 0x1e);
	const table = Buffer.alloc(2, 0x00);
	table.writeUInt16LE(1, 0);
	// A stored block keeps the size of its own inside the picture, two less than the picture it holds.
	const blockLength = 2 + (blockSize + 2) * (blockSize + 2) * pixelSize;
	const block = Buffer.alloc(blockLength, 0x00);
	block[0] = blockSize + 2;
	block[1] = blockSize + 2;
	for (let y = 0; y < blockSize; y += 1) {
		// Every row of a packed block carries eight bytes the reader steps over.
		const from = 2 + y * (blockSize * pixelSize + 8);
		for (let x = 0; x < blockSize; x += 1) {
			block[from + x * pixelSize + 0] = 0x10 + y * 2 + x;
			block[from + x * pixelSize + 1] = 0x20 + y * 2 + x;
			block[from + x * pixelSize + 2] = 0x30 + y * 2 + x;
			block[from + x * pixelSize + 3] = 0xff;
		}
	}
	return Buffer.concat([head, table, block]);
}

/** A picture of the stored way: one whole frame behind a second head of its own. */
function buildStored(): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeUInt16LE(KIND_STORED, 0x10);
	head.writeInt32LE(1, 4);
	head.write("Leaf", 0x14, "latin1");
	const second = Buffer.alloc(0x20, 0x00);
	second.writeUInt32LE(2, 0);
	second.writeUInt32LE(2, 4);
	second.writeUInt16LE(0x0a, 0x10);
	second.writeUInt16LE(32, 0x12);
	return Buffer.concat([
		head,
		second,
		Buffer.from([
			0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0xff, 0x07, 0x08, 0x09, 0xff,
			0x0a, 0x0b, 0x0c, 0xff,
		]),
	]);
}

/** A picture of a way that keeps one block, whose head is the file's own head. */
function buildOneBlock(options: {
	kind: number;
	way: number;
	bits: number;
	width: number;
	height: number;
	blockWidth: number;
	blockHeight: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt32LE(options.blockWidth, 0);
	head.writeInt32LE(options.blockHeight, 4);
	head.writeUInt16LE(options.kind, 0x10);
	head.writeUInt16LE(options.bits, 0x12);
	head.writeUInt32LE(options.width, 0x14);
	head.writeUInt32LE(options.height, 0x18);
	return Buffer.concat([head, options.body]);
}

/** A picture of the offsets kind, which names the place of every block of its own. */
function buildWithBlocks(
	width: number,
	height: number,
	blocks: Buffer[],
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt32LE(blocks.length, 0);
	head.writeUInt16LE(KIND_OFFSETS, 0x10);
	head.writeUInt32LE(width, 0x14);
	head.writeUInt32LE(height, 0x18);
	const table = Buffer.alloc(blocks.length * 4, 0x00);
	let at = 0;
	for (const [index, block] of blocks.entries()) {
		table.writeUInt32LE(at, index * 4);
		at += block.length;
	}
	return Buffer.concat([head, table, ...blocks]);
}

/** A block of the ways whose heads stand behind a table rather than at the file's own head. */
function blockAt(options: {
	way: number;
	bits: number;
	blockWidth: number;
	blockHeight: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt32LE(options.blockWidth, 0);
	head.writeInt32LE(options.blockHeight, 4);
	head.writeUInt16LE(options.way, 0x10);
	head.writeUInt16LE(options.bits, 0x12);
	return Buffer.concat([head, options.body]);
}

/**
 * A palette in a block of its own, then a run of the ninth way over a block of two by two. The run's first
 * code names the first row and asks for two pixels; the second names the second row and turns the alpha of
 * the colours behind it on.
 */
function buildRuns9(): Buffer {
	const palette: number[] = [];
	for (let at = 0; at < 4; at += 1) {
		palette.push(0x10 * (at + 1), 0x20 * (at + 1), 0x30 * (at + 1), 0x00);
	}
	const code = (place: number, count: number, toggle = false): Buffer => {
		const out = Buffer.alloc(4, 0x00);
		out.writeInt32LE(((toggle ? 0x180000 : 0) | (count << 9) | place) >>> 0, 0);
		return out;
	};
	return buildWithBlocks(4, 1, [
		blockAt({
			way: WAY_PALETTE,
			bits: 0,
			blockWidth: 4,
			blockHeight: 0,
			body: Buffer.from(palette),
		}),
		blockAt({
			way: WAY_RUNS,
			bits: BITS_9,
			blockWidth: 4,
			blockHeight: 1,
			body: Buffer.concat([
				code(0, 2),
				Buffer.from([0x80, 1, 0x40, 2]),
				// The second run turns the colours' own alpha on, where the first read them whole.
				code(0, 2, true),
				Buffer.from([0x80, 3, 0x40, 1]),
				Buffer.alloc(4, 0xff),
			]),
		}),
	]);
}

/** A picture of the colour map way, which brings its own size and its own map rather than a palette. */
function buildColourMap(): Buffer {
	const map = Buffer.alloc(0x100 * 4, 0x00);
	// The map is kept blue, green, red, alpha, and the alpha comes out at the top byte after its addition.
	map[4] = 0x11;
	map[5] = 0x22;
	map[6] = 0x33;
	map[7] = 0x40;
	map[8] = 0x44;
	map[9] = 0x55;
	map[10] = 0x66;
	map[11] = 0x80;
	return buildWithBlocks(4, 4, [
		blockAt({
			way: WAY_COLOUR_MAP,
			bits: 0,
			blockWidth: 2,
			blockHeight: 1,
			body: Buffer.concat([map, Buffer.from([1, 2])]),
		}),
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await leafPxImageFormat.open(
		new BufferByteSource(data),
		"picture.px",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

function pixels(out: Buffer): Buffer {
	const image = readBmpImage(out);
	if (!image) throw new Error("the picture is not a bitmap");
	return image.pixels;
}

describe("Leaf engine image format", () => {
	it("reads the head of every way a picture is kept in", () => {
		expect(readLeafPxLayout(buildBlocks())).toMatchObject({
			kind: KIND_BLOCKS,
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			blockSize: 2,
		});
		expect(readLeafPxLayout(buildStored())).toMatchObject({
			kind: KIND_STORED,
			width: 2,
			height: 2,
		});
		const offsets = Buffer.alloc(0x40, 0x00);
		offsets.writeInt32LE(1, 0);
		offsets.writeUInt16LE(KIND_OFFSETS, 0x10);
		offsets.writeUInt32LE(3, 0x14);
		offsets.writeUInt32LE(4, 0x18);
		expect(readLeafPxLayout(offsets)).toMatchObject({
			kind: KIND_OFFSETS,
			width: 3,
			height: 4,
		});
		const whole = Buffer.alloc(HEADER_SIZE, 0x00);
		whole.writeUInt16LE(KIND_ONE, 0x10);
		whole.writeUInt16LE(8, 0x12);
		whole.writeUInt32LE(5, 0x14);
		whole.writeUInt32LE(6, 0x18);
		expect(readLeafPxLayout(whole)).toMatchObject({
			kind: KIND_ONE,
			width: 5,
			height: 6,
			bitsPerPixel: 8,
		});
	});

	it("takes the blocks of the first way from the table of their own", async () => {
		const out = await extract(buildBlocks());
		expect(pixels(out)).toEqual(
			Buffer.from([
				0x10, 0x20, 0x30, 0xff, 0x11, 0x21, 0x31, 0xff, 0x12, 0x22, 0x32, 0xff,
				0x13, 0x23, 0x33, 0xff,
			]),
		);
	});

	it("hands a picture of the stored way over as it stands", async () => {
		const out = await extract(buildStored());
		expect(pixels(out)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0xff, 0x07, 0x08, 0x09, 0xff,
				0x0a, 0x0b, 0x0c, 0xff,
			]),
		);
	});

	it("takes the alpha of a picture of the twentieth way from its own colour", async () => {
		const out = await extract(
			buildOneBlock({
				kind: KIND_ONE,
				way: WAY_ONE,
				bits: BITS_20,
				width: 2,
				height: 1,
				blockWidth: 2,
				blockHeight: 1,
				body: Buffer.from([
					0x01, 0x02, 0x03, 0x40, 0x04, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
					0x00, 0x00, 0x00, 0x00, 0x00,
				]),
			}),
		);
		// Every colour keeps its blue, green and red, and takes its alpha from the top of its own byte.
		expect(pixels(out)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x7f, 0x04, 0x05, 0x06, 0xff]),
		);
	});

	it("takes the colours of a run of the ninth way from the palette", async () => {
		const out = await extract(buildRuns9());
		// The runs name the palette's second entry first, and the alpha of a colour is its own byte doubled.
		expect(pixels(out)).toEqual(
			Buffer.from([
				0x20, 0x40, 0x60, 0xff, 0x30, 0x60, 0x90, 0x7f, 0x40, 0x80, 0xc0, 0xff,
				0x20, 0x40, 0x60, 0xff,
			]),
		);
	});

	it("lets a picture of the colour map way bring its own size", async () => {
		const out = await extract(buildColourMap());
		// The picture of this way stands at the size of its own block rather than of the head.
		expect(readBmpImage(out)).toMatchObject({ width: 2, height: 1 });
		expect(pixels(out)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x7f, 0x44, 0x55, 0x66, 0xff]),
		);
	});

	it("turns away a block the reference does not read either", async () => {
		// A block of the eighth way is the one the reference itself leaves unimplemented.
		await expect(
			extract(
				buildOneBlock({
					kind: WAY_RUNS,
					way: WAY_RUNS,
					bits: BITS_8,
					width: 1,
					height: 1,
					blockWidth: 1,
					blockHeight: 1,
					body: Buffer.alloc(4, 0x00),
				}),
			),
		).rejects.toThrow(GarbroError);
		// A run of the ninth way without the palette it reads from is refused as well.
		await expect(
			extract(
				buildWithBlocks(1, 1, [
					blockAt({
						way: WAY_RUNS,
						bits: BITS_9,
						blockWidth: 1,
						blockHeight: 1,
						body: Buffer.alloc(0x20, 0x00),
					}),
				]),
			),
		).rejects.toThrow(GarbroError);
	});

	it("is told by the name of the picture rather than by a word of its own", async () => {
		expect(leafPxImageFormat.descriptor.id).toBe("leaf-px-image");
		const good = buildStored();
		expect(
			await leafPxImageFormat.detect(new BufferByteSource(good), "picture.px"),
		).toBe(true);
		expect(
			await leafPxImageFormat.detect(new BufferByteSource(good), "picture.dat"),
		).toBe(false);
	});
});
