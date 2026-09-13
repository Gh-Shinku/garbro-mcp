// Format reference: GARBro ArcFormats/HuffmanCompression.cs, class `HuffmanDecompressor`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "./msb-bit-reader.js";

/** Nodes above this index are internal; leaves hold byte values. */
const LEAF_LIMIT = 0x100;
/** GARbro allocates a fixed 512-entry tree. */
export const HUFFMAN_TREE_SIZE = 512;
/** Each bit of a node that is set marks an internal node rather than a leaf. */
const MAX_OUTPUT = Number.MAX_SAFE_INTEGER;

/**
 * GARbro `HuffmanDecompressor.Unpack`. The tree is stored in the same bit stream as the data: a set
 * bit introduces an internal node whose two children follow, while a clear bit introduces a leaf with
 * an eight-bit value. Decoding then walks that tree, reading one bit per level, until it reaches a
 * leaf below 0x100.
 *
 * GARbro stops quietly when the stream ends before the requested length, and the caller wraps the
 * result in a `LimitStream`, so the port returns whatever it decoded. That stop also makes a tree
 * whose root is already a leaf produce that leaf without consuming data bits, which the port keeps.
 */
export function decompressHuffman(
	input: Uint8Array,
	outputLength = MAX_OUTPUT,
): Buffer {
	if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
		throw new RangeError(
			"Huffman output length must be a non-negative integer",
		);
	}
	const bits = new MsbBitReader(input);
	const lhs = new Uint16Array(HUFFMAN_TREE_SIZE);
	const rhs = new Uint16Array(HUFFMAN_TREE_SIZE);
	let token = HUFFMAN_TREE_SIZE / 2;

	const createTree = (): number => {
		const bit = bits.tryReadBits(1);
		if (bit === -1) {
			throw new RangeError("Huffman stream ended while reading the tree");
		}
		if (bit === 0) return bits.readBits(8);
		const node = token++;
		if (node >= HUFFMAN_TREE_SIZE) {
			throw new RangeError("Huffman tree exceeds its fixed size");
		}
		lhs[node] = createTree();
		rhs[node] = createTree();
		return node;
	};

	const root = createTree();
	const output = Buffer.alloc(outputLength);
	let position = 0;
	while (position < output.length) {
		let symbol = root;
		while (symbol >= LEAF_LIMIT) {
			const bit = bits.tryReadBits(1);
			if (bit === -1) return output.subarray(0, position);
			symbol = bit === 0 ? (lhs[symbol] ?? 0) : (rhs[symbol] ?? 0);
		}
		output[position] = symbol;
		position += 1;
	}
	return output;
}
