import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { softpalPicImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readSoftpalPicLayout } from "../../packages/formats/src/softpal/pic-image.js";

/** The head of a picture of the engine, of the places of the file of the head of it. */
function head(input: {
	places: number;
	width: number;
	height: number;
	blocksWidth: number;
	blocksHeight: number;
}): Buffer {
	const bytes: Buffer = Buffer.alloc(8, 0x00);
	bytes.writeInt16LE(input.places, 0);
	bytes.writeUInt16LE(input.width, 2);
	bytes.writeUInt16LE(input.height, 4);
	bytes[6] = input.blocksWidth;
	bytes[7] = input.blocksHeight;
	return bytes;
}

/** A picture of the engine: the head of it, the counts of the walks of it and the walks behind them. */
function picFile(input: {
	places: number;
	width: number;
	height: number;
	blocksWidth: number;
	blocksHeight: number;
	controls: Buffer;
	body: Buffer;
}): Buffer {
	return Buffer.concat([
		head({
			places: input.places,
			width: input.width,
			height: input.height,
			blocksWidth: input.blocksWidth,
			blocksHeight: input.blocksHeight,
		}),
		input.controls,
		input.body,
	]);
}

async function bytesOf(data: Buffer): Promise<Buffer> {
	const handle = await softpalPicImageFormat.open(
		new BufferByteSource(data),
		"image",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The place of the picture of a colour map of the picture of eight places to a place. */
function place8(bytes: Buffer, row: number, col: number): number {
	return bytes[0x36 + 0x400 + row * 8 + col] ?? 0;
}

/** The places of the colours of the picture of twenty four places to a place. */
function place24(bytes: Buffer, row: number, col: number): number[] {
	const at = 0x36 + row * 24 + col * 3;
	return [bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0];
}

/** The places of the colours of the picture of thirty two places to a place. */
function place32(bytes: Buffer, row: number, col: number): number[] {
	const at = 0x36 + row * 32 + col * 4;
	return [
		bytes[at] ?? 0,
		bytes[at + 1] ?? 0,
		bytes[at + 2] ?? 0,
		bytes[at + 3] ?? 0,
	];
}

/** The places of the row of the picture of the engine of the count of the places of the file of it. */
function rowOf(bytes: Buffer, row = 0, places = 4): number[] {
	const out: number[] = [];
	for (let col = 0; col < places; col += 1) out.push(place8(bytes, row, col));
	return out;
}

/** A picture of one block of the picture of the engine, of the count of the places of the file of it. */
function oneBlock(input: {
	places: number;
	control: number;
	body: Buffer;
}): Buffer {
	return picFile({
		places: input.places,
		width: 8,
		height: 8,
		blocksWidth: 1,
		blocksHeight: 1,
		controls: Buffer.from([input.control]),
		body: input.body,
	});
}

describe("Softpal engine image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readSoftpalPicLayout(
			oneBlock({ places: 3, control: 0x80, body: Buffer.alloc(0, 0x00) }),
		);
		expect(layout).toEqual({
			width: 8,
			height: 8,
			bitsPerPixel: 24,
			blocksWidth: 1,
			blocksHeight: 1,
		});
		// A picture of no count of the places of a colour of the engine, of no width of it and one of the
		// counts of the walks of it behind the places of the picture of it.
		expect(
			readSoftpalPicLayout(
				picFile({
					places: 2,
					width: 8,
					height: 8,
					blocksWidth: 1,
					blocksHeight: 1,
					controls: Buffer.from([0x80]),
					body: Buffer.alloc(0, 0x00),
				}),
			),
		).toBeUndefined();
		expect(
			readSoftpalPicLayout(
				picFile({
					places: 1,
					width: 0,
					height: 8,
					blocksWidth: 1,
					blocksHeight: 1,
					controls: Buffer.from([0x80]),
					body: Buffer.alloc(0, 0x00),
				}),
			),
		).toBeUndefined();
		expect(
			readSoftpalPicLayout(
				picFile({
					places: 1,
					width: 9,
					height: 8,
					blocksWidth: 1,
					blocksHeight: 1,
					controls: Buffer.from([0x80]),
					body: Buffer.alloc(0, 0x00),
				}),
			),
		).toBeUndefined();
	});

	it("reads a picture of the places of the file of no walk of them", async () => {
		const dark = oneBlock({
			places: 1,
			control: 0x80,
			body: Buffer.alloc(0, 0x00),
		});
		expect(rowOf(await bytesOf(dark))).toEqual([0, 0, 0, 0]);
		const light = oneBlock({
			places: 1,
			control: 0x81,
			body: Buffer.alloc(0, 0x00),
		});
		const lightBytes = await bytesOf(light);
		console.log(
			"LIGHT",
			lightBytes.length,
			lightBytes.subarray(0, 6).toString("hex"),
			[...lightBytes.subarray(0x430, 0x440)],
		);
		expect(rowOf(lightBytes)).toEqual([0xff, 0xff, 0xff, 0xff]);
	});

	it("reads a picture of the places of the file of the walk of them as they stand", async () => {
		// The walk of the places of the file of the picture stands of the count of the places of the file
		// of the block of it: the places of the file of the walk of them stand of the places of the block
		// of the picture above the count of the places of the walk of them.
		const data = oneBlock({
			places: 1,
			control: 0x03,
			body: Buffer.concat([Buffer.from([0x07]), Buffer.alloc(0x40, 0x00)]),
		});
		const bytes = await bytesOf(data);
		expect(rowOf(bytes)).toEqual([0x07, 0x07, 0x07, 0x07]);
		expect(rowOf(bytes, 4)).toEqual([0x07, 0x07, 0x07, 0x07]);
	});

	it("reads a picture of the places of the file of the walk of them of the counts of them", async () => {
		// The places of the block of the picture of the counts of the file of it of the count of the places
		// of the file of the walk of them stand of the counts of the places of the file of it the other way
		// round, of the count of the places of the block of them.
		const data = oneBlock({
			places: 1,
			control: 0x03,
			body: Buffer.concat([Buffer.from([0x00]), Buffer.alloc(0x40, 0xff)]),
		});
		const bytes = await bytesOf(data);
		expect(rowOf(bytes, 0)).toEqual([0xfc, 0xfc, 0xfc, 0xfc]);
		expect(rowOf(bytes, 1)).toEqual([0xfc, 0xfd, 0xfd, 0xfd]);
		expect(rowOf(bytes, 2)).toEqual([0xfc, 0xfd, 0xfe, 0xfe]);
		expect(rowOf(bytes, 3)).toEqual([0xfc, 0xfd, 0xfe, 0xff]);
	});

	it("reads a picture of the places of the file of the counts of two places of the file", async () => {
		// Every place of the file of the walk of the block of the picture stands of the counts of the four
		// places of the file of it: the counts of them stand of the places of the file of the walk of the
		// counts of the file of it.
		const data = oneBlock({
			places: 1,
			control: 0x00,
			body: Buffer.concat([Buffer.from([0x00]), Buffer.alloc(0x10, 0xe4)]),
		});
		const bytes = await bytesOf(data);
		expect(rowOf(bytes, 3)).toEqual([0xfe, 0xff, 0x01, 0x00]);
	});

	it("reads a picture of the places of the file of the counts of four places of the file", async () => {
		const data = oneBlock({
			places: 1,
			control: 0x01,
			body: Buffer.concat([Buffer.from([0x00]), Buffer.alloc(0x20, 0x9a)]),
		});
		const bytes = await bytesOf(data);
		expect(rowOf(bytes, 3)).toEqual([0xe6, 0xed, 0xf3, 0xfa]);
	});

	it("reads a picture of the places of the file of the counts of six places of the file", async () => {
		// The counts of the walk of the block of the picture stand of the counts of the four places of the
		// file of them, of the places of the file of the counts of them of the three places of the file
		// behind one another; the counts of the places of the file of them stand of the counts of the six
		// places of the file of the walk of them, of the counts of the three places of the file of the walk
		// of them behind.
		const counts: Buffer = Buffer.alloc(0x30, 0x00);
		for (let at = 0; at < 0x30; at += 3) {
			counts[at] = 0xaa;
			counts[at + 1] = 0xaa;
			counts[at + 2] = 0xaa;
		}
		const data = oneBlock({
			places: 1,
			control: 0x02,
			body: Buffer.concat([Buffer.from([0x00]), counts]),
		});
		const bytes = await bytesOf(data);
		expect(rowOf(bytes, 3)).toEqual([0xa8, 0xbe, 0xd4, 0xea]);
		expect(rowOf(bytes, 4)).toEqual([0xa8, 0xbe, 0xd4, 0xea]);
	});

	it("reads the places of the colours of a picture of twenty four places to a place", async () => {
		// Every count of the places of the file of the walk of the block of the picture stands of the
		// counts of the channels of the places of the picture — the blue, the green and the red of them —
		// of the count of the places of the file of the block of the walk of them: the places of the file
		// of the walk of the block of them stand of the count of the places of the file of the channels of
		// the block of the picture.
		const body = Buffer.concat([
			Buffer.from([0x11, 0x22, 0x33]),
			Buffer.alloc(0x40, 0x00),
			Buffer.alloc(0x40, 0x00),
			Buffer.alloc(0x40, 0x00),
		]);
		const data = picFile({
			places: 3,
			width: 8,
			height: 8,
			blocksWidth: 1,
			blocksHeight: 1,
			controls: Buffer.from([0x3f]),
			body,
		});
		const bytes = await bytesOf(data);
		expect(place24(bytes, 0, 0)).toEqual([0x11, 0x22, 0x33]);
		expect(place24(bytes, 7, 7)).toEqual([0x11, 0x22, 0x33]);
	});

	it("reads the places of the colours of a picture of thirty two places to a place", async () => {
		// The places of the file of the channels of the picture stand of the alpha, the blue, the green and
		// the red of the places of it.
		const data = picFile({
			places: 4,
			width: 8,
			height: 8,
			blocksWidth: 1,
			blocksHeight: 1,
			controls: Buffer.from([0xff]),
			body: Buffer.concat([
				Buffer.from([0x10, 0x20, 0x30, 0x40]),
				Buffer.alloc(0x40, 0x00),
				Buffer.alloc(0x40, 0x00),
				Buffer.alloc(0x40, 0x00),
				Buffer.alloc(0x40, 0x00),
			]),
		});
		const bytes = await bytesOf(data);
		expect(place32(bytes, 0, 0)).toEqual([0x20, 0x30, 0x40, 0x10]);
	});

	it("stands of the places of the file of the walk of a block of the picture", async () => {
		const data = oneBlock({
			places: 1,
			control: 0x03,
			body: Buffer.concat([Buffer.from([0x00]), Buffer.alloc(0x10, 0x00)]),
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = oneBlock({
			places: 1,
			control: 0x80,
			body: Buffer.alloc(0, 0x00),
		});
		expect(
			await softpalPicImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		expect(
			await softpalPicImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(8, 0x00)),
			),
		).toBe(false);
	});
});
