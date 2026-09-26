// The counts of the walk of the engine of the Entis engine, of the tests of the port: an encoder of the
// places of the walk of the engine (the tree of the counts of it of the port itself, of the places of the
// names of the tree, of the places of the count of no name at all and of the counts of the walks of them)
// and of the counts of the walk of the places of the tree of it.
import { ErisaHuffmanTree } from "@garbro-mcp/codecs";

export const ERISA_HUFFMAN_ROOT = 0x200;
export const ERISA_HUFFMAN_NULL = 0x8000;

/** The places of the walk of the tree of the counts of the engine, of the name of a place of it. */
export function pathTo(tree: ErisaHuffmanTree, place: number): number[] {
	const bits: number[] = [];
	let at = place;
	for (let level = 0; level < 0x40; level += 1) {
		const parent = tree.tree[at]?.parent ?? -1;
		if (parent < 0)
			throw new Error("the place of the tree stands of no walk of it");
		const child = tree.tree[parent]?.childCode ?? 0;
		// The places of the walk of the tree stand of the two places of a walk of it: the places of the
		// count of the walk of the engine in front of the places of the count of the walk of it.
		bits.unshift(at - child);
		if (parent === ERISA_HUFFMAN_ROOT) return bits;
		at = parent;
	}
	throw new Error("the place of the tree stands of no place of the root of it");
}

/** The places of a count of the walk of the engine, of the name of the count. */
export function countPlaces(count: number): number[] {
	const bits: number[] = [];
	for (let at = 7; at >= 0; at -= 1) bits.push((count >> at) & 1);
	return bits;
}

/**
 * The places of a count of the walk of the counts of the engine of no name at all, of the count of the walk
 * of it (`GetGammaCode`): the count of the walk of the engine stands of a place of the walk of it of its own
 * in front of the counts of the walk of the engine behind it, and every count of the walk of the engine
 * behind the count of the walk of it stands of a place of the count of the walk of it and of the count of
 * the walk of the engine behind the places of the walk of it.
 */
export function gammaBits(value: number): number[] {
	if (1 === value) return [0];
	const top = 31 - Math.clz32(value);
	const code = value - (1 << top);
	const bits: number[] = [1];
	for (let at = top - 1; at >= 0; at -= 1) {
		bits.push((code >>> at) & 1);
		bits.push(0 === at ? 0 : 1);
	}
	return bits;
}

/** The places of a name of the walk of the engine, of the tree of the counts of the walk of the engine. */
export function addSymbolBits(
	bits: number[],
	tree: ErisaHuffmanTree,
	symbol: number,
): void {
	if (ERISA_HUFFMAN_NULL === tree.escape) {
		// The tree of the counts of the walk of the engine stands of no place of a name at all: the count of
		// the walk of the engine stands of the places of the count of the walk of it itself.
		bits.push(...countPlaces(symbol));
		tree.addNewEntry(symbol);
		return;
	}
	const found = tree.symbolLookup[symbol] ?? ERISA_HUFFMAN_NULL;
	if (ERISA_HUFFMAN_NULL !== found) {
		// The place of the name of the tree stands of the walk of the places of the tree of the counts of the
		// walk of the engine, and the count of the walk of the place stands of the walk of it.
		bits.push(...pathTo(tree, found));
		tree.increaseOccuredCount(found);
		return;
	}
	// The place of the count of the walk of the engine of the places of the walk of the engine of no name at
	// all stands of the places of the count of the walk of the engine itself behind it.
	bits.push(...pathTo(tree, tree.escape));
	tree.increaseOccuredCount(tree.escape);
	bits.push(...countPlaces(symbol));
	tree.addNewEntry(symbol);
}

/**
 * The places of the count of the walk of the engine of the count of no name at all, of the count of the
 * places of the walk of it (`GetLengthHuffman`): the counts of the walk of the engine of the count of no
 * name at all stand of the counts of the walk of the engine of the count of the walk of the engine of its
 * own, of no place of a count of the walk of the engine at all.
 */
