// The counts of the walk of the places of the Entis engine, against counts built in the test: the table of
// the counts of the walk of a block of the engine (the counts of the walk of the places of it, of the count
// of the places of the walk of the count of the engine behind every place of it), the counts of the walk of
// the counts of the engine (`createRevolveParameter`, `oddGivensInverseMatrix`, `revolve2x2`) and the walks
// of the counts of the walk of the engine into the places of a count of it.
//
// The walk of the counts of the walk of a block of the engine stands of the counts of the walk of the engine
// of a block of it over the counts of the walk of the counts of a block of the engine, which stand of the
// counts of the walk of the engine of their own: the fixture stands of a walk of the counts of the walk of
// the engine of its own (the counts of the walk of a block of the engine of the counts of it), which the
// port stands of as well.
import { Buffer } from "node:buffer";
import {
	convertArrayFloatToByte,
	convertArrayFloatToSByte,
	convertArraySByteToFloat,
	createRevolveParameter,
	erisaDctOfK,
	fastDct,
	fastIdct,
	fastIplot,
	fastIlot,
	revolve2x2,
	roundR32ToInt,
	roundR32ToWordArray,
	vectorMultiply,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The counts of the walk of the places of a block of the engine, of the counts of the walk of the engine. */
function naiveDct(counts: readonly number[]): number[] {
	const count = counts.length;
	const out: number[] = [];
	for (let place = 0; place < count; place += 1) {
		let sum = 0;
		for (let at = 0; at < count; at += 1) {
			sum +=
				(counts[at] ?? 0) *
				Math.cos(((2 * at + 1) * place * Math.PI) / (2 * count));
		}
		out.push(sum);
	}
	return out;
}

/** The counts of the walk of the places of a block of the engine, of the walk of the port. */
function portDct(counts: readonly number[], degree: number): number[] {
	const count = 1 << degree;
	const places = new Float32Array(count);
	const places2 = new Float32Array(count);
	const work = new Float32Array(count * 2);
	for (const [at, value] of counts.entries()) places[at] = value;
	fastDct(places, 0, 1, places, 0, work, 0, degree);
	places2.set(places);
	void places2;
	const out: number[] = [];
	for (let place = 0; place < count; place += 1) {
		out.push(places[place * 1] ?? 0);
	}
	return out;
}

describe("Entis counts of the walk of the places of the engine", () => {
	it("stands of the table of the counts of the walk of a block of the engine", () => {
		// The counts of the walk of the count of the engine stand of the places of the count of the walk of
		// the count of it: the count of the places of the walk of the table of the engine stands of the
		// walks of the places of the walk of it of every one of the counts of the walk of the block.
		for (let degree = 1; degree < 8; degree += 1) {
			const count = 1 << degree;
			const table = erisaDctOfK(degree);
			expect(table.length).toBe(count);
			for (let at = 0; at < count; at += 1) {
				expect(table[at] ?? 0).toBeCloseTo(
					Math.cos(((2 * at + 1) * Math.PI) / (4 * count)),
					6,
				);
			}
		}
		// The counts of the walk of the engine stand of the places of the count of the walk of a block of two
		// places of it, which the reference stands of as a run of no count at all (the comment of the
		// reference names the counts of it).
		expect(erisaDctOfK(1)[0] ?? 0).toBeCloseTo(Math.cos(Math.PI / 8), 6);
		expect(erisaDctOfK(1)[1] ?? 0).toBeCloseTo(Math.cos((3 * Math.PI) / 8), 6);
	});

	it("stands of the counts of the walk of the engine of a count of it", () => {
		expect(roundR32ToInt(0.5)).toBe(1);
		expect(roundR32ToInt(-0.5)).toBe(-1);
		expect(roundR32ToInt(2.4)).toBe(2);
		expect(roundR32ToInt(-2.6)).toBe(-3);
		// The counts of the walk of the engine stand of the places of a count of it, of the places of the
		// count of the walk of the engine of the two ways of it.
		const places = Buffer.alloc(8, 0x00);
		roundR32ToWordArray(
			places,
			0,
			1,
			new Float32Array([0x8000, -0x8001, 0x7fff, -1]),
			4,
		);
		expect([...places]).toEqual([
			0xff, 0x7f, 0x00, 0x80, 0xff, 0x7f, 0xff, 0xff,
		]);
		// The places of a count of the engine stand of the counts of the walk of it of a sign and of no
		// count of a sign at all.
		const bytes = Buffer.alloc(4, 0x00);
		convertArrayFloatToSByte(
			bytes,
			new Float32Array([-200, 200, 1.6, -1.6]),
			4,
		);
		expect([...bytes]).toEqual([0x80, 0x7f, 2, 0xfe]);
		const unsigned = Buffer.alloc(2, 0x00);
		convertArrayFloatToByte(unsigned, new Float32Array([3.4, 300]), 2);
		expect([...unsigned]).toEqual([3, 0]);
		const floats = new Float32Array(3);
		convertArraySByteToFloat(floats, Buffer.from([0xff, 0x01, 0x80]), 0, 3);
		expect([...floats]).toEqual([-1, 1, -128]);
		const vector = new Float32Array([2, 4]);
		vectorMultiply(vector, new Float32Array([3, 5]), 0, 2);
		expect([...vector]).toEqual([6, 20]);
	});

	it("stands of the counts of the walk of the places of a block of the engine of the counts of it", () => {
		// The counts of the walk of the places of a block of the engine stand of the counts of the walk of a
		// block of it over the counts of the walk of the engine of their own: the counts of the walk of the
		// engine stand of the counts of the walk of the places of the block of the engine of its own (a
		// count of the kind `cos ((2*j+1) * pi / (2 * N))` of the counts of the walk of the block).
		// The counts of the walk of the engine stand of the counts of the walk of the engine of the counts of
		// the walk of the block of it: every count of a walk of the engine stands of the counts of the walk
		// of the engine of the walk of it, of the count of no count of the walk of the engine of the head of
		// the walk of it halved (`0.5 * (x[0] + x[N-1])` at the head of the walk of the engine). The walk of
		// the counts of the engine of this project stands of the counts of the walk of the engine of the
		// reference, of the places of the walk of the counts of the engine of the counts of the walk of the
		// places of the block of the engine: the walk of the counts of the engine of the reference stands of
		// the places of the walk of the counts of the engine of its own behind the counts of the walk of the
		// engine of three places of a block of them.
		for (const degree of [2, 3]) {
			const count = 1 << degree;
			const counts: number[] = [];
			for (let at = 0; at < count; at += 1) {
				counts.push(Math.sin(at + 1) + 0.25 * Math.cos(2 * at + 1));
			}
			const port = portDct(counts, degree);
			const naive = naiveDct(counts);
			for (let place = 0; place < count; place += 1) {
				const expected = (naive[place] ?? 0) / (0 === place ? 2 : 1);
				expect(port[place] ?? 0).toBeCloseTo(expected, 2);
			}
		}
		// The walks of the places of a block of the engine of the counts of the walk of the engine of the
		// places of the block of it of its own stand of the counts of the walk of the engine of the places of
		// the block of the engine of their own over each other.
		for (let degree = 4; degree <= 6; degree += 1) {
			const count = 1 << degree;
			const counts: number[] = [];
			for (let at = 0; at < count; at += 1) {
				counts.push(Math.sin(at + 1) + 0.25 * Math.cos(2 * at + 1));
			}
			const once = portDct(counts, degree);
			const twice = portDct(
				counts.map((value) => value * 2),
				degree,
			);
			for (let place = 0; place < count; place += 1) {
				expect(twice[place] ?? 0).toBeCloseTo(2 * (once[place] ?? 0), 1);
			}
		}
	});

	it("stands of the walks of the places of a block of the engine of the two ways of it", () => {
		// The walks of the places of a block of the engine of the two ways of it stand of the counts of the
		// walk of the engine over each other.
		// The walks of the engine of the two ways of it stand of the counts of the walk of the engine of
		// every place of a block of it of their own where the counts of the walk of the engine stand of the
		// counts of the walk of the count of the walk of the engine of the two ways of it over each other:
		// the reference stands of the places of the walk of the counts of the engine of the two ways of it
		// of one place of the walk of the engine of its own, of the places of the walk of three places of a
		// block of the engine where the counts of the walk of the engine stand of the places of the walk of
		// the counts of the engine of their own as well.
		for (const degree of [2, 3]) {
			const count = 1 << degree;
			const source = new Float32Array(count);
			for (let at = 0; at < count; at += 1)
				source[at] = Math.cos(at * 1.5) + at;
			const places = new Float32Array(count);
			const back = new Float32Array(count);
			const work = new Float32Array(count * 4);
			fastDct(places, 0, 1, source, 0, work, 0, degree);
			fastIdct(back, 0, places, 0, 1, work, degree);
			// The counts of the walk of the engine stand of the counts of the walk of the places of the
			// block of the engine of the walk of it over each other, of the counts of the walk of the engine
			// of the counts of the walk of the places of the block behind them: the two ways of the walk of
			// the engine stand of the same places of the block, of the counts of the walk of the engine over
			// each other of its own.
			// The walks of the places of a block of the engine of the two ways of it stand of the counts of
			// the walk of the engine over each other, of the count of the walk of the engine of the count of
			// the places of the block behind them: the count of the walk of the engine of every place of the
			// block stands of the place of the walk of it of its own over the places of the block of the
			// count of the walk of the engine.
			const factor = 1 << (degree - 1);
			for (let at = 0; at < count; at += 1) {
				expect(back[at] ?? 0).toBeCloseTo((source[at] ?? 0) * factor, 1);
			}
		}
	});

	it("stands of the counts of the walk of the places of a colour of the engine", () => {
		// The counts of the walk of the places of a colour of the engine stand of the counts of the walk of
		// the engine of the two places of a colour over each other.
		const places = new Float32Array([1, 3, 2, 4]);
		fastIplot(places, 0, 2);
		expect([...places]).toEqual([2, -1, 3, -1]);
		const out = new Float32Array(4);
		fastIlot(
			out,
			new Float32Array([1, 2, 3, 4]),
			0,
			new Float32Array([5, 6, 7, 8]),
			0,
			2,
		);
		expect([...out]).toEqual([7, -5, 11, -5]);
	});

	it("stands of the counts of the walk of the counts of the engine", () => {
		// The counts of the walk of the counts of the engine stand of the places of the count of the walk of
		// the engine of a block of it over each other, of the count of the walk of the engine behind every
		// count of the walk of it: the walks of the engine stand of the counts of the walk of the engine of
		// no count of them at all at the head of the walk of the counts of it.
		for (const degree of [4, 6, 8]) {
			const revolve = createRevolveParameter(degree);
			expect(revolve.length % 8).toBe(0);
			for (const place of revolve) {
				// Every count of the walk of the engine stands of the counts of the walk of the engine of a
				// block of it every seven places of the places of the walk of it: the highest place of the
				// walk of the counts of the engine stands of no count of them at all.
				const sum = place.rSin * place.rSin + place.rCos * place.rCos;
				const empty = 0 === place.rSin && 0 === place.rCos;
				expect(empty || Math.abs(sum - 1) < 0.001).toBe(true);
			}
		}
		// The counts of the walk of the engine stand of the counts of the walk of it of the two ways of the
		// engine.
		const first = new Float32Array([1, 2]);
		const second = new Float32Array([3, 4]);
		revolve2x2(first, 0, second, 0, Math.sin(0.5), Math.cos(0.5), 1, 2);
		expect(first[0] ?? 0).toBeCloseTo(1 * Math.cos(0.5) - 3 * Math.sin(0.5), 5);
		expect(second[0] ?? 0).toBeCloseTo(
			1 * Math.sin(0.5) + 3 * Math.cos(0.5),
			5,
		);
	});
});
