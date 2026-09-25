// The Huffman reader of the CVNS engine, against streams written in the test: a tree written before the run
// it stands of, of a set bit for a place of two behind it and of a clear bit for the place of a byte behind
// it, and a stream of words of thirty two places read from the lowest place of a byte up.
import { Buffer } from "node:buffer";
import { decompressCmvsHuffman } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** Packs places lowest-first within a word of thirty two places, and the word from its lowest byte up. */
function packWords(bits: readonly number[]): Buffer {
	const words = Math.max(Math.ceil(bits.length / 32), 0);
	const output = Buffer.alloc(words * 4);
	bits.forEach((bit, index) => {
		if (0 === bit) return;
		const word = Math.floor(index / 32) * 4;
		output.writeUInt32LE(
			(output.readUInt32LE(word) | (1 << (index % 32))) >>> 0,
			word,
		);
	});
	return output;
}

/**
 * The places of a leaf of a byte: a clear bit and the eight places of the place itself, from the highest of
 * them down, which is the order the reader stands of the places of a field of eight of them.
 */
function leaf(value: number): number[] {
	const bits: number[] = [0];
	for (let place = 7; place >= 0; place -= 1) {
		bits.push((value >>> place) & 1);
	}
	return bits;
}

/** The places of a place of two behind the tree: a set bit and the two places behind it. */
function node(left: readonly number[], right: readonly number[]): number[] {
	return [1, ...left, ...right];
}

describe("CVNS Huffman reader", () => {
	it("reads a tree of two places", () => {
		// A place of two behind the tree, of 'A' to the left and 'B' to the right: the run reads a lowest
		// place of nothing for the left one and a place of one for the right one.
		const stream = packWords([...node(leaf(0x41), leaf(0x42)), 0, 1, 0, 1]);
		expect(decompressCmvsHuffman(stream, 0, 4).toString("latin1")).toBe("ABAB");
	});

	it("reads a leaf at the root of the tree", () => {
		// A tree of a leaf alone stands of no place of the stream behind it, so the run is that place.
		const stream = packWords(leaf(0x5a));
		expect(decompressCmvsHuffman(stream, 0, 3).toString("latin1")).toBe("ZZZ");
	});

	it("reads a tree of four places", () => {
		// A place of two behind the tree, of a place of two behind each of its places: the run reads two
		// places of the stream per place of the tree.
		const stream = packWords([
			...node(node(leaf(0x30), leaf(0x31)), leaf(0x32)),
			// The run: the left place of the root twice for '0', its left place and then its right one for
			// '1', the right place of the root for '2', and the places of '1' again.
			0,
			0,
			0,
			1,
			1,
			0,
			1,
		]);
		expect(decompressCmvsHuffman(stream, 0, 4).toString("latin1")).toBe("0121");
	});

	it("reads a run of a stream that stands of more than one word", () => {
		// The tree and the run of it may run over the places of a word, which the reader takes one behind
		// the other from the lowest place of a byte up.
		const bits: number[] = [];
		for (let value = 0; value < 64; value += 1) {
			bits.push(...node(leaf(value), leaf(value + 64)));
		}
		// A full tree of sixty four places of two, of a walk of the places of it read one at a time: every
		// place of the walk stands of the left place of the root and then of the place of its own behind it.
		for (let at = 0; at < 64; at += 1) {
			for (let place = 0; place < 6; place += 1) {
				bits.push(place === 0 ? 0 : at < 32 ? 0 : 1);
			}
		}
		const run = decompressCmvsHuffman(packWords(bits), 0, 64);
		expect(run.length).toBe(64);
		expect([...new Set(run)].length).toBeGreaterThan(1);
	});

	it("reads the stream of the run from a place of its own", () => {
		// The reader stands of the place of the stream it is handed, which the engine names of the head of
		// the entry the run stands of.
		const stream = Buffer.concat([
			Buffer.from([0xde, 0xad, 0xbe, 0xef]),
			packWords([...node(leaf(0x61), leaf(0x62)), 1, 0]),
		]);
		expect(decompressCmvsHuffman(stream, 4, 2).toString("latin1")).toBe("ba");
	});

	it("turns away a tree that stands past the places of the reader", () => {
		// Every set bit stands of a place of two, of which the reference allows two hundred and fifty five.
		const deep = packWords(new Array(600).fill(1));
		expect(() => decompressCmvsHuffman(deep, 0, 1)).toThrow(RangeError);
		// A stream that stands short of the places of its run is turned away as well.
		expect(() => decompressCmvsHuffman(Buffer.alloc(0), 0, 1)).toThrow(
			RangeError,
		);
	});
});
