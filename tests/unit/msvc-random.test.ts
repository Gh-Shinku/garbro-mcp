import { MsvcRandom } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

describe("Microsoft C runtime random generator", () => {
	it("draws the values the runtime is known for, minus its mask", () => {
		expect(new MsvcRandom(0).next()).toBe(38);
		expect(new MsvcRandom(1).next()).toBe(41);
		const generator = new MsvcRandom(1);
		expect(generator.next()).toBe(41);
		// The reference hands the whole high word over, where the runtime's own rand() masks it with 0x7FFF.
		// A draw whose fifteenth bit is set therefore differs: 51235 here against 18467 there.
		expect(generator.next()).toBe(51235);
		// A draw that does not set that bit matches the runtime exactly.
		expect(generator.next()).toBe(6334);
	});

	it("wraps thirty two bits and keeps the low byte usable", () => {
		const generator = new MsvcRandom(0xffffffff);
		// The multiply and the addition both wrap, as the reference's unsigned arithmetic does.
		expect(generator.state).toBe(0xffffffff);
		const draw = generator.next();
		expect(draw).toBeGreaterThanOrEqual(0);
		expect(draw).toBeLessThanOrEqual(0xffff);
		expect(generator.state).toBe(
			((0xffffffff * 0x343fd + 0x269ec3) >>> 0) >>> 0,
		);
	});

	it("hands the moved state over, not the seed it was given", () => {
		// A caller that seeds, draws and reads the state must see where the generator now is.
		const generator = new MsvcRandom(0x12345678);
		const before = generator.state;
		generator.next();
		expect(generator.state).not.toBe(before);
		const after = generator.state;
		generator.next();
		expect(generator.state).not.toBe(after);
	});
});
