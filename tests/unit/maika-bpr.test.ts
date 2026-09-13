import { inflateMaikaBpr } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

describe("MAIKA BPR", () => {
	it("decodes BPR02 repeated and literal commands", () => {
		const input = Buffer.alloc(1 + 4 + 1 + 1 + 4 + 2 + 1);
		let position = 0;
		input[position++] = 3;
		input.writeInt32LE(3, position);
		position += 4;
		input[position++] = 0x41;
		input[position++] = 0;
		input.writeInt32LE(2, position);
		position += 4;
		input.write("BC", position, "ascii");
		position += 2;
		input[position] = 0xff;
		expect(inflateMaikaBpr(input, 3)).toEqual(Buffer.from("AAABC"));
	});

	it("uses control 1 as the BPR01 repeat code", () => {
		const input = Buffer.alloc(7);
		input[0] = 1;
		input.writeInt32LE(2, 1);
		input[5] = 0x5a;
		input[6] = 0xff;
		expect(inflateMaikaBpr(input, 1)).toEqual(Buffer.from("ZZ"));
	});

	it("bounds output from malformed counts", () => {
		const input = Buffer.alloc(6);
		input[0] = 3;
		input.writeInt32LE(0x7fffffff, 1);
		input[5] = 0x41;
		expect(() => inflateMaikaBpr(input, 3, 3)).toThrow(RangeError);
	});

	it("consumes the value of a zero-length repeat", () => {
		const input = Buffer.alloc(13);
		input[0] = 3;
		input.writeInt32LE(0, 1);
		input[5] = 0x41;
		input[6] = 3;
		input.writeInt32LE(1, 7);
		input[11] = 0x42;
		input[12] = 0xff;
		expect(inflateMaikaBpr(input, 3)).toEqual(Buffer.from("B"));
	});
});
