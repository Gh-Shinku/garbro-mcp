import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	JbpBitStream,
	JbpHuffmanTree,
	reverseByteBits,
} from "../../packages/codecs/src/jbp-huffman.js";

/** Packs places of a walk as the places of a file of the Purple engine stand: every place of a byte of such a
 * file stands the other way round, so the first place of the walk stands as the lowest place of the byte. */
function packPlaces(places: readonly number[]): Buffer {
	const bytes: number[] = [];
	for (let at = 0; at < places.length; at += 8) {
		let byte = 0;
		for (let bit = 0; bit < 8; bit += 1) {
			if ((places[at + bit] ?? 0) !== 0) byte |= 1 << bit;
		}
		bytes.push(byte);
	}
	return Buffer.from(bytes);
}

describe("Purple walks of the places of a picture", () => {
	it("stands the places of a byte the other way round", () => {
		expect(reverseByteBits(0x0c)).toBe(0x30);
		expect(reverseByteBits(0x01)).toBe(0x80);
		expect(reverseByteBits(0xff)).toBe(0xff);
		expect(reverseByteBits(0x00)).toBe(0x00);
	});

	it("reads the places of a file as the places of the file they stand as", () => {
		const bits = new JbpBitStream(Buffer.from([0x0c]), 0, 1);
		// The places of the file stand the other way round, so the places `0011` stand as the places `1100`.
		expect(bits.getBits(4)).toBe(0b0011);
		expect(bits.getBits(4)).toBe(0b0000);
		const single = new JbpBitStream(Buffer.from([0x01]), 0, 1);
		expect(single.getNextBit()).toBe(1);
		const read = new JbpBitStream(Buffer.from([0x0f, 0x00]), 0, 2);
		expect(read.getBits(8)).toBe(0b11110000);
	});

	it("turns a walk that stands past the places of the file away", () => {
		const bits = new JbpBitStream(Buffer.from([0x00]), 0, 1);
		expect(() => bits.getBits(9)).toThrow(RangeError);
		const empty = new JbpBitStream(Buffer.alloc(0), 0, 0);
		expect(() => empty.getNextBit()).toThrow(RangeError);
	});

	it("stands the walk of the places of a picture as the reference stands it", () => {
		// The walk stands the two places that stand for the fewest places of the walk beside each other until
		// one place of the walk stands for them all: four places that stand for one place of the walk apiece
		// stand as the place of the walk six, whose places stand as the places four and five, and so on.
		const tree = new JbpHuffmanTree(
			Buffer.from([0x10, 0x11, 0x12, 0x13]),
			[1, 1, 1, 1],
		);
		expect(tree.leafCount).toBe(4);
		expect(tree.root).toBe(6);
		expect([0, 1, 2, 3].map((at) => tree.place(at))).toEqual([
			0x10, 0x11, 0x12, 0x13,
		]);
		// Every place of the walk of the picture stands as the places of the file that stand for it: 00, 01,
		// 10 and 11 in turn.
		const bits = new JbpBitStream(packPlaces([0, 0, 0, 1, 1, 0, 1, 1]), 0, 1);
		expect([
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
		]).toEqual([0, 1, 2, 3]);
	});

	it("stands a place of the walk that stands for more places of the walk first", () => {
		// The places of the walk stand for four, one, one and one places of the walk: the places of the walk
		// stand the second and the third beside each other, then the fourth beside those, then the first beside
		// them, so the place that stands for the most places of the walk stands as one place of the file and the
		// others as three.
		const tree = new JbpHuffmanTree(Buffer.from([1, 2, 3, 4]), [4, 1, 1, 1]);
		expect(tree.leafCount).toBe(4);
		expect(tree.root).toBe(6);
		// The places of the walk stand as 1, 010, 011 and 00 in turn, so the places 0, 1, 2 and 3 stand as
		// 1 010 011 00.
		const places = [1, 0, 1, 0, 0, 1, 1, 0, 0];
		expect(packPlaces(places)).toEqual(Buffer.from([0x65, 0x00]));
		const bits = new JbpBitStream(packPlaces(places), 0, 2);
		expect([
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
		]).toEqual([0, 1, 2, 3]);
	});

	it("stands a walk of places that name no places of the walk at all", () => {
		// A walk every place of which stands for no places of the walk stands as no place of the walk rather
		// than standing its places past the words it was given.
		const tree = new JbpHuffmanTree(Buffer.from([1, 2]), [0, 0]);
		expect(tree.leafCount).toBe(2);
		expect(Number.isInteger(tree.root)).toBe(true);
	});
});
