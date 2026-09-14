import { Rc4 } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The published RC4 vectors, whose keystream starts at the first byte with nothing dropped. */
const VECTORS: Array<[string, string, string]> = [
	["Key", "Plaintext", "bbf316e8d940af0ad3"],
	["Wiki", "pedia", "1021bf0420"],
	["Secret", "Attack at dawn", "45a01f645fc35b383552544b9bf5"],
];

describe("Rc4", () => {
	it("matches the published vectors", () => {
		for (const [key, plain, cipher] of VECTORS) {
			const text = Buffer.from(plain, "latin1");
			new Rc4(Buffer.from(key, "latin1")).transform(text);
			expect(text.toString("hex")).toBe(cipher);
		}
	});

	it("is its own inverse", () => {
		const key = Buffer.from("Hlk9D28p", "latin1");
		const original = Buffer.from(
			"the quick brown fox jumps over the lazy dog",
			"latin1",
		);
		const scrambled = new Rc4(key).transform(Buffer.from(original));
		expect(scrambled.equals(original)).toBe(false);
		expect(new Rc4(key).transform(scrambled).equals(original)).toBe(true);
	});

	it("carries its keystream across calls", () => {
		const key = Buffer.from("stream", "latin1");
		const whole = Buffer.from("0123456789abcdef", "latin1");
		const split = Buffer.from("0123456789abcdef", "latin1");
		new Rc4(key).transform(whole);
		const cipher = new Rc4(key);
		cipher.transform(split.subarray(0, 5));
		cipher.transform(split.subarray(5));
		expect(split.equals(whole)).toBe(true);
	});

	it("takes a sixteen byte key as the encrypted images do", () => {
		const key = Buffer.from("0123456789abcdef", "latin1");
		const data: Buffer = Buffer.alloc(64, 0x42);
		const once = new Rc4(key).xor(data);
		expect(once.equals(data)).toBe(false);
		expect(new Rc4(key).xor(once).equals(data)).toBe(true);
	});

	it("refuses an empty key", () => {
		expect(() => new Rc4(Buffer.alloc(0))).toThrow(RangeError);
	});
});
