import { crc32 } from "@garbro-mcp/codecs";
import { encodeCp932 } from "@garbro-mcp/core";

export const DEFAULT_KCAP_PASSPHRASE = "Selene.Default.Password";

const STATE_LENGTH = 624;
const STATE_M = 397;
const MATRIX_A = -1727483681;
const TEMPERING_MASK_B = -1658038656;
const TEMPERING_MASK_C = -272236544;

export class KcapKeyTableGenerator {
	readonly #state = new Int32Array(STATE_LENGTH);
	#position = STATE_LENGTH;

	constructor(seed = 0) {
		this.seed(seed);
	}

	seed(seed: number): void {
		this.#state[0] = seed | 0;
		for (let index = 1; index < STATE_LENGTH; index += 1) {
			const previous = this.#state[index - 1] ?? 0;
			this.#state[index] =
				(index + Math.imul(0x6c078965, previous ^ (previous >> 30))) | 0;
		}
		this.#position = STATE_LENGTH;
	}

	next(): number {
		if (this.#position >= STATE_LENGTH) this.#twist();
		let value = this.#state[this.#position++] ?? 0;
		value ^= value >> 11;
		value ^= (value << 7) & TEMPERING_MASK_B;
		value ^= (value << 15) & TEMPERING_MASK_C;
		value ^= value >> 18;
		return value | 0;
	}

	#twist(): void {
		let index = 0;
		for (; index < STATE_LENGTH - STATE_M; index += 1) {
			const current = this.#state[index] ?? 0;
			const mixed = current ^ (this.#state[index + 1] ?? 0);
			this.#state[index] =
				(this.#state[index + STATE_M] ?? 0) ^
				(((current ^ mixed) & 1) !== 0 ? MATRIX_A : 0) ^
				((current ^ (mixed & 0x7fffffff)) >> 1);
		}
		for (; index < STATE_LENGTH - 1; index += 1) {
			const current = this.#state[index] ?? 0;
			const mixed = current ^ (this.#state[index + 1] ?? 0);
			this.#state[index] =
				(this.#state[index + STATE_M - STATE_LENGTH] ?? 0) ^
				(((current ^ mixed) & 1) !== 0 ? MATRIX_A : 0) ^
				((current ^ (mixed & 0x7fffffff)) >> 1);
		}
		const last = this.#state[STATE_LENGTH - 1] ?? 0;
		const combined = last ^ (((this.#state[0] ?? 0) ^ last) & 0x7fffffff);
		this.#state[STATE_LENGTH - 1] =
			(this.#state[STATE_M - 1] ?? 0) ^
			(combined >> 1) ^
			((combined & 1) !== 0 ? MATRIX_A : 0);
		this.#position = 0;
	}
}

export function createKcapKeyTable(passphrase: string): Buffer {
	const effectivePassphrase =
		passphrase.length < 8 ? DEFAULT_KCAP_PASSPHRASE : passphrase;
	const seed = crc32(encodeCp932(effectivePassphrase));
	const generator = new KcapKeyTableGenerator(seed);
	const table = Buffer.alloc(0x10000);
	for (let index = 0; index < table.length; index += 1) {
		const character = effectivePassphrase.charCodeAt(
			index % effectivePassphrase.length,
		);
		table[index] = (character ^ (generator.next() >> 16)) & 0xff;
	}
	return table;
}
