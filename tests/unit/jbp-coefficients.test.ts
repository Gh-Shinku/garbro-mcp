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

function acTree(): JbpHuffmanTree {
	return new JbpHuffmanTree(
		Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		new Array(16).fill(1),
	);
}

function dcTree(): JbpHuffmanTree {
	return new JbpHuffmanTree(Buffer.from([0, 0]), [1, 1]);
}

describe("Purple places of a picture", () => {
	it("stands the places of a picture behind the places the walk of its colours names", () => {
		const treeDc = dcTree();
		const treeAc = acTree();
		expect(treeDc.root).toBe(2);
		expect(treeAc.leafCount).toBe(16);
		const dcPlaces = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0];
		const acPlaces = new Array(24).fill(1);
		const tables = decodeJbpCoefficients({
			treeDc,
			bitsDc: bitsOf(dcPlaces),
			treeAc,
			bitsAc: bitsOf(acPlaces),
			blocks: { blocksX: 1, blocksY: 1 },
		});
		expect(tables.length).toBe(6 * 64);
		expect([0, 1, 2, 3, 4, 5].map((place) => tables[place * 64])).toEqual([
			1, 0, 1, 0, 1, 0,
		]);
		for (let at = 0; at < 6 * 64; at += 1) {
			if (at % 64 !== 0) expect(tables[at]).toBe(0);
		}
	});

	it("stands the places of the picture where the walk of the places of the picture names them", () => {
		const treeDc = new JbpHuffmanTree(Buffer.from([0]), [1]);
		expect(treeDc.root).toBe(0);
		const treeAc = acTree();
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
		expect(tables.length).toBe(2 * 6 * 64);
		expect([0, 1, 2, 3, 4, 5].map((place) => tables[place * 64])).toEqual([
			1, 2, 3, 4, 5, 6,
		]);
		expect(
			[0, 1, 2, 3, 4, 5].map((place) => tables[6 * 64 + place * 64]),
		).toEqual([7, 8, 9, 10, 11, 12]);
	});
});
