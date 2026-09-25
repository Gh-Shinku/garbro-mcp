import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	mi4ImageFormat,
	readMi4Layout,
	readMi4Picture,
	unpackMi4Picture,
} from "../../packages/formats/src/shiina-rio/mi4-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x10;
const WORD_BITS = 32;

/** The way of a run of the picture, as the bits behind every one of them name it. */
const WAY_NEAR = [0, 0, 1];
const WAY_BACK = [0, 0, 0, 0, 1];
const WAY_LONG = [0, 0, 0, 0, 0];
/** The way of a place of its own. */
const WAY_OWN = [0, 1];

function bitsOf(value: number, count: number): number[] {
	const bits: number[] = [];
	for (let at = count - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	return bits;
}

/** A run of all three bytes of a place at once, of as many bits as the way of it names. */
function runLong(dB: number, dG: number, dR: number): number[] {
	return [
		...WAY_LONG,
		...bitsOf(dB + 15, 5),
		...bitsOf(dG + 15, 5),
		...bitsOf(dR + 15, 5),
	];
}

/** The way of a run of four bits, whose run reaches over the place above and to the left of the walk. */
function runBack(delta: number): number[] {
	return [
		...WAY_BACK,
		...bitsOf(delta + 7, 4),
		...bitsOf(delta + 7, 4),
		...bitsOf(delta + 7, 4),
	];
}

/** A picture of this engine: its head, the words its places are read out of, then the bytes of its own. */
function mi4File(
	width: number,
	height: number,
	bits: number[],
	literals: number[] = [],
): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("MAI4", 0, "latin1");
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 0x0c);
	const words: Buffer[] = [];
	for (let at = 0; at < bits.length; at += WORD_BITS) {
		let value = 0;
		for (let bit = 0; bit < WORD_BITS; bit += 1) {
			value = (value << 1) | (bits[at + bit] ?? 0);
		}
		const word = Buffer.alloc(4, 0x00);
		word.writeUInt32LE(value >>> 0, 0);
		words.push(word);
	}
	return Buffer.concat([
		head,
		...words,
		Buffer.from(literals),
		Buffer.alloc(4, 0x00),
	]);
}

async function extract(data: Buffer) {
	const handle = await mi4ImageFormat.open(
		new BufferByteSource(data),
		"picture.mi4",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("ShiinaRio image", () => {
	it("reads the places of its width and height", () => {
		const layout = readMi4Layout(mi4File(4, 3, []));
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(3);
		const wrong = Buffer.from(mi4File(4, 3, []));
		wrong.write("MAI3", 0, "latin1");
		expect(readMi4Layout(wrong)).toBeUndefined();
		const empty = Buffer.from(mi4File(4, 3, []));
		empty.writeUInt32LE(0, 8);
		expect(readMi4Layout(empty)).toBeUndefined();
	});

	it("draws the places of a picture one behind the other", () => {
		// A way of a run of five bits reaches over all three bytes of a place at once, every byte by as much
		// as the bits behind it name, smaller by fifteen.
		const bits = [
			...runLong(1, 1, 1),
			...runLong(2, 2, 2),
			...runLong(3, 3, 3),
		];
		const layout = { width: 1, height: 1 };
		expect([
			...unpackMi4Picture(mi4File(1, 1, bits), layout, "second"),
		]).toEqual([1, 1, 1]);
	});

	it("draws the places of a picture one behind the other for every place of it", () => {
		const bits = [
			...runLong(1, 1, 1),
			...runLong(1, 1, 1),
			...runLong(1, 1, 1),
			...runLong(1, 1, 1),
		];
		const layout = { width: 2, height: 2 };
		expect([
			...unpackMi4Picture(mi4File(2, 2, bits), layout, "second"),
		]).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
	});

	it("copies a place from the one above and to the left of it", () => {
		// The way of a run reaches over four bits in the first walk of the picture, and a run of every bit set
		// names the place above and to the left of the one the walk stands at.
		const bits = [
			...runLong(1, 1, 1),
			...runLong(1, 1, 1),
			...runLong(1, 1, 1),
			...runLong(0, 0, 0),
			...runBack(8),
			...runLong(0, 0, 0),
		];
		const layout = { width: 3, height: 2 };
		expect([...unpackMi4Picture(mi4File(3, 2, bits), layout, "first")]).toEqual(
			[1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1],
		);
	});

	it("draws a picture again with the first walk when the second stands short", () => {
		// The second walk of the picture reads a place of its own out of the bits behind the way of a run and
		// then copies the place above the one the walk stands at; the first walk reads the same bits as the
		// runs of the other two bytes of the place. A picture of one place has none above it.
		const bits = [
			...WAY_NEAR,
			...bitsOf(2, 2),
			...bitsOf(3, 2),
			...bitsOf(3, 2),
		];
		const layout = { width: 1, height: 1 };
		expect(() =>
			unpackMi4Picture(mi4File(1, 1, bits), layout, "second"),
		).toThrow();
		expect([...unpackMi4Picture(mi4File(1, 1, bits), layout, "first")]).toEqual(
			[1, 2, 2],
		);
		expect([...readMi4Picture(mi4File(1, 1, bits), layout)]).toEqual([1, 2, 2]);
	});

	it("stands a place of its own as the bytes of the file behind the word of its bits", () => {
		const bits = [...WAY_OWN];
		const layout = { width: 1, height: 1 };
		const data = mi4File(1, 1, bits, [0x11, 0x22, 0x33]);
		expect([...unpackMi4Picture(data, layout, "second")]).toEqual([
			0x11, 0x22, 0x33,
		]);
	});

	it("hands over the picture as a bitmap and turns away what stands no picture", async () => {
		const bits = [
			...runLong(1, 1, 1),
			...runLong(2, 2, 2),
			...runLong(3, 3, 3),
		];
		const image = await extract(mi4File(1, 1, bits));
		expect(image.width).toBe(1);
		expect(image.height).toBe(1);
		expect([...image.pixels]).toEqual([1, 1, 1]);
		const wrong = mi4File(1, 1, bits);
		wrong.write("MAI3", 0, "latin1");
		expect(
			await mi4ImageFormat.detect?.(new BufferByteSource(wrong), "picture.mi4"),
		).toBe(false);
		await expect(
			mi4ImageFormat.open(new BufferByteSource(wrong), "picture.mi4"),
		).rejects.toThrow(/Not a picture/);
	});
});
