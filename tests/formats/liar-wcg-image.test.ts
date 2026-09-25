import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { liarWcgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readWcgLayout } from "../../packages/formats/src/liar/wcg-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The walks of the bits of a picture, of the highest place of every place of the file first. */
class MsbWriter {
	private readonly bits: number[] = [];

	bitsOf(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1)
			this.bits.push((value >> at) & 1);
	}

	bytes(): Buffer {
		const out: number[] = [];
		for (let at = 0; at < this.bits.length; at += 8) {
			let value = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				value = (value << 1) | (this.bits[at + bit] ?? 0);
			}
			out.push(value);
		}
		return Buffer.from(out);
	}
}

/** A walk of a picture of two places to a place: the words of it and the walk of them. */
function stream(words: number[], walk: MsbWriter, pixels: number): Buffer {
	const head: Buffer = Buffer.alloc(12, 0x00);
	// The head of a walk names the places of the picture it stands of, of two places each.
	head.writeInt32LE(pixels * 2, 0);
	const bits = walk.bytes();
	head.writeUInt32LE(bits.length, 4);
	head.writeUInt16LE(words.length, 8);
	const index: Buffer = Buffer.alloc(words.length * 2, 0x00);
	for (const [at, word] of words.entries()) {
		index.writeUInt16LE(word, at * 2);
	}
	return Buffer.concat([head, index, bits]);
}

/**
 * A picture of the engine: the head of it and the two walks of the places of it. The first walk stands of
 * the places of the file behind the head and the second of the places behind the first.
 */
function wcgFile(input: {
	width: number;
	height: number;
	half: Buffer;
	other: Buffer;
	flags?: number;
}): Buffer {
	const head: Buffer = Buffer.alloc(16, 0x00);
	head.write("WG", 0, "latin1");
	head.writeUInt16LE(input.flags ?? 0x0271, 2);
	head[4] = 0x20;
	head[5] = 0x00;
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 12);
	return Buffer.concat([head, input.half, input.other]);
}

/** The places of a picture of four places to a place: the places of the second walk stand of the last. */
function placesOf(pixels: number[][]): { half: number[]; other: number[] } {
	const half: number[] = [];
	const other: number[] = [];
	for (const [blue, green, red, alpha] of pixels) {
		// The alpha of the places of the picture stands of the places of the file the other way round.
		half.push(((red ?? 0) & 0xff) | (((~(alpha ?? 0) & 0xff) << 8) & 0xff00));
		other.push(((blue ?? 0) & 0xff) | (((green ?? 0) << 8) & 0xff00));
	}
	return { half, other };
}

/** The walk of a picture of the places of a walk of its own: a place of the words and the index of it. */
function walkOf(indices: number[], indexBits = 3): MsbWriter {
	const walk = new MsbWriter();
	for (const index of indices) {
		if (index < 2) {
			walk.bitsOf(1, indexBits);
			walk.bitsOf(index, 1);
		} else {
			// A place of the walk of n places stands of the places of the file behind the head of it.
			const length = 31 - Math.clz32(index);
			walk.bitsOf(length + 1, indexBits);
			walk.bitsOf(index - (1 << length), length);
		}
	}
	return walk;
}

async function pictureOf(data: Buffer) {
	const handle = await liarWcgImageFormat.open(
		new BufferByteSource(data),
		"cg.wcg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Liar-soft proprietary image", () => {
	it("reads the head of a picture", () => {
		const layout = readWcgLayout(
			wcgFile({
				width: 2,
				height: 1,
				half: Buffer.alloc(0),
				other: Buffer.alloc(0),
			}),
		);
		expect(layout).toEqual({ flags: 0x0271, width: 2, height: 1 });
		const stray = Buffer.from(
			wcgFile({
				width: 2,
				height: 1,
				half: Buffer.alloc(0),
				other: Buffer.alloc(0),
				flags: 0x0272,
			}),
		);
		expect(readWcgLayout(stray)).toBeUndefined();
		expect(readWcgLayout(Buffer.alloc(16, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture, of the words of the two walks of it", async () => {
		const pixels = [
			[0x01, 0x02, 0x03, 0xf0],
			[0x11, 0x12, 0x13, 0x0f],
		];
		const { half, other } = placesOf(pixels);
		const image = await pictureOf(
			wcgFile({
				width: 2,
				height: 1,
				half: stream(half, walkOf([0, 1]), 2),
				other: stream(other, walkOf([0, 1]), 2),
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0x01, 0x02, 0x03, 0xf0, 0x11, 0x12, 0x13, 0x0f,
		]);
	});

	it("reads a picture of the places of a word of the walk standing one after another", async () => {
		const pixels = [
			[0x21, 0x22, 0x23, 0x80],
			[0x21, 0x22, 0x23, 0x80],
			[0x21, 0x22, 0x23, 0x80],
		];
		const { half, other } = placesOf(pixels);
		const run = new MsbWriter();
		// A count of three places stands of the count of the walk behind the head of it.
		run.bitsOf(0, 3);
		run.bitsOf(1, 4);
		run.bitsOf(1, 3);
		run.bitsOf(0, 1);
		const image = await pictureOf(
			wcgFile({
				width: 3,
				height: 1,
				half: stream([half[0] ?? 0], run, 3),
				other: stream([other[0] ?? 0], run, 3),
			}),
		);
		expect([...image.pixels]).toEqual([
			0x21, 0x22, 0x23, 0x80, 0x21, 0x22, 0x23, 0x80, 0x21, 0x22, 0x23, 0x80,
		]);
	});

	it("reads a picture of the places of a word standing of the places of the head of the walk", async () => {
		const pixels = [
			[0x31, 0x32, 0x33, 0x40],
			[0x41, 0x42, 0x43, 0x50],
		];
		const { half, other } = placesOf(pixels);
		const index: number[] = [0, 0, 0, 0, 0];
		index[4] = half[0] ?? 0;
		index[5] = half[1] ?? 0;
		const walk = walkOf([4, 5]);
		const otherIndex: number[] = [0, 0, 0, 0, 0];
		otherIndex[4] = other[0] ?? 0;
		otherIndex[5] = other[1] ?? 0;
		const image = await pictureOf(
			wcgFile({
				width: 2,
				height: 1,
				half: stream(index, walk, 2),
				other: stream(otherIndex, walkOf([4, 5]), 2),
			}),
		);
		expect([...image.pixels]).toEqual([
			0x31, 0x32, 0x33, 0x40, 0x41, 0x42, 0x43, 0x50,
		]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const { half, other } = placesOf([[1, 2, 3, 4]]);
		const data = wcgFile({
			width: 1,
			height: 1,
			half: stream(half, walkOf([0]), 1),
			other: stream(other, walkOf([0]), 1),
		});
		expect(await liarWcgImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await liarWcgImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(16, 0x00)),
			),
		).toBe(false);
		await expect(
			liarWcgImageFormat.open(
				new BufferByteSource(Buffer.alloc(16, 0x00)),
				"cg.wcg",
			),
		).rejects.toThrow(GarbroError);
	});
});
