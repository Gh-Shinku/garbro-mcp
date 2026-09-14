// The reference's cryptographic helper `Rc4Transform` (GARbro `GameRes/Cryptography/Rc4Transform.cs`) is not
// part of this repository's copy of GARbro, so the standard cipher is implemented here: the key scheduling of
// RFC 6229 and the pseudo random generation that follows it, with nothing dropped from the keystream. The port
// is checked against the published test vectors rather than against a reference implementation.

/** RC4, a byte oriented stream cipher whose transform is its own inverse. */
export class Rc4 {
	readonly #state: Uint8Array = new Uint8Array(256);
	#i = 0;
	#j = 0;

	constructor(key: Buffer | Uint8Array) {
		if (key.length === 0) {
			throw new RangeError("An RC4 key must not be empty");
		}
		const state = this.#state;
		for (let index = 0; index < state.length; index += 1) {
			state[index] = index;
		}
		let j = 0;
		for (let index = 0; index < state.length; index += 1) {
			j = (j + (state[index] ?? 0) + (key[index % key.length] ?? 0)) & 0xff;
			const swap = state[index] ?? 0;
			state[index] = state[j] ?? 0;
			state[j] = swap;
		}
	}

	/**
	 * XORs the next keystream bytes into `data`, in place, and returns it. Applying it twice with the same key
	 * restores the original bytes, and splitting a buffer across calls gives the same result as one call.
	 */
	transform(data: Buffer): Buffer {
		const state = this.#state;
		let i = this.#i;
		let j = this.#j;
		for (let index = 0; index < data.length; index += 1) {
			i = (i + 1) & 0xff;
			j = (j + (state[i] ?? 0)) & 0xff;
			const swap = state[i] ?? 0;
			state[i] = state[j] ?? 0;
			state[j] = swap;
			const keyByte = state[((state[i] ?? 0) + (state[j] ?? 0)) & 0xff] ?? 0;
			data[index] = (data[index] ?? 0) ^ keyByte;
		}
		this.#i = i;
		this.#j = j;
		return data;
	}

	/** The same as {@link transform}, for a buffer that is not to be changed. */
	xor(data: Buffer): Buffer {
		return this.transform(Buffer.from(data));
	}
}
