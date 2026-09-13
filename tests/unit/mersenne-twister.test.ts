import { MersenneTwister } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const MATRIX_A = 0x9908b0df;

/**
 * A second transcription of the reference, written in the three phases of the C# twist rather than as one
 * loop with wrapping indices, so that an indexing mistake in either one shows up.
 */
class ReferenceTwister {
	readonly mt: number[] = new Array(624).fill(0);
	position = 624;

	constructor(seed: number) {
		let value = seed >>> 0;
		for (let index = 0; index < 624; index += 1) {
			const upper = value & 0xffff0000;
			value = (69069 * value + 1) >>> 0;
			this.mt[index] = (upper | ((value & 0xffff0000) >>> 16)) >>> 0;
			value = (69069 * value + 1) >>> 0;
		}
	}

	rand(): number {
		if (this.position >= 624) this.twist();
		let value = this.mt[this.position] ?? 0;
		this.position += 1;
		value ^= value >>> 11;
		value ^= (value << 7) & 0x9d2c5680;
		value ^= (value << 15) & 0xefc60000;
		value ^= value >>> 18;
		return value >>> 0;
	}

	twist(): void {
		const magic = (value: number): number => ((value & 1) !== 0 ? MATRIX_A : 0);
		let index = 0;
		for (; index < 624 - 397; index += 1) {
			const mixed =
				((this.mt[index] ?? 0) & 0x80000000) |
				((this.mt[index + 1] ?? 0) & 0x7fffffff);
			this.mt[index] =
				((this.mt[index + 397] ?? 0) ^ (mixed >>> 1) ^ magic(mixed)) >>> 0;
		}
		for (; index < 623; index += 1) {
			const mixed =
				((this.mt[index] ?? 0) & 0x80000000) |
				((this.mt[index + 1] ?? 0) & 0x7fffffff);
			this.mt[index] =
				((this.mt[index + 397 - 624] ?? 0) ^ (mixed >>> 1) ^ magic(mixed)) >>>
				0;
		}
		const mixed =
			((this.mt[623] ?? 0) & 0x80000000) | ((this.mt[0] ?? 0) & 0x7fffffff);
		this.mt[623] = ((this.mt[396] ?? 0) ^ (mixed >>> 1) ^ magic(mixed)) >>> 0;
		this.position = 0;
	}
}

describe("mersenne twister", () => {
	it("matches the reference seeding and tempering", () => {
		for (const seed of [0, 1, 4357, 0x12345678, 0xffffffff]) {
			const actual = new MersenneTwister(seed);
			const expected = new ReferenceTwister(seed);
			for (let draw = 0; draw < 2000; draw += 1)
				expect(actual.rand()).toBe(expected.rand());
		}
	});

	it("keeps the values the reference produces", () => {
		const golden: Record<number, number[]> = {
			0: [0x1c75c7c9, 0xda9649c5, 0x84e243e5, 0xa75c2a2f, 0xaa8796b4],
			4357: [0xaae64ac3, 0x5e7c47da, 0xb98e8121, 0xb010f327, 0x92da86b4],
			305419896: [0x7899b975, 0xbd008e30, 0x02285c9a, 0xbf44420e, 0x2b02dff2],
		};
		for (const [seed, values] of Object.entries(golden)) {
			const twister = new MersenneTwister(Number(seed));
			expect(values.map(() => twister.rand())).toEqual(values);
		}
	});

	it("returns unsigned values and re-seeds deterministically", () => {
		const twister = new MersenneTwister(1234);
		for (let draw = 0; draw < 100; draw += 1) {
			const value = twister.rand();
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(0x100000000);
		}
		const first = new MersenneTwister(7);
		const second = new MersenneTwister(9);
		second.seed(7);
		for (let draw = 0; draw < 10; draw += 1)
			expect(second.rand()).toBe(first.rand());
	});

	it("keeps the low five bits of the reference stream", () => {
		const twister = new MersenneTwister(4357);
		const bits = Array.from({ length: 32 }, () => twister.rand() & 0x1f);
		expect(bits).toEqual([
			3, 26, 1, 7, 20, 4, 19, 17, 20, 11, 15, 23, 25, 12, 20, 25, 24, 24, 31, 0,
			12, 14, 22, 31, 14, 12, 2, 8, 23, 21, 13, 21,
		]);
	});
});
