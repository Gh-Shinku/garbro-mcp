const WORDS = 0x100;
const SEED_MULTIPLIER = 0x9e370001;
const FILL_MULTIPLIER = 0x61c88647;
const GOLDEN = 0x9e3779b97f4a7c13n;

function wrap(value: bigint): bigint {
	return BigInt.asUintN(64, value);
}

function shiftRight(value: bigint, count: bigint): bigint {
	return BigInt.asUintN(64, value) >> count;
}

export class Isaac64 {
	readonly #entropy: bigint[] = new Array<bigint>(WORDS).fill(0n);
	readonly #state: bigint[] = new Array<bigint>(WORDS).fill(0n);
	#count = 0;
	#aa = 0n;
	#bb = 0n;
	#cc = 0n;
	#a = 0n;
	#b = 0n;
	#c = 0n;
	#d = 0n;
	#e = 0n;
	#f = 0n;
	#g = 0n;
	#h = 0n;

	constructor(seed: number) {
		const words = new Uint32Array(2 * WORDS);
		words[0] = (seed ^ SEED_MULTIPLIER) >>> 0;
		for (let i = 1; i < 2 * WORDS; i += 1) {
			const previous = words[i - 1] ?? 0;
			words[i] =
				(i -
					Math.imul(FILL_MULTIPLIER, (previous ^ (previous >>> 30)) >>> 0)) >>>
				0;
		}
		for (let i = 0; i < WORDS; i += 1)
			this.#entropy[i] =
				(BigInt(words[2 * i + 1] ?? 0) << 32n) | BigInt(words[2 * i] ?? 0);
		this.init();
	}

	#mix(): void {
		this.#a = wrap(this.#a - this.#e);
		this.#f ^= shiftRight(this.#h, 9n);
		this.#h = wrap(this.#h + this.#a);
		this.#b = wrap(this.#b - this.#f);
		this.#g ^= wrap(this.#a << 9n);
		this.#a = wrap(this.#a + this.#b);
		this.#c = wrap(this.#c - this.#g);
		this.#h ^= shiftRight(this.#b, 23n);
		this.#b = wrap(this.#b + this.#c);
		this.#d = wrap(this.#d - this.#h);
		this.#a ^= wrap(this.#c << 15n);
		this.#c = wrap(this.#c + this.#d);
		this.#e = wrap(this.#e - this.#a);
		this.#b ^= shiftRight(this.#d, 14n);
		this.#d = wrap(this.#d + this.#e);
		this.#f = wrap(this.#f - this.#b);
		this.#c ^= wrap(this.#e << 20n);
		this.#e = wrap(this.#e + this.#f);
		this.#g = wrap(this.#g - this.#c);
		this.#d ^= shiftRight(this.#f, 17n);
		this.#f = wrap(this.#f + this.#g);
		this.#h = wrap(this.#h - this.#d);
		this.#e ^= wrap(this.#g << 14n);
		this.#g = wrap(this.#g + this.#h);
	}

	private init(): void {
		this.#aa = 0n;
		this.#bb = 0n;
		this.#cc = 0n;
		this.#a = GOLDEN;
		this.#b = GOLDEN;
		this.#c = GOLDEN;
		this.#d = GOLDEN;
		this.#e = GOLDEN;
		this.#f = GOLDEN;
		this.#g = GOLDEN;
		this.#h = GOLDEN;
		for (let i = 0; i < 4; i += 1) this.#mix();
		for (let i = 0; i < WORDS; i += 8) {
			this.#addEntropy(i);
			this.#mix();
			this.#store(i);
		}
		for (let i = 0; i < WORDS; i += 8) {
			this.#addState(i);
			this.#mix();
			this.#store(i);
		}
		this.#shuffle();
		this.#count = WORDS;
	}

	#addEntropy(at: number): void {
		this.#a = wrap(this.#a + (this.#entropy[at] ?? 0n));
		this.#b = wrap(this.#b + (this.#entropy[at + 1] ?? 0n));
		this.#c = wrap(this.#c + (this.#entropy[at + 2] ?? 0n));
		this.#d = wrap(this.#d + (this.#entropy[at + 3] ?? 0n));
		this.#e = wrap(this.#e + (this.#entropy[at + 4] ?? 0n));
		this.#f = wrap(this.#f + (this.#entropy[at + 5] ?? 0n));
		this.#g = wrap(this.#g + (this.#entropy[at + 6] ?? 0n));
		this.#h = wrap(this.#h + (this.#entropy[at + 7] ?? 0n));
	}

	#addState(at: number): void {
		this.#a = wrap(this.#a + (this.#state[at] ?? 0n));
		this.#b = wrap(this.#b + (this.#state[at + 1] ?? 0n));
		this.#c = wrap(this.#c + (this.#state[at + 2] ?? 0n));
		this.#d = wrap(this.#d + (this.#state[at + 3] ?? 0n));
		this.#e = wrap(this.#e + (this.#state[at + 4] ?? 0n));
		this.#f = wrap(this.#f + (this.#state[at + 5] ?? 0n));
		this.#g = wrap(this.#g + (this.#state[at + 6] ?? 0n));
		this.#h = wrap(this.#h + (this.#state[at + 7] ?? 0n));
	}

	#store(at: number): void {
		this.#state[at] = this.#a;
		this.#state[at + 1] = this.#b;
		this.#state[at + 2] = this.#c;
		this.#state[at + 3] = this.#d;
		this.#state[at + 4] = this.#e;
		this.#state[at + 5] = this.#f;
		this.#state[at + 6] = this.#g;
		this.#state[at + 7] = this.#h;
	}

	#rngStep(
		mix: bigint,
		m: { at: number },
		m2: { at: number },
		r: { at: number },
	): void {
		const x = this.#state[m.at] ?? 0n;
		this.#aa = wrap(mix + (this.#state[m2.at] ?? 0n));
		m2.at += 1;
		const y = wrap(
			(this.#state[Number((x >> 3n) & 0xffn)] ?? 0n) + this.#aa + this.#bb,
		);
		this.#state[m.at] = y;
		m.at += 1;
		this.#bb = wrap((this.#state[Number((y >> 11n) & 0xffn)] ?? 0n) + x);
		this.#entropy[r.at] = this.#bb;
		r.at += 1;
	}

	#shuffle(): void {
		const m1 = { at: 0 };
		const r = { at: 0 };
		this.#bb = wrap(this.#bb + wrap(++this.#cc));
		const half = 0x80;
		const m2 = { at: half };
		while (m1.at < half) {
			this.#rngStep(wrap(~(this.#aa ^ wrap(this.#aa << 21n))), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ shiftRight(this.#aa, 5n)), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ wrap(this.#aa << 12n)), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ shiftRight(this.#aa, 33n)), m1, m2, r);
		}
		m2.at = 0;
		while (m2.at < half) {
			this.#rngStep(wrap(~(this.#aa ^ wrap(this.#aa << 21n))), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ shiftRight(this.#aa, 5n)), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ wrap(this.#aa << 12n)), m1, m2, r);
			this.#rngStep(wrap(this.#aa ^ shiftRight(this.#aa, 33n)), m1, m2, r);
		}
	}

	nextUint32(): number {
		const current = this.#count;
		this.#count = current - 1;
		if (current === 0) {
			this.#shuffle();
			this.#count = 0xff;
		}
		const value = this.#entropy[this.#count] ?? 0n;
		return Number(BigInt.asUintN(32, value) ^ BigInt.asUintN(32, value >> 32n));
	}
}
