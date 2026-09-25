import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { liarLimImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readLimLayout } from "../../packages/formats/src/liar/lim-image.js";

/** A picture of the engine: the mark, the head of it and the channels behind them. */
function limFile(input: {
	width: number;
	height: number;
	flags: number;
	bitsPerPixel?: number;
	body: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x10, 0x00);
	head.write("LM", 0, "latin1");
	head.writeUInt16LE(input.flags, 2);
	head.writeUInt16LE(16 === input.bitsPerPixel ? 0x10 : 0x00, 4);
	head.writeUInt16LE(0, 6);
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 12);
	return Buffer.concat([head, input.body]);
}

/**
 * A channel of a picture of eight places to a place: the count of the places of the channel, the count of
 * the places of the file of its walk, the words of the table of it and the walk of them.
 */
function channel(input: {
	places: number;
	index: number[];
	walk: number[];
	indexSize?: number;
}): Buffer {
	const head: Buffer = Buffer.alloc(8, 0x00);
	head.writeInt32LE(input.places, 0);
	head.writeInt32LE(input.walk.length, 4);
	const tail: Buffer = Buffer.alloc(4, 0x00);
	tail.writeUInt16LE(input.indexSize ?? input.index.length, 0);
	return Buffer.concat([
		head,
		tail,
		Buffer.from(input.index),
		Buffer.from(input.walk),
	]);
}

/**
 * The walk of a picture of three places: one place of the file, then a run of two places of the file the
 * same as it — the count of the run stands as the count of the places of it less two.
 */
function walkOfThree(run: number): number[] {
	const bits: number[] = [0, 0, 1, 0];
	const push = (value: number, count: number): void => {
		for (let at = count - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	};
	push(0, 3);
	push(run, 4);
	push(1, 3);
	push(0, 1);
	const out: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value << 1) | (bits[at + bit] ?? 0);
		}
		out.push(value);
	}
	return out;
}

/** The walk of a picture of the places of the words of the table of the channel, of the highest first. */
function walkOf(indices: number[], bits = 3): number[] {
	const places: number[] = [];
	for (const index of indices) {
		const push = (value: number, count: number): void => {
			for (let at = count - 1; at >= 0; at -= 1) places.push((value >> at) & 1);
		};
		if (index < 2) {
			// A count of one place of the file stands of one place of the walk, of the place of it.
			push(1, bits);
			push(index, 1);
		} else {
			const length = 31 - Math.clz32(index);
			push(length + 1, bits);
			push(index - (1 << length), length);
		}
	}
	const out: number[] = [];
	for (let at = 0; at < places.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value << 1) | (places[at + bit] ?? 0);
		}
		out.push(value);
	}
	return out;
}

async function bytesOf(data: Buffer) {
	const handle = await liarLimImageFormat.open(
		new BufferByteSource(data),
		"cg.lim",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Liar-soft image", () => {
	it("reads the head of a picture", () => {
		const layout = readLimLayout(
			limFile({ width: 2, height: 3, flags: 2, body: Buffer.alloc(4) }),
		);
		expect(layout).toEqual({ flags: 2, bitsPerPixel: 32, width: 2, height: 3 });
		const sixteen = readLimLayout(
			limFile({
				width: 2,
				height: 3,
				flags: 3,
				bitsPerPixel: 16,
				body: Buffer.alloc(4),
			}),
		);
		expect(sixteen?.bitsPerPixel).toBe(16);
		// A picture standing of no mark of its own and one of a kind of places the engine knows none of.
		expect(readLimLayout(Buffer.alloc(0x10, 0x00))).toBeUndefined();
		expect(
			readLimLayout(
				limFile({ width: 2, height: 3, flags: 5, body: Buffer.alloc(4) }),
			),
		).toBeUndefined();
	});

	it("reads the places of a picture of the walks of the channels of it", async () => {
		// The four channels of the picture stand of the places of the file one behind another: the alpha
		// of the picture first, of the places of the file the other way round. A walk of three places
		// stands of one place and of a run of two of them.
		const walk = walkOfThree(2);
		const data = limFile({
			width: 3,
			height: 1,
			flags: 2,
			body: Buffer.concat([
				channel({ places: 3, index: [0x0f], walk }),
				channel({ places: 3, index: [0x30], walk }),
				channel({ places: 3, index: [0x20], walk }),
				channel({ places: 3, index: [0x10], walk }),
			]),
		});
		const bytes = await bytesOf(data);
		// The bitmap stands of four places to a place, of the blue of a colour first.
		expect([...bytes.subarray(0x36, 0x42)]).toEqual([
			0x10, 0x20, 0x30, 0xf0, 0x10, 0x20, 0x30, 0xf0, 0x10, 0x20, 0x30, 0xf0,
		]);
	});

	it("reads a picture of the places of the file itself", async () => {
		const data = limFile({
			width: 2,
			height: 1,
			flags: 0x12,
			bitsPerPixel: 16,
			body: Buffer.from([0x1f, 0x00, 0xe0, 0x07]),
		});
		const bytes = await bytesOf(data);
		expect([...bytes.subarray(0x42, 0x46)]).toEqual([0x1f, 0x00, 0xe0, 0x07]);
	});

	it("reads a picture of the walks of the channels of it", async () => {
		// A picture of one place: the channel of it stands of one word of the table of the walk.
		const data = limFile({
			width: 1,
			height: 1,
			flags: 0x32,
			bitsPerPixel: 16,
			body: channel({
				places: 2,
				index: [0x1f, 0x00],
				walk: walkOf([0]),
				indexSize: 1,
			}),
		});
		const bytes = await bytesOf(data);
		expect([...bytes.subarray(0x42, 0x44)]).toEqual([0x1f, 0x00]);
	});

	it("reads the alpha behind the places of a picture", async () => {
		const data = limFile({
			width: 1,
			height: 1,
			flags: 0x112,
			bitsPerPixel: 16,
			body: Buffer.from([0x1f, 0x00, 0x0f]),
		});
		const bytes = await bytesOf(data);
		// The places of the picture stand of the colours of the bitmap behind them, of the places of the
		// file of the alpha of the picture the other way round.
		expect([...bytes.subarray(0x36, 0x3a)]).toEqual([0xff, 0x00, 0x00, 0xf0]);
	});

	it("reads the alpha of a picture of the walks of the channels of it", async () => {
		// The places of the colours of the picture stand of a walk of the words of a table of their own,
		// and the alpha of it behind them.
		const walk = walkOfThree(2);
		const data = limFile({
			width: 3,
			height: 1,
			flags: 0x332,
			bitsPerPixel: 16,
			body: Buffer.concat([
				channel({
					places: 6,
					index: [0x1f, 0x00],
					walk,
					indexSize: 1,
				}),
				channel({ places: 3, index: [0x00], walk }),
			]),
		});
		const bytes = await bytesOf(data);
		expect([...bytes.subarray(0x36, 0x42)]).toEqual([
			0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff,
		]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = limFile({
			width: 1,
			height: 1,
			flags: 2,
			body: Buffer.concat([
				channel({ places: 1, index: [0x0f], walk: walkOf([0]) }),
				channel({ places: 1, index: [0x30], walk: walkOf([0]) }),
				channel({ places: 1, index: [0x20], walk: walkOf([0]) }),
				channel({ places: 1, index: [0x10], walk: walkOf([0]) }),
			]),
		});
		expect(await liarLimImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await liarLimImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x10, 0x00)),
			),
		).toBe(false);
		await expect(
			liarLimImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x10, 0x00)),
				"cg.lim",
			),
		).rejects.toThrow(GarbroError);
	});
});
