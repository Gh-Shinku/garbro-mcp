/**
 * Most-significant-bit-first bit reader, the ordering GARbro's `MsbBitStream` uses.
 *
 * `readBits` reports a truncated stream as an error, while `tryReadBits` returns `-1` so codecs that
 * treat the end of the stream as a signal, rather than as corruption, can detect it.
 */
export class MsbBitReader {
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
		for (let index = 0; index < count; index += 1) {
			if (this.#byteOffset >= this.#input.length) return -1;
			const byte = this.#input[this.#byteOffset] ?? 0;
			value = value * 2 + ((byte >> (7 - this.#bitOffset)) & 1);
			this.#bitOffset += 1;
			if (this.#bitOffset === 8) {
				this.#bitOffset = 0;
				this.#byteOffset += 1;
			}
		}
		return value;
	}
}
