/** `HuffmanTree.MaxFreq`: every place of the walk that stands behind the places that name how many places of
 * the walk stand for them stands as this many of them, so that no place of the walk is read twice. */
const MAXIMUM_FREQUENCY = 2100000000;
const CHILD_STRIDE = 0x200;
const BIT_PLACES = 9;

export class JbpHuffmanTree {
	readonly #base: Buffer;
	readonly #nodes: Int32Array;
	readonly root: number;

	constructor(base: Uint8Array, frequencies: readonly number[]) {
		this.#base = Buffer.from(base);
		this.#nodes = new Int32Array(2 * CHILD_STRIDE);
		const leafCount = this.#base.length;
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

	read(bits: JbpBitStream): number {
		let node = this.root;
		while (node >= this.leafCount) {
			node = this.#nodes[node + (bits.getNextBit() << BIT_PLACES)] ?? 0;
		}
		return node;
	}

	place(index: number): number {
		return this.#base[index] ?? 0;
	}
}

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

	get remaining(): number {
		return this.#end - this.#at + (this.#cached >> 3);
	}

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

export function reverseByteBits(value: number): number {
	let x = value & 0xff;
	x = ((x & 0xaa) >> 1) | ((x & 0x55) << 1);
	x = ((x & 0xcc) >> 2) | ((x & 0x33) << 2);
	return ((x >> 4) | (x << 4)) & 0xff;
}
