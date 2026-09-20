const N = 156;
const N32 = N * 4;
const POS1 = 122;
const SL1 = 18;
const SL2 = 1;
const SR1 = 11;
const SR2 = 1;
const MSK = [0xdfffffef, 0xddfecb7f, 0xbffaffff, 0xbffffff6];
const PARITY = [0x00000001, 0x00000000, 0x00000000, 0x13c9e684];
const INIT_MULTIPLIER = 1812433253;
const WORD_BITS = 32;
const SHIFT_BITS = 8;
const CHANNELS = 4;

export class FastMersenneTwister {
	readonly #state = new Uint32Array(N32);
	#index = 0;

	constructor(seed: number) {
		let previous = seed >>> 0;
		this.#state[0] = previous;
		for (let i = 1; i < N32; i += 1) {
			previous =
				(Math.imul(INIT_MULTIPLIER, (previous ^ (previous >>> 30)) >>> 0) +
					i) >>>
				0;
			this.#state[i] = previous;
		}
		this.#index = N32;
		this.certifyPeriod();
	}

	private certifyPeriod(): void {
		let inner = 0;
		for (let i = 0; i < CHANNELS; i += 1)
			inner ^= (this.#state[i] ?? 0) & (PARITY[i] ?? 0);
		for (let shift = 16; shift > 0; shift >>= 1) inner ^= inner >>> shift;
		if ((inner & 1) === 1) return;
		for (let i = 0; i < CHANNELS; i += 1) {
			let work = 1;
			for (let bit = 0; bit < WORD_BITS; bit += 1) {
				if ((work & (PARITY[i] ?? 0)) !== 0) {
					this.#state[i] = ((this.#state[i] ?? 0) ^ work) >>> 0;
					return;
				}
				work = (work << 1) >>> 0;
			}
		}
	}

	#shift(result: Uint32Array, at: number, shift: number, left: boolean): void {
		const high =
			(BigInt(this.#state[at * CHANNELS + 3] ?? 0) << 32n) |
			BigInt(this.#state[at * CHANNELS + 2] ?? 0);
		const low =
			(BigInt(this.#state[at * CHANNELS + 1] ?? 0) << 32n) |
			BigInt(this.#state[at * CHANNELS] ?? 0);
		const bits = BigInt(shift * SHIFT_BITS);
		const highOut = left ? high << bits : high >> bits;
		const lowOut = left ? low << bits : low >> bits;
		const carried = left ? low >> (64n - bits) : high << (64n - bits);
		const wrappedHigh = BigInt.asUintN(64, left ? highOut | carried : highOut);
		const wrappedLow = BigInt.asUintN(
			64,
			left ? lowOut : lowOut | BigInt.asUintN(64, carried),
		);
		result[0] = Number(BigInt.asUintN(32, wrappedLow));
		result[1] = Number(BigInt.asUintN(32, wrappedLow >> 32n));
		result[2] = Number(BigInt.asUintN(32, wrappedHigh));
		result[3] = Number(BigInt.asUintN(32, wrappedHigh >> 32n));
	}

	#recursion(r: number, a: number, b: number, c: number, d: number): void {
		const x = new Uint32Array(CHANNELS);
		const y = new Uint32Array(CHANNELS);
		this.#shift(x, a, SL2, true);
		this.#shift(y, c, SR2, false);
		for (let i = 0; i < CHANNELS; i += 1) {
			const next =
				(this.#state[a * CHANNELS + i] ?? 0) ^
				(x[i] ?? 0) ^
				(((this.#state[b * CHANNELS + i] ?? 0) >>> SR1) & (MSK[i] ?? 0)) ^
				(y[i] ?? 0) ^
				(((this.#state[d * CHANNELS + i] ?? 0) << SL1) >>> 0);
			this.#state[r * CHANNELS + i] = next >>> 0;
		}
	}

	nextUint32(): number {
		if (this.#index >= N32) {
			let r1 = N - 2;
			let r2 = N - 1;
			let i = 0;
			for (; i < N - POS1; i += 1) {
				this.#recursion(i, i, i + POS1, r1, r2);
				r1 = r2;
				r2 = i;
			}
			for (; i < N; i += 1) {
				this.#recursion(i, i, i + POS1 - N, r1, r2);
				r1 = r2;
				r2 = i;
			}
			this.#index = 0;
		}
		const value = this.#state[this.#index] ?? 0;
		this.#index += 1;
		return value;
	}
}
