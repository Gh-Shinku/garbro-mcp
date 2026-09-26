// The bit-stream of the Entis engine, against streams built in the test: the places of a count of the walk
// of the engine (`GetABit`, `GetNBits` of the two ways of the engine), the counts of the walk of the
// counts of a picture of the engine (`GetGammaCode`, of the table of the walk of it) and the places of the
// counts of the walk of it (`DecodeGammaCodeBytes`). The fixture stands of the table of the walk of the
// engine the same way the walk of the engine stands of it: the places of a count of the walk of the engine
// stand of the places of the count and of the places of the count of the walk of it.
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import {
	type ErisaPlaces,
	ErisaRleDecodeContext,
	ERISA_GAMMA_TABLE,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const PLACE_MASK = 0xff;

/** The places of the stream of the engine, of the bits of the places of the file behind them. */
function bitsToPlaces(bits: readonly number[]): Buffer {
	const places = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [at, bit] of bits.entries()) {
		if (0 !== bit) {
			places[Math.floor(at / 8)] =
				(places[Math.floor(at / 8)] ?? 0) | (1 << (7 - (at % 8)));
		}
	}
	return places;
}

/**
 * The places of a count of the walk of the engine, of the count of the walk of it: the table of the walk
 * of the engine stands of the places of the count of the walk of it, of the count of the places of the walk
 * of the count behind every place of it.
 */
function gammaBits(code: number): number[] {
	if (1 === code) return [0];
	for (let place = 0; place < 0x200; place += 2) {
		if (ERISA_GAMMA_TABLE[place] !== code) continue;
		const count = ERISA_GAMMA_TABLE[place + 1] ?? 0;
		if (0xff === count) continue;
		const bits: number[] = [1];
		for (let at = 0; at < count; at += 1) {
			bits.push(((place >> 1) >> (7 - at)) & 1);
		}
		return bits;
	}
	throw new Error(`no count ${code} of the walk of the engine`);
}

/** A walk of the counts of a picture of the engine, of the places of a stream of it. */
function walkOf(bits: readonly number[]): ErisaRleDecodeContext {
	const context = new ErisaRleDecodeContext(0x10);
	context.attachInputFile(bitsToPlaces(bits));
	context.initGammaContext();
	return context;
}

/** The count of the walk of the engine, of the places of the walk of it, of the control of the test. */
function codeOf(context: ErisaRleDecodeContext): number {
	return (context as unknown as { getGammaCode(): number }).getGammaCode();
}

describe("Entis bit stream", () => {
	it("reads the places of a count of the walk of the engine", () => {
		const context = new ErisaRleDecodeContext(0x10);
		// The places of the count of a walk of the engine stand of the places of the file of it, of the
		// highest place of a count of the places of a word in front of the places of the count behind it.
		context.attachInputFile(Buffer.from([0xb2, 0x61]));
		expect([
			context.getABit(),
			context.getABit(),
			context.getABit(),
			context.getABit(),
			context.getABit(),
			context.getABit(),
			context.getABit(),
			context.getABit(),
		]).toEqual([-1, 0, -1, -1, 0, 0, -1, 0]);
		context.flushBuffer();
		context.attachInputFile(Buffer.from([0xb2, 0x61]));
		expect(context.getNBits(4)).toBe(0xb);
		expect(context.getNBits(4)).toBe(0x2);
		expect(context.getNBits(8)).toBe(0x61);
		// The places of a count of a walk of an engine that stands short of the places of a word of it stand
		// of the places of the walk of the engine of no count of them at all.
		context.flushBuffer();
		context.attachInputFile(Buffer.from([0xa0]));
		expect(context.getNBits(16)).toBe(0xa000);
		// A walk of the engine of a stream that stands of no place of it at all stands of the places of the
		// count of the walk of the engine of nothing, and a walk of the engine that stands of no stream at
		// all stands of no walk of it.
		const empty = walkOf([]);
		expect(empty.getABit()).toBe(1);
		expect(empty.getNBits(4)).toBe(0);
		expect(() => new ErisaRleDecodeContext(0x10).getABit()).toThrow(
			GarbroError,
		);
	});

	it("reads the counts of the walk of the engine, of the table of the walk of it", () => {
		// The count of the walk of the engine stands of the places of the table of the walk of it, of the
		// count of the places of the walk of the count behind every place of it.
		for (const code of [1, 2, 3, 4, 5, 8, 17, 31]) {
			// The first place of the walk of the engine stands of the flag of the walk of the counts of a
			// picture of the engine, and the places of the count of the walk of the engine stand behind it.
			const context = walkOf([0, ...gammaBits(code)]);
			expect(codeOf(context)).toBe(code);
		}
	});

	it("stands of the counts of the walk of a picture of the engine", () => {
		// A walk of a count of no sign: the places of the walk of the engine stand of the count of the walk
		// of the picture behind the count of the walk of the count, of the places of the count of the walk of
		// the engine of no count of them at all.
		const run = walkOf([0, ...gammaBits(3)]);
		const places: ErisaPlaces = new Uint8Array(8);
		expect(run.decodeBytes(places, 3)).toBe(3);
		expect([...places]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		// The places of a count of a sign stand of the sign of them in front of the count of the walk of the
		// engine, of the count of the walk of the engine behind it: the highest place of a count of the walk
		// of the engine stands of a count of no sign at all.
		const signed = walkOf([
			1,
			...gammaBits(2),
			1,
			...gammaBits(31),
			0,
			...gammaBits(31),
		]);
		const values: ErisaPlaces = new Uint8Array(4);
		expect(signed.decodeBytes(values, 2)).toBe(2);
		expect([...values]).toEqual([-31 & PLACE_MASK, 31, 0, 0]);
	});

	it("stands of the two ways of the walk of a count of the engine", () => {
		// The walk of the engine stands of the places of the table of the walk of it where the places of the
		// count of the walk of a word of it stand of at least eight of them, and of the places of the walk of
		// the engine one by one where they do not: the two ways of the walk stand of the same count of them.
		for (const code of [2, 3, 4, 8, 17]) {
			const bits = gammaBits(code);
			const fast = walkOf([0, ...bits]);
			expect(codeOf(fast)).toBe(code);
			// The count of the walk of the engine stands of the places of the walk of it one by one where
			// the places of the count of a word of the walk of the engine stand of fewer than eight of them.
			const slow = walkOf([0, ...new Array(24).fill(0), ...bits]);
			expect(slow.getNBits(24)).toBe(0);
			expect(codeOf(slow)).toBe(code);
		}
	});
});
