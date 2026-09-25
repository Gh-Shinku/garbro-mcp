import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	readRmskLayout,
	rmskImageFormat,
	unpackRmsk,
} from "../../packages/formats/src/silky/rmsk-image.js";

const FLAG_FIELD = 0x0c;
const DATA_OFFSET = 0x0e;

/** One decision of the stream: how many bits it takes and what they hold. */
type Item = readonly [number, number];

/** The bits of a mask, most significant first, as its own reader takes them. */
function bitStream(items: readonly Item[]): Buffer {
	const bits: number[] = [];
	for (const [count, value] of items) {
		for (let at = count - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	}
	while (bits.length % 8 !== 0) bits.push(0);
	const bytes = Buffer.alloc(bits.length / 8, 0x00);
	for (const [index, bit] of bits.entries()) {
		if (bit)
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (0x80 >> (index & 7));
	}
	return bytes;
}

/** A mask of this engine: the head, the byte that names the way, and the bits behind it. */
function buildMask(options: {
	width: number;
	height: number;
	columns: boolean;
	items: readonly Item[];
	offsetX?: number;
	offsetY?: number;
}): Buffer {
	const head = Buffer.alloc(DATA_OFFSET, 0x00);
	head.write("Rmsk", 0, "latin1");
	head.writeInt16LE(options.offsetX ?? 0, 4);
	head.writeInt16LE(options.offsetY ?? 0, 6);
	head.writeUInt16LE(options.width, 8);
	head.writeUInt16LE(options.height, 0x0a);
	head.writeUInt8(options.columns ? 1 : 0, FLAG_FIELD);
	return Buffer.concat([head, bitStream(options.items)]);
}

/** One pixel that stands for itself. */
function literal(value: number): Item[] {
	return [
		[1, 1],
		[8, value],
	];
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await rmskImageFormat.open(
		new BufferByteSource(data),
		"mask.msk",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Silky's bitmap mask", () => {
	it("walks the rows from the last one up, and the bitmap is built flipped to match", async () => {
		// The first row the walk writes is the last row of the picture, the next one the row above it.
		const data = buildMask({
			width: 2,
			height: 2,
			columns: false,
			items: [
				...literal(0x11),
				...literal(0x22),
				...literal(0x33),
				...literal(0x44),
			],
			offsetX: -3,
			offsetY: 5,
		});
		expect(readRmskLayout(data)).toMatchObject({
			width: 2,
			height: 2,
			columns: false,
			offsetX: -3,
			offsetY: 5,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		// The reference builds this picture flipped, so the row the walk writes first - the last row of its
		// own place - is the row a reader shows at the **top** of the picture.
		expect([...bmp.pixels]).toEqual([0x11, 0x22, 0x33, 0x44]);
	});

	it("copies byte by byte, so a copy of its own bytes runs on", () => {
		// A byte of its own, then a copy of two out of the place right before the cursor: the copy reads the
		// byte it has just written, which makes three of them, and then one byte of its own again.
		const items: Item[] = [
			...literal(0x41),
			[1, 0], // a copy
			[1, 1],
			[1, 0],
			[3, 0], // out of the table before it: one pixel back
			[1, 1],
			[1, 0], // and a length of two
			...literal(0x42),
		];
		const data = buildMask({ width: 4, height: 1, columns: false, items });
		const layout = readRmskLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackRmsk(data, layout)]).toEqual([0x41, 0x41, 0x41, 0x42]);
	});

	it("copies out of the row in front of the one it writes", async () => {
		// The lower row stands as it is; the row above it copies from the same place two rows down, which is
		// the row the walk wrote first.
		const items: Item[] = [
			...literal(0x11),
			...literal(0x22),
			[1, 0], // a copy
			[1, 1],
			[1, 1],
			[4, 8], // out of the wider table: the same column, the row in front
			[1, 1],
			[1, 0], // a length of two
		];
		const data = buildMask({ width: 2, height: 2, columns: false, items });
		const bmp = readBmpImage(await extract(data));
		expect([...(bmp?.pixels ?? [])]).toEqual([0x11, 0x22, 0x11, 0x22]);
	});

	it("walks the columns of a mask stored that way", async () => {
		// The walk starts at the last column and runs down it, then takes the column before it.
		const data = buildMask({
			width: 2,
			height: 2,
			columns: true,
			items: [
				...literal(0x0a),
				...literal(0x0b),
				...literal(0x0c),
				...literal(0x0d),
			],
		});
		expect(readRmskLayout(data)?.columns).toBe(true);
		const bmp = readBmpImage(await extract(data));
		// The walk begins at the last column of its own place, which a reader shows as the top row, and runs
		// down it; the column before stands beside it.
		expect([...(bmp?.pixels ?? [])]).toEqual([0x0a, 0x0c, 0x0b, 0x0d]);
	});

	it("turns away a copy that reaches outside the mask, and a file that is too short", async () => {
		const outside = buildMask({
			width: 2,
			height: 1,
			columns: false,
			items: [
				[1, 0], // a copy
				[1, 1],
				[1, 1],
				[4, 0], // twenty pixels back, which the mask does not hold
				[1, 1],
				[1, 0],
			],
		});
		await expect(extract(outside)).rejects.toThrow(GarbroError);

		const short = buildMask({
			width: 2,
			height: 2,
			columns: false,
			items: literal(1),
		}).subarray(0, DATA_OFFSET);
		expect(
			await rmskImageFormat.detect(new BufferByteSource(short), "a.msk"),
		).toBe(false);
		await expect(
			rmskImageFormat.open(new BufferByteSource(short), "a.msk"),
		).rejects.toThrow(GarbroError);
	});

	it("keeps the way of the mask and its place in the entry it names", async () => {
		const data = buildMask({
			width: 1,
			height: 1,
			columns: true,
			items: literal(0x7f),
		});
		const handle = await rmskImageFormat.open(
			new BufferByteSource(data),
			"mask.msk",
		);
		expect(handle.entries[0]).toMatchObject({
			path: "mask.bmp",
			size: BigInt(data.length),
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			columns: true,
		});
	});
});
