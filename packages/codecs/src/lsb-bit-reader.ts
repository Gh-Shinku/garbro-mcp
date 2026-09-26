/**
 * Least-significant-bit-first bit reader, the ordering GARbro's `LsbBitStream` uses: the bits of a stream are
 * taken from the least significant place of every byte first, and a word that reaches into the byte behind it
 * takes the low places of that byte.
 *
 * `readBits` reports a truncated stream as an error, while `tryReadBits` returns `-1` so walks that treat the
 * end of the stream as a signal, rather than as corruption, can detect it.
 */
export class LsbBitReader {
	readonly #input: Buffer;
	#byteOffset: number;
	#bitOffset = 0;

	constructor(input: Uint8Array, byteOffset = 0) {
		this.#input = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
		this.#byteOffset = byteOffset;
	}

	get byteOffset(): number {
		return this.#byteOffset;
	}

	readBits(count: number): number {
		const value = this.tryReadBits(count);
		if (value === -1) throw new RangeError("Bit stream ended unexpectedly");
		return value;
	}

	/** Returns `-1` when the stream ends before `count` bits could be read. */
	tryReadBits(count: number): number {
		let value = 0;
		let shift = 0;
		while (count > 0) {
			if (this.#byteOffset >= this.#input.length) return -1;
			const byte = this.#input[this.#byteOffset] ?? 0;
			const take = Math.min(count, 8 - this.#bitOffset);
			value =
				(value | (((byte >> this.#bitOffset) & ((1 << take) - 1)) << shift)) >>>
				0;
			this.#bitOffset += take;
			if (this.#bitOffset === 8) {
				this.#bitOffset = 0;
				this.#byteOffset += 1;
			}
			shift += take;
			count -= take;
		}
		return value;
	}
}
