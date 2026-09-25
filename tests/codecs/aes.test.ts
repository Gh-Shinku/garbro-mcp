// AES-128 and the byte wise CFB walk of the Primel engine, held to the published vectors of the standard.
//
// The reference has no AES of its own - `ArcPCF.cs` hands the key and the chaining place to the platform's
// `Rijndael`, in `CipherMode.CFB` of the default feedback size of eight places - so the cipher here stands
// of the standard and is held to the vectors of the standard: the block to the example of the appendix of
// FIPS-197, and the walk to the byte wise CFB example of SP 800-38A, of the nineteen places of it the
// published vector carries. A source outside this project therefore fixes the schedule, the round, the
// tables made from the field, the segment of the walk and the shifting of the chaining place in one go.
import { Buffer } from "node:buffer";
import {
	AES_BLOCK_SIZE,
	AesCfb8,
	aes128DecryptBlock,
	aes128EncryptBlock,
	aes128KeySchedule,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** The example of the appendix of FIPS-197: a key, a clear block and the cipher of it. */
const FIPS_KEY = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const FIPS_CLEAR = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const FIPS_CIPHER = "69c4e0d86a7b0430d8cdb78070b4c55a";

/** The byte wise CFB example of SP 800-38A, of the eighteen places of it the published vector carries. */
const CFB_KEY = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");
const CFB_IV = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const CFB_PLACES = 18;
const CFB_CLEAR =
	"6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710";
const CFB_CIPHER = "3b79424c9c0dd436bace9e0ed4586a4f32b9";

describe("AES", () => {
	it("stands of the block of the appendix of FIPS-197", () => {
		const schedule = aes128KeySchedule(FIPS_KEY);
		expect(schedule.length).toBe(11);
		expect(aes128EncryptBlock(schedule, FIPS_CLEAR).toString("hex")).toBe(
			FIPS_CIPHER,
		);
		expect(
			aes128DecryptBlock(schedule, Buffer.from(FIPS_CIPHER, "hex")).toString(
				"hex",
			),
		).toBe(FIPS_CLEAR.toString("hex"));
		// The key of the example is the places of the count of them, so the schedule of the standard stands
		// of the round constant of the first round, of the place one of the field.
		expect([...(schedule[0] ?? [])]).toEqual([...FIPS_KEY]);
	});

	it("stands of the byte wise walk of SP 800-38A", () => {
		// The walk of the reference stands of a segment of one byte - the default feedback size of the
		// platform - so every byte of the run takes the block of the cipher over the chaining place again,
		// of the byte of the walk standing at the end of it.
		const clear = Buffer.from(CFB_CLEAR, "hex");
		const cipher = new AesCfb8(CFB_KEY, CFB_IV).encrypt(clear).toString("hex");
		expect(cipher.slice(0, 2 * CFB_PLACES)).toBe(CFB_CIPHER);
		// The same places, backwards: the walk of the example that reads the cipher text.
		expect(
			new AesCfb8(CFB_KEY, CFB_IV)
				.decrypt(Buffer.from(CFB_CIPHER, "hex"))
				.toString("hex"),
		).toBe(clear.subarray(0, CFB_PLACES).toString("hex"));
	});

	it("stands of the places of a run of its own with the walk of one segment", () => {
		// The places of the walk of one byte and of the walk of a block stand apart over a run of any length
		// but a block, which is what the places of the published example of a byte stand on.
		const clear = Buffer.alloc(AES_BLOCK_SIZE * 4, 0x5a);
		const cipher = new AesCfb8(CFB_KEY, CFB_IV).encrypt(clear);
		expect(cipher.equals(clear)).toBe(false);
		expect(new AesCfb8(CFB_KEY, CFB_IV).decrypt(cipher).equals(clear)).toBe(
			true,
		);
		// The walk stands of the places of a block of the plaintext as well: a shorter run is the head of a
		// longer one.
		const short = Buffer.from(CFB_CLEAR, "hex").subarray(0, 5);
		expect(new AesCfb8(CFB_KEY, CFB_IV).encrypt(short).toString("hex")).toBe(
			new AesCfb8(CFB_KEY, CFB_IV)
				.encrypt(Buffer.from(CFB_CLEAR, "hex"))
				.toString("hex")
				.slice(0, 10),
		);
	});

	it("stands of a chaining place of nothing where the reference hands none over", () => {
		const clear = Buffer.alloc(AES_BLOCK_SIZE, 0x00);
		const withPlace = new AesCfb8(CFB_KEY, CFB_IV).encrypt(clear);
		const without = new AesCfb8(CFB_KEY, null).encrypt(clear);
		expect(withPlace.equals(without)).toBe(false);
		expect(without.toString("hex")).toBe(
			new AesCfb8(CFB_KEY, Buffer.alloc(AES_BLOCK_SIZE, 0x00))
				.encrypt(clear)
				.toString("hex"),
		);
	});
});
