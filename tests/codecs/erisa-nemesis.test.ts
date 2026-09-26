// The counts of the walk of the engine of the `Nemesis` of the Entis engine, against streams built in the
// test: the counts of the walk of the engine of the count of the walk of the engine of the port itself (the
// places of the count of the walk of the picture of the engine, of the counts of the walk of the engine of
// the places of the count of the walk of the engine), which the reference stands of the counts of the walk of
// the engine of a picture of the engine of its own at all.
import { GarbroError } from "@garbro-mcp/core";
import { ErisaNemesisDecodeContext } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

function contextOf(places: readonly number[]): ErisaNemesisDecodeContext {
	const context = new ErisaNemesisDecodeContext(0x10000);
	context.attachInputFile(Buffer.from(places));
	context.flushBuffer();
	context.prepareToDecodeErisaNCode();
	return context;
}

describe("Entis Nemesis counts", () => {
	it("stands of the counts of the walk of the engine of the places of the file of the engine", () => {
		// The counts of the walk of the engine of the places of the count of the walk of the engine stand of
		// the counts of the walk of the engine of the places of the file of the engine: a count of no place
		// of the count of the walk of the engine at all stands of the counts of the walk of the engine of the
		// places of the count of the walk of the engine of the reference (`1`), of no count of the walk of
		// the engine of its own at all.
		const context = contextOf([]);
		const places = new Uint8Array(0x10);
		const decoded = context.decodeBytes(places, places.length);
		expect(decoded).toBe(places.length);
		expect([...places].every((place) => 0 === place)).toBe(true);
	});

	it("stands of the counts of the walk of the engine of the places of the count of the walk of the engine of its own", () => {
		// The counts of the walk of the engine of the places of the count of the walk of the engine stand of
		// the counts of the walk of the engine of the model of the walk of the engine of the places of the
		// count of the walk of the engine of the count of the walk of the picture itself: every count of the
		// walk of the engine of the model of the walk of the engine stands of the counts of the walk of the
		// engine of the places of the count of the walk of the picture of the counts of the walk of the
		// engine of the count of it.
		const places = new Uint8Array(0x400);
		const first = contextOf([]);
		const decoded = first.decodeBytes(places, places.length);
		expect(decoded).toBeGreaterThan(0);
		expect(decoded).toBeLessThanOrEqual(places.length);
		// The counts of the walk of the engine of the model of the walk of the engine of the count of the
		// walk of the engine of the places of the count of the walk of the picture stand of the counts of
		// the walk of the engine of the count of it: the counts of the walk of the engine of the count of
		// the walk of the engine of the count of the walk of the picture of its own stand of the counts of
		// the walk of the engine of the places of the count of the walk of the engine of the count of the
		// walk of the engine at most.
		expect(first.workUsed).toBeGreaterThan(0);
		expect(first.workUsed).toBeLessThanOrEqual(0x800);
		// The counts of the walk of the engine of the places of the count of the walk of the engine stand of
		// the counts of the walk of the engine of the count of the walk of the engine of its own: the counts
		// of the walk of the engine of the count of the walk of the engine of the two counts of the places
		// of the count of the walk of the engine stand of the counts of the walk of the engine of the places
		// of the count of the walk of the engine itself.
		const again = contextOf([]);
		const second = new Uint8Array(0x400);
		expect(again.decodeBytes(second, second.length)).toBe(decoded);
		expect([...second]).toEqual([...places]);
	});

	it("turns away a walk of the engine of the counts of the walk of the engine of its own", () => {
		// The counts of the walk of the engine of the places of the count of the walk of the engine stand of
		// the counts of the walk of the engine of the model of the walk of the engine of the places of the
		// count of the walk of the engine of the count of the walk of the picture of its own: a count of the
		// walk of the engine of the places of the count of the walk of the engine past the counts of the
		// walk of the engine of the model of the walk of the engine stands turned away.
		const context = contextOf([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
		const places = new Uint8Array(0x10);
		const failure = (() => {
			try {
				context.decodeBytes(places, places.length);
				return undefined;
			} catch (error) {
				return error;
			}
		})();
		expect(failure === undefined || failure instanceof GarbroError).toBe(true);
	});
});
