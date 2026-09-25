// The range walk of the Primel engine, held to places of a run worked out in the test from the terms of the
// walk rather than read off the port: the counts of the places of a chunk, the place of the range it begins
// at, and the places of the range it reads as it goes. The walk stands of twelve places of precision, so the
// counts of the places of a run of the stream have to come to four thousand and ninety six places between
// them - the place of the range of the walk - and the places of the table that stand at nothing stand at
// nothing.
import { Buffer } from "node:buffer";
import { unpackPrimelRange } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The places of precision of the walk, of the range it begins at. */
const RANGE_START = 0xc0000000;
const RANGE_PLACES = 1 << 12;

/** The counts of the places of a chunk: every place of the table, of its own count. */
function countsOf(pairs: readonly (readonly [number, number])[]): number[] {
	const counts = new Array<number>(256).fill(0);
	for (const [place, count] of pairs) counts[place] = count;
	return counts;
}

/** The stream of a chunk: its count of places, its flags, the places of its table and the range behind it. */
function chunk(input: {
	count: number;
	counts: readonly number[];
	head: number;
	more?: boolean;
	range?: readonly number[];
}): Buffer {
	const size = Buffer.alloc(4);
	size.writeInt32LE(input.count, 0);
	const used: number[] = [];
	for (let place = 0; place < 256; place += 1) {
		if ((input.counts[place] ?? 0) > 0) used.push(place);
	}
	const table: number[] = [used.length];
	for (const place of used) {
		const count = input.counts[place] ?? 0;
		if (count < 0x80) table.push(place, count);
		else table.push(place, count & 0x7f, (count >> 7) & 0xff);
	}
	const head = Buffer.alloc(4);
	head.writeUInt32BE(input.head >>> 0, 0);
	return Buffer.concat([
		size,
		Buffer.from([(input.more ? 0x80 : 0x00) | 1]),
		Buffer.from(table),
		head,
		Buffer.from(input.range ?? []),
	]);
}

/** The place of the range of a place of the table, of the place of the run of the stream it stands of. */
function rangePlace(index: number): number {
	return Math.imul(index, RANGE_START >>> 12) >>> 0;
}

describe("Primel range stream", () => {
	it("walks a run of two places of the same count", () => {
		// Two places of two thousand and forty eight places each, of a sum of the whole range. The place of
		// the range stands at nothing, so the walk turns the first place of the table out; where it stands at
		// the place of the second one over the range of the first, the walk turns that one out, of the whole
		// range behind it again.
		const counts = countsOf([
			[0x41, 2048],
			[0x42, 2048],
		]);
		expect([
			...unpackPrimelRange(chunk({ count: 3, counts, head: 0 })),
		]).toEqual([0x41, 0x41, 0x41]);
		expect([
			...unpackPrimelRange(chunk({ count: 3, counts, head: 0x60000000 })),
		]).toEqual([0x42, 0x41, 0x41]);
	});

	it("walks a run of four places of a quarter of the range each", () => {
		// The place of the range stands at the last quarter of it, so the walk turns the last place of the
		// table out and then the first one, which stands at nothing, three times.
		const counts = countsOf([
			[0x10, 1024],
			[0x20, 1024],
			[0x30, 1024],
			[0x40, 1024],
		]);
		expect([
			...unpackPrimelRange(
				chunk({ count: 4, counts, head: rangePlace(3 * 1024), range: [0x00] }),
			),
		]).toEqual([0x40, 0x10, 0x10, 0x10]);
	});

	it("reads the places of the range as the range of the walk runs out", () => {
		// Two places of a half of the range each: every place of the run halves the range, so the ninth place
		// of a walk of nine reads a place of the range, which stands at nothing here.
		const counts = countsOf([
			[0x41, 2048],
			[0x42, 2048],
		]);
		expect([
			...unpackPrimelRange(
				chunk({ count: 9, counts, head: 0, range: [0x00, 0x00] }),
			),
		]).toEqual([0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41]);
	});

	it("walks a run of two places of a thousand and of three thousand and ninety six", () => {
		// The place of the range stands at the two thousand and five hundredth place of it, which stands
		// within the second place of the table, and the run goes on from the place the walk stands at.
		const counts = countsOf([
			[0x41, 1000],
			[0x42, 3096],
		]);
		expect([
			...unpackPrimelRange(
				chunk({ count: 10, counts, head: rangePlace(2500) }),
			),
		]).toEqual([0x42, 0x42, 0x42, 0x41, 0x42, 0x41, 0x42, 0x42, 0x42, 0x42]);
		// The place of the range stands at the last place of it, so the walk stands at the second place of
		// the table, of the whole run behind it.
		expect([
			...unpackPrimelRange(
				chunk({ count: 12, counts, head: rangePlace(RANGE_PLACES - 1) }),
			),
		]).toEqual([
			0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42,
		]);
	});

	it("stands of the chunks behind a chunk of the flag", () => {
		// A chunk whose flag stands of another chunk behind it is followed by that one, of a table and a range
		// of its own, and the places of the two runs follow one another.
		const first = chunk({
			count: 1,
			counts: countsOf([[0x5a, 4096]]),
			head: 0,
			more: true,
		});
		const second = chunk({
			count: 2,
			counts: countsOf([
				[0x41, 2048],
				[0x42, 2048],
			]),
			head: 0,
		});
		expect([...unpackPrimelRange(Buffer.concat([first, second]))]).toEqual([
			0x5a, 0x41, 0x41,
		]);
	});

	it("turns away a chunk of no places", () => {
		expect(() =>
			unpackPrimelRange(
				chunk({ count: 1, counts: countsOf([[0x41, 0]]), head: 0 }),
			),
		).toThrow();
	});
});
