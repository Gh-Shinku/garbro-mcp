import type { JbpBitStream, JbpHuffmanTree } from "./jbp-huffman.js";

export const JBP_ZIGZAG_ORDER: readonly number[] = [
	1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48,
	41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
	15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
	55, 62, 63, 0,
];
const PLACES_PER_BLOCK = 64;
const BLOCKS_PER_MACROBLOCK = 6;
const END_OF_BLOCK = 15;
const RUN_ESCAPE = 0;
const PLACES_AFTER_DC = PLACES_PER_BLOCK - 1;

export interface JbpBlockLayout {
	blocksX: number;
	blocksY: number;
}

export function decodeJbpCoefficients(options: {
	treeDc: JbpHuffmanTree;
	bitsDc: JbpBitStream;
	treeAc: JbpHuffmanTree;
	bitsAc: JbpBitStream;
	blocks: JbpBlockLayout;
}): Int16Array {
	const { treeDc, bitsDc, treeAc, bitsAc, blocks } = options;
	const total = blocks.blocksX * blocks.blocksY;
	const places = total * BLOCKS_PER_MACROBLOCK;
	const dcs = new Int32Array(places);
	let previous = 0;
	for (let at = 0; at < places; at += 1) {
		const count = treeDc.read(bitsDc);
		let value = bitsDc.getBits(count);
		value = standSigned(value, count);
		previous = (previous + value) >>> 0;
		dcs[at] = (previous << 16) >> 16;
	}
	const tables = new Int16Array(
		total * BLOCKS_PER_MACROBLOCK * PLACES_PER_BLOCK,
	);
	for (let block = 0; block < total; block += 1) {
		for (let place = 0; place < BLOCKS_PER_MACROBLOCK; place += 1) {
			const tableAt =
				(block * BLOCKS_PER_MACROBLOCK + place) * PLACES_PER_BLOCK;
			tables[tableAt] = dcs[block * BLOCKS_PER_MACROBLOCK + place] ?? 0;
			let at = 0;
			while (at < PLACES_AFTER_DC) {
				const count = treeAc.read(bitsAc);
				if (END_OF_BLOCK === count) break;
				if (RUN_ESCAPE === count) {
					let index = 0;
					while (0 !== bitsAc.getNextBit()) index += 1;
					at += treeAc.place(index);
					continue;
				}
				let value = bitsAc.getBits(count);
				value = standSigned(value, count);
				const into = JBP_ZIGZAG_ORDER[at] ?? 0;
				tables[tableAt + into] = ((value << 16) >> 16) as number;
				at += 1;
			}
		}
	}
	return tables;
}

function standSigned(value: number, count: number): number {
	const half = count === 0 ? 0x80000000 : 2 ** (count - 1);
	const full = count === 0 ? 0 : 2 ** count - 1;
	if (value < half) return (value - full) >>> 0;
	return value >>> 0;
}
