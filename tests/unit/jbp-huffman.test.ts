import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	JbpBitStream,
	JbpHuffmanTree,
	reverseByteBits,
} from "../../packages/codecs/src/jbp-huffman.js";

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
		const tree = new JbpHuffmanTree(
			Buffer.from([0x10, 0x11, 0x12, 0x13]),
			[1, 1, 1, 1],
		);
		expect(tree.leafCount).toBe(4);
		expect(tree.root).toBe(6);
		expect([0, 1, 2, 3].map((at) => tree.place(at))).toEqual([
			0x10, 0x11, 0x12, 0x13,
		]);
		const bits = new JbpBitStream(packPlaces([0, 0, 0, 1, 1, 0, 1, 1]), 0, 1);
		expect([
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
			tree.read(bits),
		]).toEqual([0, 1, 2, 3]);
	});

	it("stands a place of the walk that stands for more places of the walk first", () => {
		const tree = new JbpHuffmanTree(Buffer.from([1, 2, 3, 4]), [4, 1, 1, 1]);
		expect(tree.leafCount).toBe(4);
		expect(tree.root).toBe(6);
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
		const tree = new JbpHuffmanTree(Buffer.from([1, 2]), [0, 0]);
		expect(tree.leafCount).toBe(2);
		expect(Number.isInteger(tree.root)).toBe(true);
	});
});
