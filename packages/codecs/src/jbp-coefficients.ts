// Format reference: GARbro "ArcFormats/Cmvs/ImagePB3.cs", the walk of the places of a picture inside
// `JbpReader.Decode`, over the classes `JBitStream` and `HuffmanTree` that `jbp-huffman.ts` stands.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { JbpBitStream, JbpHuffmanTree } from "./jbp-huffman.js";

/** `JbpReader.ZigzagOrder`: where every place of the walk of the places of a picture stands in the places of
 * its own. */
export const JBP_ZIGZAG_ORDER: readonly number[] = [
	1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48,
	41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
	15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
	55, 62, 63, 0,
];
/** How many places of the walk of the places of a picture stand for one place of the walk of a colour of it,
 * and how many places of a colour stand beside one another in every place of a picture of this kind. */
const PLACES_PER_BLOCK = 64;
const BLOCKS_PER_MACROBLOCK = 6;
/** The places of a walk of the places of a picture stand behind the places of another walk: the walk of the
 * places that stand for every place of a colour of the picture stands its places as places of their own until
 * it stands the places of the place of a colour, and the places the walk names stand as places of the places
 * of the picture behind those. */
const END_OF_BLOCK = 15;
const RUN_ESCAPE = 0;
const PLACES_AFTER_DC = PLACES_PER_BLOCK - 1;

/** How many places of the walk of the places of a picture every place of a colour of it stands in. */
export interface JbpBlockLayout {
	blocksX: number;
	blocksY: number;
}

/**
 * `Decode`: every place of a colour of a picture of this kind stands as the places of the walk of the places of
 * its picture: the places that name how many places of the walk stand for the place of the colour stand as
 * places of the walk of their own, every one of them naming how far the place of the colour stands from the
 * place of the colour before it, and the places of the colour that stand for the places of the picture beside
 * it stand behind those, every step naming how far the place stands along the places of the picture it stands
 * at, or standing as places of the walk that name how many places of the picture stand beside it as no places
 * of the picture at all.
 */
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
	// The places of the walk of the places of a colour of a picture stand for the places of the walk of the
	// picture before them, so the places of a colour of the picture stand as the places of the walk of the
	// place of the colour before them beside the places the walk names.
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
					// The places the walk stands for the places of the picture beside it stand as places of the
					// walk of their own: every place of them stands as one place of the walk while it stands as
					// the place behind it, and the place of the walk it names names how many places of the
					// picture stand beside it.
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

/** The walk of the places of a picture stands how far a place stands from the place before it as places that
 * stand the way round: a place of the walk that stands at the places that stand below half the places the step
 * names stands as the places it names behind it rather than as the places it stands at. */
function standSigned(value: number, count: number): number {
	// A step that names no places of the walk at all stands as no places of the walk.
	const half = count === 0 ? 0x80000000 : 2 ** (count - 1);
	const full = count === 0 ? 0 : 2 ** count - 1;
	if (value < half) return (value - full) >>> 0;
	return value >>> 0;
}
