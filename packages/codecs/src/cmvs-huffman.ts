// Port of the Huffman reader of the CVNS engine: GARbro `GameRes.Formats.Purple.HuffmanDecoder` (source
// `ArcFormats/Cmvs/HuffmanDecoder.cs`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.
//
// The reader stands of the walk of `ArcFormats/HuffmanCompression.cs` that this project carries already - a
// tree written before the run it stands of, of a set bit for a place of two behind it and of a clear bit
// for a place of a byte - and of a stream of its own: the places of a word of thirty two places are read
// from the **lowest place of a byte up** and every place of the word is read from the lowest of those up,
// where the older reader of the engine reads a stream from the highest place of a byte down. The count of
// the places of the run is handed to the reader, which the engine knows of the head of the entry it stands
// of; the reference never reads the count of the places of the stream it is handed, which stands in its
// signature and nowhere else.

/** The places of the tree of the reference, and the count of its nodes. */
const TREE_PLACES = 512;
const LEAF_LIMIT = 0x100;
/** The reference turns a tree away at this place of a node. */
const NODE_LIMIT = 511;
const WORD_PLACES = 4;
const WORD_BITS = 32;
/** The deepest a tree of the reference may stand, which the reference does not bound of its own. */
const MAX_DEPTH = TREE_PLACES;

/** The stream of the reader: words of thirty two places read from the lowest place of a byte up. */
class WordBits {
	private at: number;
	private bits = 0;
	private count = 0;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	/** `HuffmanDecoder.GetBits`: the places of the run, from the lowest place of a word up. */
	getBits(count: number): number {
		let out = 0;
		for (let done = 0; done < count; done += 1) {
			if (0 === this.count) {
				if (this.at + WORD_PLACES > this.data.length) {
					throw new RangeError(
						"The stream of the run stands short of its places",
					);
				}
				this.bits = this.data.readUInt32LE(this.at);
				this.at += WORD_PLACES;
				this.count = WORD_BITS;
			}
			out = ((out << 1) | (this.bits & 1)) >>> 0;
			this.bits >>>= 1;
			this.count -= 1;
		}
		return out;
	}
}

/**
 * `HuffmanDecoder.Unpack`: the places of the run, of the tree the stream of it stands of. The tree is read
 * first, of a set bit for a place of two behind it and of a clear bit for the place of a byte behind it,
 * and the run then stands of a walk of that tree, of one place of the stream per place of the tree.
 */
export function decompressCmvsHuffman(
	input: Buffer,
	at: number,
	outputLength: number,
): Buffer {
	const reader = new WordBits(input, at);
	const lhs = new Uint16Array(TREE_PLACES);
	const rhs = new Uint16Array(TREE_PLACES);
	let token = LEAF_LIMIT;
	const createTree = (depth: number): number => {
		if (0 === reader.getBits(1)) return reader.getBits(8);
		const node = token;
		token += 1;
		if (node >= NODE_LIMIT) {
			throw new RangeError("The tree of the run stands past its places");
		}
		if (depth >= MAX_DEPTH) {
			throw new RangeError("The tree of the run stands deeper than its places");
		}
		lhs[node] = createTree(depth + 1);
		rhs[node] = createTree(depth + 1);
		return node;
	};
	const root = createTree(0);
	const out = Buffer.alloc(outputLength);
	for (let place = 0; place < outputLength; place += 1) {
		let symbol = root;
		while (symbol >= LEAF_LIMIT) {
			symbol =
				0 !== reader.getBits(1) ? (rhs[symbol] ?? 0) : (lhs[symbol] ?? 0);
		}
		out[place] = symbol & 0xff;
	}
	return out;
}
