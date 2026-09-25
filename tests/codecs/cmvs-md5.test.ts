// The MD5 family of the CMVS engine: the round of the reference and the seven keys it is stood over.
//
// The round is the round of RFC 1321, and the seventh key of the engine, `mirai`, stands of the state of the
// standard alone, so the key is held to `node:crypto` here: that anchor fixes the round, the sine table, the
// order of the words and the shaping of the block in one go, and with it every other key, which differs from
// it in the state and in the mapping of the four words alone. The expectations of the other six keys are a
// transcription of the same source as the port (`ArcFormats/Cmvs/CmvsMD5.cs`), worked out a second time
// outside this package, so that a slip in a state or in a constant shows as a difference between the two.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
	CMVS_MD5_SINE_TABLE,
	type CmvsMd5Variant,
	cmvsMd5,
	cmvsMd5Block,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const WORDS = [0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210];
const ZERO = [0, 0, 0, 0];
const OTHER = [0xdeadbeef, 0x00000001, 0x00000002, 0x00000003];

/** The sixteen places of four words, from the lowest place of a byte up, which is the order of the round. */
function bytesOf(words: readonly number[]): Buffer {
	const out = Buffer.alloc(4 * words.length);
	for (let index = 0; index < words.length; index += 1) {
		out.writeUInt32LE((words[index] ?? 0) >>> 0, index * 4);
	}
	return out;
}

/** The four words of a digest, from the lowest place of a byte up. */
function wordsOf(digest: Buffer): number[] {
	const out: number[] = [];
	for (let at = 0; at < digest.length; at += 4) {
		out.push(digest.readUInt32LE(at));
	}
	return out;
}

describe("CMVS MD5", () => {
	it("stands of the sine table of the standard", () => {
		// The table of the round is the fractional part of the sine of the count of the step, of which the
		// reference carries its own copy; the test works the table out rather than reading it twice.
		for (let step = 0; step < 64; step += 1) {
			const derived = Math.floor(Math.abs(Math.sin(step + 1)) * 2 ** 32) >>> 0;
			expect(CMVS_MD5_SINE_TABLE[step]).toBe(derived);
		}
	});

	it("stands of the state of the standard in its `mirai` key", () => {
		// `Md5Mirai` stands of the initial state of RFC 1321 and hands the four words of the round over as
		// they stand, and the reference builds the block of exactly the sixteen places of its input, of the
		// terminator at the fifth word and of the first place of the length field at the fifteenth. The key
		// is therefore the standard MD5 of those sixteen places, which is what this holds it to.
		for (const words of [ZERO, WORDS, OTHER]) {
			const digest = createHash("md5").update(bytesOf(words)).digest();
			expect(cmvsMd5("mirai", words)).toEqual(wordsOf(digest));
		}
	});

	it("stands of the six keys of the engine", () => {
		// The six other keys differ from `mirai` in the initial state and in the mapping of the four words
		// the round leaves behind alone, and none of them touches the round. Their expectations stand of the
		// walk of the same source, worked out a second time outside this package.
		const expected: readonly (readonly [CmvsMd5Variant, number[], string])[] = [
			["a", ZERO, "81ca5a9f 2f5fc8ef 6ce7a430 9425f053"],
			["a", WORDS, "ea970b73 6ce3f5b9 19e782da 6adff571"],
			["b", ZERO, "6972ca79 73627ce1 c28b8621 c9c8ae3f"],
			["b", WORDS, "5db1daae 02f23d19 318cd6b7 87ce2221"],
			["chrono", ZERO, "2940c81f d3be4924 ed8e18fe 65c20484"],
			["chrono", WORDS, "5c40eef5 114275ee 13741ddc ce8eb558"],
			["memoria", ZERO, "53d82c71 8ff395df 9a3678da bd79128f"],
			["memoria", WORDS, "8b2a917e e2348036 653540c2 04a55f9b"],
			["natsu", ZERO, "559e5e05 d1affba8 d0f4e5f6 c846c51a"],
			["natsu", WORDS, "4ba55a27 beedc96b 7d5ad253 7609b376"],
			["aoi", ZERO, "7124f295 edfc9eb1 3c454069 a8d073e4"],
			["aoi", WORDS, "2ea46c9e b9baf9d6 7fc2366d 41ba4f50"],
		];
		for (const [variant, words, wanted] of expected) {
			expect(
				cmvsMd5(variant, words)
					.map((word) => word.toString(16).padStart(8, "0"))
					.join(" "),
			).toBe(wanted);
		}
		// The two keys of the same state stand apart in the mapping of the four words alone, and the four
		// keys of a state of their own are not the standard one.
		expect(cmvsMd5("a", WORDS)).not.toEqual(cmvsMd5("chrono", WORDS));
		expect(cmvsMd5("a", WORDS)).not.toEqual(cmvsMd5("b", WORDS));
		expect(cmvsMd5("aoi", WORDS)).not.toEqual(cmvsMd5("a", WORDS));
	});

	it("shapes the block of the reference", () => {
		// The reference reads the four words it is handed into the head of a block of sixteen words, stands
		// a place of 0x80 at the fifth word and another at the fifteenth, and leaves the rest at nothing.
		expect(cmvsMd5Block(WORDS)).toEqual([
			0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210, 0x80, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0x80, 0,
		]);
	});

	it("hands the same words over every call", () => {
		// The state of the reference lives in the instance it computes with, and the round is added onto it,
		// so a second call on that instance stands on the words the first left behind. The engine computes
		// once per archive, and this port stands of the input alone.
		expect(cmvsMd5("a", WORDS)).toEqual(cmvsMd5("a", WORDS));
		expect(cmvsMd5("mirai", ZERO)).toEqual(cmvsMd5("mirai", ZERO));
	});
});
