// The RC6 cipher of the Primel engine, held to the published vectors of the cipher and to the definition of
// the chaining the reference wraps it in.
//
// The block cipher and its key schedule stand of the NESSIE set of the cipher, read through
// `draft-krovetz-rc6-rc5-vectors` (the set of `Rc6-128-128.verified.test-vectors`), so the cipher is checked
// against a source outside this project and outside the reference: a slip in the mixing loop of the key
// schedule, in the rounds or in the order of the words stands out at once. The chaining has no published
// vectors of its own, so its expectations are worked out from the definition of CFB of a chaining place of
// sixteen places over that same cipher, which is what the reference's own comment names.
import { Buffer } from "node:buffer";
import {
	RC6_BLOCK_SIZE,
	Rc6,
	rc6DecryptBlock,
	rc6EncryptBlock,
	rc6KeySchedule,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The published vectors: a key, a clear block and the cipher of it, of a clear block of nothing. */
const VECTORS: readonly (readonly [string, string])[] = [
	["80000000000000000000000000000000", "1AD578A02A08162850A15A1552A17AD4"],
	["40000000000000000000000000000000", "912E9CF1473035A8443A82495C0730D3"],
	["20000000000000000000000000000000", "3D3E851A80ABAF221761931747473048"],
	["10000000000000000000000000000000", "96CFC0510819EEB7FCDF2CC7BEABEF77"],
];

const CLEAR = Buffer.alloc(16, 0x00);
const CHAIN_KEY = Buffer.from("80000000000000000000000000000000", "hex");
const CHAIN_IV = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

describe("RC6", () => {
	it("stands of the published vectors of the cipher", () => {
		for (const [key, cipher] of VECTORS) {
			const schedule = rc6KeySchedule(Buffer.from(key, "hex"));
			expect(schedule.rounds).toBe(20);
			expect(schedule.words.length).toBe(2 * (20 + 2));
			expect(
				rc6EncryptBlock(schedule, CLEAR).toString("hex").toUpperCase(),
			).toBe(cipher);
		}
	});

	it("carries the walk of the cipher backwards", () => {
		for (const [key, cipher] of VECTORS) {
			const schedule = rc6KeySchedule(Buffer.from(key, "hex"));
			const clear = rc6DecryptBlock(schedule, Buffer.from(cipher, "hex"));
			expect(clear.toString("hex")).toBe(CLEAR.toString("hex"));
		}
	});

	it("stands of the same cipher after a hundred turns of itself", () => {
		// The published set carries the value a hundred turns of the cipher over its own cipher text reach,
		// which moves every word of the state rather than the clear block of nothing alone.
		const schedule = rc6KeySchedule(Buffer.from(VECTORS[0]?.[0] ?? "", "hex"));
		let block: Buffer = Buffer.from(CLEAR);
		for (let turn = 0; turn < 100; turn += 1) {
			block = rc6EncryptBlock(schedule, block);
		}
		expect(block.toString("hex").toUpperCase()).toBe(
			"150B461D2ACDFC1EE9D404A6494632DD",
		);
	});

	it("reads a stream of the chaining of the reference", () => {
		// The chaining place stands of the cipher over the block in front of it, of the block XORed into it
		// and of that block as the chaining place behind it, which over a cipher text is CFB exactly.
		const data = Buffer.from(
			"00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100",
			"hex",
		);
		// The chaining place is a place of the walk of the reference, so every turn of it stands of a
		// chaining place of its own and a stream of two blocks stands of one block of two.
		expect(
			new Rc6(CHAIN_KEY, CHAIN_IV).transformBlock(data).toString("hex"),
		).toBe("fd83d52644fb63564dd5c2d05da647043047aa00020edf4f1be3e1ea5c2b9d12");
		// A tail shorter than a block stands of the places it came of.
		const tailed = Buffer.concat([data, Buffer.from("01020304", "hex")]);
		expect(
			new Rc6(CHAIN_KEY, CHAIN_IV).transformFinalBlock(tailed).toString("hex"),
		).toBe(
			"fd83d52644fb63564dd5c2d05da647043047aa00020edf4f1be3e1ea5c2b9d1201020304",
		);
		// A count shorter than a block is left where it is.
		expect(
			new Rc6(CHAIN_KEY, CHAIN_IV)
				.transformFinalBlock(Buffer.from("01020304", "hex"))
				.toString("hex"),
		).toBe("01020304");
	});

	it("stands of a chaining place of nothing where the reference hands none over", () => {
		// The reference fills its chaining place of sixteen places of nothing where no place of its own is
		// handed over, so the first block of the stream stands of the cipher over sixteen places of nothing.
		const rc6 = new Rc6(CHAIN_KEY);
		const data = Buffer.from(
			"00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100",
			"hex",
		);
		expect(rc6.transformBlock(data).toString("hex")).toBe(
			"1ac45a936e5d705fd838f0ae9e7c942b3047aa00020edf4f1be3e1ea5c2b9d12",
		);
	});

	it("does not stand of the cipher of the other direction", () => {
		// The chaining feeds back its input, so over a clear text it is not CFB and the direction the
		// reference reads an archive in - the cipher text one - is not the direction it writes in. The test
		// holds that, so that the mode is not mistaken for an involution.
		const data = Buffer.from(
			"00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100",
			"hex",
		);
		const once = new Rc6(CHAIN_KEY, CHAIN_IV).transformFinalBlock(data);
		const twice = new Rc6(CHAIN_KEY, CHAIN_IV).transformFinalBlock(once);
		expect(twice.toString("hex")).toBe(
			"00112233445566778899aabbccddeeffafe650839db53a4bf61103956f2572e8",
		);
		expect(twice.equals(data)).toBe(false);
	});

	it("stands of a key of no places, which the reference allows", () => {
		// The reference reads a key of no places as a single word of nothing, so an empty key stands of the
		// schedule a key of four places of nothing does.
		const empty = rc6KeySchedule(Buffer.alloc(0));
		expect(empty.words.length).toBe(2 * (20 + 2));
		expect([...empty.words]).toEqual([
			...rc6KeySchedule(Buffer.alloc(4, 0x00)).words,
		]);
		expect(rc6EncryptBlock(empty, CLEAR).length).toBe(RC6_BLOCK_SIZE);
	});

	it("stands of a key of any length", () => {
		const short = rc6KeySchedule(Buffer.from([0x01]));
		const wide = rc6KeySchedule(Buffer.from("01000000", "hex"));
		expect([...short.words]).toEqual([...wide.words]);
	});
});
