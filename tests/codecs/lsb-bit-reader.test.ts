import { Buffer } from "node:buffer";
import { LsbBitReader } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

describe("least significant bit first reader", () => {
	it("takes the least significant place of every byte of the file first", () => {
		const reader = new LsbBitReader(Buffer.from([0b1011_0010, 0b0000_0111]));
		// The first four places of the first byte, least significant first.
		expect(reader.readBits(4)).toBe(0b0010);
		expect(reader.readBits(4)).toBe(0b1011);
		// Then the places of the byte behind it.
		expect(reader.readBits(3)).toBe(0b111);
		expect(reader.readBits(5)).toBe(0);
	});

	it("takes a word that reaches into the byte behind it", () => {
		// The places of a word are gathered from every byte it reaches into, the low places of the byte
		// behind it standing behind the places of the byte in front of it.
		const reader = new LsbBitReader(Buffer.from([0x01, 0x02]));
		expect(reader.readBits(9)).toBe((0x01 | (0x02 << 8)) & 0x1ff);
	});

	it("carries the places of the file it has not read yet between the words", () => {
		const reader = new LsbBitReader(Buffer.from([0b1100_1010]));
		expect(reader.readBits(3)).toBe(0b010);
		expect(reader.readBits(3)).toBe(0b001);
		expect(reader.readBits(2)).toBe(0b11);
	});

	it("reports the end of the file, and stands of an error where a word must come", () => {
		const reader = new LsbBitReader(Buffer.from([0xff]));
		expect(reader.readBits(8)).toBe(0xff);
		expect(reader.tryReadBits(1)).toBe(-1);
		expect(() => reader.readBits(1)).toThrow(RangeError);
	});

	it("stands of the places of the file it is given, and of no others", () => {
		const data = Buffer.from([0x00, 0x0f, 0x00]);
		const reader = new LsbBitReader(data.subarray(1, 2));
		expect(reader.readBits(8)).toBe(0x0f);
		expect(reader.tryReadBits(1)).toBe(-1);
	});
});
