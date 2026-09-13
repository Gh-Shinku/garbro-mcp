// Codec reference: GARbro ArcFormats/MersenneTwister.cs (`GameRes.Cryptography.MersenneTwister`).
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

const STATE_LENGTH = 624;
const STATE_M = 397;
const MATRIX_A = 0x9908b0df;
const SIGN_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
const TEMPERING_MASK_B = 0x9d2c5680;
const TEMPERING_MASK_C = 0xefc60000;
/** The seed multiply used by the generator's own seeding routine. */
const SEED_MULTIPLIER = 69069;

/**
 * GARbro's Mersenne twister, seeded by the linear congruential routine of `SRand` rather than the classic
 * `init_genrand`, and with the standard tempering of `Rand`.
 */
export class MersenneTwister {
	readonly #state = new Uint32Array(STATE_LENGTH);
	#position = STATE_LENGTH;

	constructor(seed: number) {
		this.seed(seed);
	}

	/** `MersenneTwister.SRand`: every state word mixes the seed twice through the congruential step. */
	seed(seed: number): void {
		let value = seed >>> 0;
		for (let index = 0; index < this.#state.length; index += 1) {
			const upper = value & 0xffff0000;
			value = (SEED_MULTIPLIER * value + 1) >>> 0;
			this.#state[index] = (upper | ((value & 0xffff0000) >>> 16)) >>> 0;
			value = (SEED_MULTIPLIER * value + 1) >>> 0;
		}
		// The reference leaves the position at the end of the state, so the first draw twists it.
		this.#position = STATE_LENGTH;
	}

	/** `MersenneTwister.Rand`: one tempered 32 bit value, twisting the state when it runs out. */
	rand(): number {
		if (this.#position >= STATE_LENGTH) this.#twist();
		let value = this.#state[this.#position] ?? 0;
		this.#position += 1;
		value ^= value >>> 11;
		value ^= (value << 7) & TEMPERING_MASK_B;
		value ^= (value << 15) & TEMPERING_MASK_C;
		value ^= value >>> 18;
		return value >>> 0;
	}

	#twist(): void {
		const state = this.#state;
		for (let index = 0; index < STATE_LENGTH; index += 1) {
			const next = (index + 1) % STATE_LENGTH;
			const mix = (state[index] ?? 0) & SIGN_MASK;
			const value = (mix | ((state[next] ?? 0) & LOWER_MASK)) >>> 0;
			const offset = (index + STATE_M) % STATE_LENGTH;
			state[index] =
				((state[offset] ?? 0) ^
					(value >>> 1) ^
					((value & 1) !== 0 ? MATRIX_A : 0)) >>>
				0;
		}
		this.#position = 0;
	}
}
