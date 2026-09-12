import { inflateLzss } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

describe("LZSS codec", () => {
	it("decodes a literal followed by a back-reference", () => {
		// Control 0x01: bit 0 set -> literal 'A'; bit 1 clear -> match at 0xfee, count 4.
		const input = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		expect(inflateLzss(input, { outputLength: 5 }).toString("latin1")).toBe(
			"AAAAA",
		);
	});

	it("supports the reversed control bit used by the Ail opener", () => {
		// Inverted polarity: bit 0 clear -> literal, bit 1 set -> match.
		const input = Buffer.from([0x02, 0x41, 0xee, 0xf1]);
		expect(
			inflateLzss(input, { outputLength: 5, literalBit: 0 }).toString("latin1"),
		).toBe("AAAAA");
	});

	it("uses the frame fill byte for matches into untouched history", () => {
		// Control 0x00: bit 0 clear -> match at 0xfee with count 3, copying pre-filled spaces.
		const input = Buffer.from([0x00, 0xee, 0xf0]);
		expect(
			inflateLzss(input, {
				outputLength: 3,
				frameFill: 0x20,
			}).toString("latin1"),
		).toBe("   ");
	});

	it("stops quietly when the input ends early", () => {
		const input = Buffer.from([0x01, 0x41, 0x01]);
		expect(inflateLzss(input, { outputLength: 4 }).toString("latin1")).toBe(
			"A",
		);
	});

	it("rejects a frame size that is not a power of two", () => {
		expect(() =>
			inflateLzss(Buffer.alloc(0), { outputLength: 0, frameSize: 3 }),
		).toThrow(/power of two/);
	});
});
