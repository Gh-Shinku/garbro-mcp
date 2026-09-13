// Codec reference: GARbro "ArcFormats/Slg/ImageTIG.cs", the file's own `RandomGenerator`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/**
 * The linear congruential generator of the Microsoft C runtime: the state is multiplied by `0x343FD` and
 * incremented by `0x269EC3` with thirty two bit wrapping, and each draw hands back the **high** word of the new
 * state. Two seeds are worth remembering: zero draws thirty eight first and one draws forty one.
 *
 * The high word is handed over whole, where the C runtime's own `rand()` masks it with `0x7FFF`; a draw whose
 * fifteenth bit is set is therefore twice the runtime's value minus `0x8000`. The low byte that the SLG image
 * formats take is unaffected either way.
 */
export class MsvcRandom {
	#state: number;

	constructor(seed: number) {
		this.#state = seed >>> 0;
	}

	/**
	 * The current state rather than the seed it started from. The reference's own `Seed` property is this same
	 * value, which is why a caller that seeds, draws and then reads the seed is handed a **moved** state: the SLG
	 * image formats rely on that when they build a key table after scrambling a header.
	 */
	get state(): number {
		return this.#state;
	}

	/** One draw in `0 .. 0xFFFF`, the high word of the advanced state. */
	next(): number {
		this.#state = (Math.imul(this.#state, 0x343fd) + 0x269ec3) >>> 0;
		return this.#state >>> 16;
	}
}
