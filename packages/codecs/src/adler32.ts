const MOD_ADLER = 65_521;
const NMAX = 5_552;

export class Adler32 {
	#a = 1;
	#b = 0;

	update(input: Uint8Array): this {
		let offset = 0;
		while (offset < input.length) {
			const end = Math.min(offset + NMAX, input.length);
			for (; offset < end; offset += 1) {
				this.#a += input[offset] ?? 0;
				this.#b += this.#a;
			}
			this.#a %= MOD_ADLER;
			this.#b %= MOD_ADLER;
		}
		return this;
	}

	get value(): number {
		return ((this.#b << 16) | this.#a) >>> 0;
	}

	get hex(): string {
		return this.value.toString(16).padStart(8, "0");
	}
}

export function adler32(input: Uint8Array): number {
	return new Adler32().update(input).value;
}