export function addLengthBits(
	bits: number[],
	tree: ErisaHuffmanTree,
	count: number,
): void {
	if (ERISA_HUFFMAN_NULL === tree.escape) {
		bits.push(...gammaBits(count));
		tree.addNewEntry(count);
		return;
	}
	const found = tree.symbolLookup[count] ?? ERISA_HUFFMAN_NULL;
	if (ERISA_HUFFMAN_NULL !== found) {
		bits.push(...pathTo(tree, found));
		tree.increaseOccuredCount(found);
		return;
	}
	bits.push(...pathTo(tree, tree.escape));
	tree.increaseOccuredCount(tree.escape);
	bits.push(...gammaBits(count));
	tree.addNewEntry(count);
}

/**
 * An encoder of the counts of the walk of the engine: the walk of the port stands of the places of the tree
 * of the counts of the walk of the engine, and this encoder stands of the walk of the places of the tree of
 * it itself (the places of the names of the tree, of the places of the count of no name of it and of the
 * counts of the walks of them). The counts of the walk of the engine stand of the counts of the walk of the
 * engine of the count of the walk of the engine of a picture of it: the trees of the walk of the engine stand
 * of the counts of the walk of the engine of every count of the walk of the picture, of no count of the walk
 * of the engine of its own.
 */
export class ErisaEncoder {
	#trees: ErisaHuffmanTree[] = [];
	#lengthTree = new ErisaHuffmanTree();
	#bits: number[] = [];
	#tree: ErisaHuffmanTree | undefined;

	constructor() {
		for (let at = 0; at < 0x101; at += 1) {
			this.#trees.push(new ErisaHuffmanTree());
		}
		this.#tree = this.#trees[0];
	}

	get bits(): readonly number[] {
		return this.#bits;
	}

	/** The places of a count of the walk of the engine, of the counts of the walk of the engine itself. */
	addPlaces(places: readonly number[]): void {
		const bits = this.#bits;
		const trees = this.#trees;
		const lengthTree = this.#lengthTree;
		let tree = this.#tree ?? trees[0] ?? new ErisaHuffmanTree();
		let at = 0;
		while (at < places.length) {
			const symbol = (places[at] ?? 0) & 0xff;
			addSymbolBits(bits, tree, symbol);
			at += 1;
			if (0 === symbol) {
				// The count of the walk of the engine of the places of the walk of the engine of no name at
				// all stands of the count of the places of the walk of the engine behind it.
				let run = 1;
				while (at < places.length && 0 === ((places[at] ?? 0) & 0xff)) {
					run += 1;
					at += 1;
				}
				addLengthBits(bits, lengthTree, run);
			}
			tree = trees[symbol] ?? tree;
		}
		// The counts of the walk of the engine of the count of the walk of the picture stand of the counts
		// of the walk of the engine of the count of the walk of it: the tree of the last place of the walk
		// of the engine of a count of the walk of the picture stands of the tree of the first place of the
		// count of the walk of the engine behind it.
		this.#tree = tree;
	}
}

/** The places of the walk of the engine of the counts of the walk of a picture of it. */
export function encodeErinaBits(places: readonly number[]): number[] {
	const encoder = new ErisaEncoder();
	encoder.addPlaces(places);
	return [...encoder.bits];
}

/** The places of a count of the walk of the engine of the port, of the places of the walk of it. */
export function bitsToBuffer(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [at, bit] of bits.entries()) {
		if (0 !== bit) {
			out[Math.floor(at / 8)] =
				(out[Math.floor(at / 8)] ?? 0) | (1 << (7 - (at % 8)));
		}
	}
	return out;
}

/** The places of the walk of the engine of a count of the walk of a sound of the engine. */
export function encodeErina(places: readonly number[]): Buffer {
	return bitsToBuffer(encodeErinaBits(places));
}
