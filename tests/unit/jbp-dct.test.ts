import { describe, expect, it } from "vitest";
import {
	JBP_PLACES_PER_BLOCK,
	inverseJbpDct,
} from "../../packages/codecs/src/jbp-dct.js";

/** The places of the walk of the places of a picture that stand for the places of the picture beside them,
 * which this test stands as places of one number for the whole picture. */
function quantOf(value: number): Int16Array {
	return new Int16Array(JBP_PLACES_PER_BLOCK).fill(value);
}

function blockOf(places: Record<number, number>): Int16Array {
	const table = new Int16Array(JBP_PLACES_PER_BLOCK);
	for (const [at, value] of Object.entries(places)) {
		table[Number(at)] = value;
	}
	return table;
}

describe("Purple places of the picture itself", () => {
	it("stands the places of a picture that stand as no places of the walk at all as nothing", () => {
		const table = blockOf({});
		inverseJbpDct(table, quantOf(4));
		expect([...table]).toEqual(new Array(64).fill(0));
	});

	it("stands a place of a picture that stands for the same place of the picture as every place of the walk", () => {
		// Every place of the walk of the places of the picture stands for no places of the picture beside the
		// place of the picture itself, so every place of the picture stands as the same place as the others.
		for (const [dc, quant] of [
			[100, 4],
			[-100, 4],
			[37, 1],
			[0, 9],
		] as Array<[number, number]>) {
			const table = blockOf({ 0: dc });
			inverseJbpDct(table, quantOf(quant));
			// The places of the walk of the places of the picture that stand for places of the picture that
			// stand beside them stand as the places of the picture three places behind the places of the file
			// that stand as them.
			const expected = (dc * quant) >> 3;
			expect([...table]).toEqual(new Array(64).fill(expected));
		}
	});

	it("stands the places of the walk of the places of the picture along the places of the walk and beside them", () => {
		// One place of the walk of the places of the picture that stands for places of the picture beside the
		// place of the picture itself stands as places of the picture that stand beside the places of the
		// picture on both sides of the place itself.
		const table = blockOf({ 1: 100 });
		inverseJbpDct(table, quantOf(1));
		const row = [...table.subarray(0, 8)];
		expect(new Set(row).size).toBeGreaterThan(1);
		// The places of the walk of the picture stand as the places of the picture beside them behind and
		// before every place of the picture, so the first place of a row stands as the places of the picture
		// the last place of the row stands as, the other way round.
		for (let at = 0; at < 4; at += 1) {
			const first = row[at] ?? 0;
			const last = row[7 - at] ?? 0;
			if (first !== 0) expect(first > 0).toBe(last < 0);
		}
		// Every place of the walk of the picture stands the same way along the places of the walk, so every
		// row of the places of the picture stands as the other rows stand as well.
		expect([...table.subarray(8, 16)]).toEqual(row);
		expect([...table.subarray(56, 64)]).toEqual(row);
	});

	it("stands the places of the walk of the places of the picture behind the places of the file that stand for them", () => {
		// The places of the walk of the places of a colour stand as the places of the file before the walk of
		// the places of the picture that stand for them, so the places of the file stand for the places of the
		// picture behind them by as many places of the picture as the walk of the places of the colour names.
		const left = blockOf({ 0: 64 });
		inverseJbpDct(left, quantOf(8));
		const right = blockOf({ 0: 64 });
		inverseJbpDct(right, quantOf(16));
		expect(right[0]).toBe((left[0] ?? 0) * 2);
	});
});
