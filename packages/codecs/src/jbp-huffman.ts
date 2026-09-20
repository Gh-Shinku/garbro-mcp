// Format reference: GARbro "ArcFormats/Cmvs/ImagePB3.cs", classes `JBitStream` and `HuffmanTree`, which the
// walk of the places of a picture of the Purple engine stands on. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** `HuffmanTree.MaxFreq`: every place of the walk that stands behind the places that name how many places of
 * the walk stand for them stands as this many of them, so that no place of the walk is read twice. */
const MAXIMUM_FREQUENCY = 2100000000;
/** How many places the places of a step of a walk of this kind stand in, and where the two places a step
 * stands for stand in the places of the walk. */
const CHILD_STRIDE = 0x200;
const BIT_PLACES = 9;

/**
 * `HuffmanTree`: the words that name the places of a walk of this kind stand as the places of the walk itself
 * rather than as the places of a picture, and every step of the walk stands as two places of the walk: the
 * walk stands the two places that stand for the fewest places of the walk beside each other until one place of
 * the walk stands for them all, which stands as the first place of the walk.
 */
export class JbpHuffmanTree {
	readonly #base: Buffer;
	readonly #nodes: Int32Array;
	readonly root: number;

	constructor(base: Uint8Array, frequencies: readonly number[]) {
		this.#base = Buffer.from(base);
		this.#nodes = new Int32Array(2 * CHILD_STRIDE);
		const leafCount = this.#base.length;
		// The walk stands the places of every place of the walk behind the places that name how many places of
		// the walk stand for them, so the places of those places of the walk need places of their own: the
		// reference reads them from the same words it was given, which stand for twice as many places of the
		// walk as the walk holds words for. Reading them from an array of the words alone stands every place of
		// the walk behind the words as no places at all, so the walk never stands the two places that stand for
		// the fewest places of the walk and never stands at all.
		const capacity = Math.max(2 * leafCount, leafCount + 1);
		const freq = new Int32Array(capacity);
		for (let at = 0; at < leafCount && at < frequencies.length; at += 1) {
			freq[at] = frequencies[at] ?? 0;
		}
		let depth = leafCount;
		for (;;) {
			let left = -1;
			let minimum = MAXIMUM_FREQUENCY - 1;
			for (let at = 0; at < depth; at += 1) {
				if ((freq[at] ?? 0) < minimum) {
					minimum = freq[at] ?? 0;
					left = at;
				}
			}
			let right = -1;
			minimum = MAXIMUM_FREQUENCY - 1;
			for (let at = 0; at < depth; at += 1) {
				if (at !== left && (freq[at] ?? 0) < minimum) {
					minimum = freq[at] ?? 0;
					right = at;
				}
			}
			if (left < 0 || right < 0) break;
			// The words stand for as many places of the walk as the walk holds words for and the places of the
			// walk that stand for them; a walk whose words name no places of the walk at all stands as no place
			// of the walk rather than as places that stand past the words.
			if (depth + 1 >= capacity) break;
			this.#nodes[depth] = left;
			this.#nodes[depth + CHILD_STRIDE] = right;
			freq[depth] = (freq[left] ?? 0) + (freq[right] ?? 0);
			freq[left] = MAXIMUM_FREQUENCY;
			freq[right] = MAXIMUM_FREQUENCY;
			depth += 1;
		}
		this.root = depth - 1;
	}

	get leafCount(): number {
		return this.#base.length;
	}

	/** `HuffmanTree.Read`: every step of the walk of the places of a picture stands as one place of the file,
	 * which names whether the place of the walk that stands next stands before or behind the place it stands
	 * at. */
	read(bits: JbpBitStream): number {
		let node = this.root;
		while (node >= this.leafCount) {
			node = this.#nodes[node + (bits.getNextBit() << BIT_PLACES)] ?? 0;
		}
		return node;
	}

	/** The words a place of the walk stands for, which the walk of the places of a picture reads for itself. */
	place(index: number): number {
		return this.#base[index] ?? 0;
	}
}

/**
 * `JBitStream`: the places of a walk of this kind stand as the places of a file, every one of them standing
 * the other way round, and every step of the walk stands as the places that stand behind those before it.
 */
export class JbpBitStream {
	readonly #input: Buffer;
	readonly #end: number;
	#at: number;
	#bits = 0;
	#cached = 0;

	constructor(input: Uint8Array, offset: number, length: number) {
		this.#input = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
		this.#at = offset;
		this.#end = offset + length;
	}

	/** How many places of the file the walk has not read yet. */
	get remaining(): number {
		return this.#end - this.#at + (this.#cached >> 3);
	}

	/** The reference stands the places of a step of a walk as the places of the file that stand behind them,
	 * and a step that stands past the places of the file stands as no step at all. */
	getBits(count: number): number {
		while (this.#cached < count) {
			if (this.#at >= this.#end) {
				throw new RangeError("Purple walk stands short of its places");
			}
			this.#bits =
				(this.#bits << 8) | reverseByteBits(this.#input[this.#at] ?? 0);
			this.#at += 1;
			this.#cached += 8;
		}
		const mask = (1 << count) - 1;
		this.#cached -= count;
		return (this.#bits >> this.#cached) & mask;
	}

	getNextBit(): number {
		return this.getBits(1);
	}
}

/** `JBitStream.ReverseByteBits`: the places of a byte of a file of this kind stand the other way round. */
export function reverseByteBits(value: number): number {
	let x = value & 0xff;
	x = ((x & 0xaa) >> 1) | ((x & 0x55) << 1);
	x = ((x & 0xcc) >> 2) | ((x & 0x33) << 2);
	return ((x >> 4) | (x << 4)) & 0xff;
}
