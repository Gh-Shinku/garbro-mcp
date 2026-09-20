import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	JBP_ZIGZAG_ORDER,
	decodeJbpCoefficients,
} from "../../packages/codecs/src/jbp-coefficients.js";
import {
	JbpBitStream,
	JbpHuffmanTree,
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

function bitsOf(places: readonly number[]): JbpBitStream {
	const packed = packPlaces(places);
	return new JbpBitStream(packed, 0, packed.length);
}

/** The words of the walk of the places that stand for the places of a picture beside the places of a colour,
 * which stand as sixteen places of the walk. The walk stands the two places that stand for the fewest places
 * of the walk beside each other, so every place of sixteen that stand for one place of the walk apiece stands
 * as the places of the file that stand for the place of the walk itself: the places of the walk that stand for
 * the place of the picture stand as 0000, those that stand for two places of the walk as 0010, and those that
 * name the end of the places of a colour as 1111. */
function acTree(): JbpHuffmanTree {
	return new JbpHuffmanTree(
		Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		new Array(16).fill(1),
	);
}

/** The words of the walk of the places that name how many places of the walk of the picture stand for the
 * places of a colour: the word one names one place of the walk and the word nothing names none. */
function dcTree(): JbpHuffmanTree {
	return new JbpHuffmanTree(Buffer.from([0, 0]), [1, 1]);
}

describe("Purple places of a picture", () => {
	it("stands the places of a picture behind the places the walk of its colours names", () => {
		const treeDc = dcTree();
		const treeAc = acTree();
		expect(treeDc.root).toBe(2);
		expect(treeAc.leafCount).toBe(16);
		// Every place of a colour stands as the places of the walk of the picture that stand for it: the places
		// 1, 1, 0, 1, 0, 1 stand for one place of the walk, one behind it, one behind that, and so on, and every
		// one of them stands as one place of the walk of the picture.
		const dcPlaces = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0];
		const acPlaces = new Array(24).fill(1);
		const tables = decodeJbpCoefficients({
			treeDc,
			bitsDc: bitsOf(dcPlaces),
			treeAc,
			bitsAc: bitsOf(acPlaces),
			blocks: { blocksX: 1, blocksY: 1 },
		});
		// The place of the walk of the picture that stands for the place of the picture of the first place of a
		// colour stands as one place of the walk, the place behind it as one place back from it, which stands
		// as nothing, and so on.
		// Every place of a colour stands as four and sixty places of its own, the place of the walk of the
		// picture it stands for standing as the first of them.
		expect(tables.length).toBe(6 * 64);
		expect([0, 1, 2, 3, 4, 5].map((place) => tables[place * 64])).toEqual([
			1, 0, 1, 0, 1, 0,
		]);
		for (let at = 0; at < 6 * 64; at += 1) {
			if (at % 64 !== 0) expect(tables[at]).toBe(0);
		}
	});

	it("stands the places of the picture where the walk of the places of the picture names them", () => {
		// A walk of the places of a colour of a picture every place of which stands as no places of the walk of
		// the picture at all reads no places of the file: the places of a colour of such a picture stand as
		// nothing.
		const treeDc = new JbpHuffmanTree(Buffer.from([0]), [1]);
		expect(treeDc.root).toBe(0);
		const treeAc = acTree();
		// The places of the first place of a colour: the places 0000 name a walk of their own, which stands as
		// the place 0 — the place of the walk that stands for two places of the picture — and then the places
		// 0010 name two places of the walk of the picture, which stand as 01: the places of the walk stand as
		// nothing and one place, which stand as the places two behind the place that stands before them. The
		// places 1111 then name the end of the places of a colour.
		const acPlaces = [
			0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
			1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
		];
		const tables = decodeJbpCoefficients({
			treeDc,
			bitsDc: bitsOf([]),
			treeAc,
			bitsAc: bitsOf(acPlaces),
			blocks: { blocksX: 1, blocksY: 1 },
		});
		// Two places of the picture stand beside the place of a colour, so the places that stand for the places
		// of the picture stand two places along the places of the walk of the colour, which stands as the place
		// sixteen of those places.
		expect(JBP_ZIGZAG_ORDER[2]).toBe(16);
		expect(tables[16]).toBe(-2);
		for (let at = 0; at < 64; at += 1) {
			if (at !== 16) expect(tables[at]).toBe(0);
		}
	});

	it("stands the walk of a picture of more than one place of a picture", () => {
		const tables = decodeJbpCoefficients({
			treeDc: dcTree(),
			bitsDc: bitsOf([
				1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
			]),
			treeAc: acTree(),
			bitsAc: bitsOf(new Array(48).fill(1)),
			blocks: { blocksX: 2, blocksY: 1 },
		});
		// Two places of a picture stand as two walks of their own, every one of them standing as six places of
		// a colour and every place of a colour as four and sixty places of the picture.
		expect(tables.length).toBe(2 * 6 * 64);
		expect([0, 1, 2, 3, 4, 5].map((place) => tables[place * 64])).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
		expect(
			[0, 1, 2, 3, 4, 5].map((place) => tables[6 * 64 + place * 64]),
		).toEqual([7, 8, 9, 10, 11, 12]);
	});
});
