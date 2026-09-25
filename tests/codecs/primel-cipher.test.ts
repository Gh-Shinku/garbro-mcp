// The three ciphers of the Primel engine, held to the tables read out of the reference and to a second
// transcription of the same source.
//
// The engine keeps no inverse of any of the three and no other engine stands of them, so there is no anchor
// outside the reference for the walks themselves: the expectations here stand of the same source as the port,
// worked out a second time outside this package. What can be held on its own is held on its own: the tables
// of the reference are permutings of the places of a byte, of a word over every one of them, and the fold the
// two newer ciphers stand of stands of the count of the places of a word in its low places, against a count
// worked out here.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
	type PrimelCipherScheme,
	PrimelCipher,
	PRIMEL_BLOCK_SIZE,
	PRIMEL_BYTE_MAP,
	PRIMEL_CODE_TABLE,
	PRIMEL_DEFAULT_KEY,
	PRIMEL_OFFSETS,
	primelFoldedPlaces,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const KEY = Buffer.from([...Array(16).keys()]);
const IV = Buffer.from([...Array(16).keys()].map((place) => place + 16));
const PLACES = 50;
const DATA = Buffer.from(
	[...Array(PLACES).keys()].map((place) => (place * 7 + 3) & 0xff),
);

/** The places of the pictures of the three ciphers over fifty places, of three blocks and a tail of two. */
const VECTORS: readonly (readonly [PrimelCipherScheme, string])[] = [
	[
		1,
		"ec5ea50df24763d30ec89084843bca7dcff55797690409009dc2925fffe8267e2f0b16b7c92409405d42d37fbf48215e535a",
	],
	[
		2,
		"2e81bf45f44dbe09b75ef6410effc966ca2a2cbe6d0fd41bf9945eb5d03402842a8943bf8d2f141a245535baf58c2285535a",
	],
	[
		3,
		"c37d0cfab83aaf5124d1ce5e840e019626dae4f2bf7066de6577b32dbc97351616ac35cbfa3845371d10cbba1bdefb8c535a",
	],
];

/** The count of the places of a word, of the places of it one at a time. */
function countPlaces(word: number): number {
	let count = 0;
	for (let place = 0; place < 32; place += 1) {
		if (0 !== ((word >>> place) & 1)) count += 1;
	}
	return count;
}

describe("Primel ciphers", () => {
	it("stands of the tables of the reference", () => {
		// The tables stand of the places of the source as they came: the word below is the word of the tables
		// as they stand here, of a comma between the places and a row per row, so a table read out of the
		// reference wrongly, or reordered, stands out.
		const canonical = JSON.stringify({
			defaultKey: [...PRIMEL_DEFAULT_KEY],
			codeTable: PRIMEL_CODE_TABLE.map((row) => [...row]),
			offsets: [...PRIMEL_OFFSETS],
			byteMap: PRIMEL_BYTE_MAP.map((row) => [...row]),
		});
		expect(createHash("sha256").update(canonical).digest("hex")).toBe(
			"4643fc2ab928195423aedc7788270b6984c41de9d3a44cd08703c06687e7d7fc",
		);
		// Every row of the table of a key and of the tables of the places of a byte is a permuting of the
		// places of a byte, which a table of the places of a code has to be.
		for (const row of [...PRIMEL_CODE_TABLE, ...PRIMEL_BYTE_MAP]) {
			expect([...row].sort((left, right) => left - right)).toEqual(
				Array.from({ length: 256 }, (_value, place) => place),
			);
		}
		expect(PRIMEL_DEFAULT_KEY.length).toBe(8);
		expect(PRIMEL_OFFSETS.length).toBe(128);
		for (const place of PRIMEL_OFFSETS) {
			expect(place).toBeLessThan(8);
		}
	});

	it("stands of the count of the places of a word in its low places", () => {
		// The reference adds the two halves of the folded word without clearing the higher one, so the value
		// stands of the count of the places in its low places and of the halves of the count over them. The
		// ciphers mask the low four or five places of it alone, where the test holds it to a count of its own.
		const words = [
			0xffffffff, 0x00000000, 0x80000000, 0x7f7f7f7f, 0x01020304, 0xffff0000,
		];
		for (const word of words) {
			expect(primelFoldedPlaces(word) & 0x1f).toBe(countPlaces(word) & 0x1f);
			expect(primelFoldedPlaces(word) & 0x0f).toBe(countPlaces(word) & 0x0f);
		}
		expect(primelFoldedPlaces(0xffffffff)).toBe(1048608);
		expect(primelFoldedPlaces(0x80000000)).toBe(65537);
	});

	it("turns a run of places out of the blocks of its own walk", () => {
		for (const [scheme, expected] of VECTORS) {
			expect(
				new PrimelCipher(scheme, KEY, IV).transformBlock(DATA).toString("hex"),
			).toBe(expected.slice(0, 2 * 3 * PRIMEL_BLOCK_SIZE));
			// The walk of the reference turns the whole blocks out and leaves a tail shorter than a block
			// where it stands.
			expect(
				new PrimelCipher(scheme, KEY, IV)
					.transformFinalBlock(DATA)
					.toString("hex"),
			).toBe(expected);
		}
	});

	it("stands of a tail shorter than a block as it came", () => {
		const short = Buffer.from("0102030405060708", "hex");
		for (const [scheme] of VECTORS) {
			expect(
				new PrimelCipher(scheme, KEY, IV)
					.transformFinalBlock(short)
					.toString("hex"),
			).toBe(short.toString("hex"));
			expect(
				new PrimelCipher(scheme, KEY, IV).transformFinalBlock(Buffer.alloc(0))
					.length,
			).toBe(0);
		}
	});

	it("feeds its own input back into the chaining place", () => {
		// The chaining place of the reference stands of the block it read rather than of the block it turned
		// out, so over a clear text it is not CFB and the walk is not an involution: the engine reads an
		// archive with it, of the direction that stands of a cipher text.
		const once = new PrimelCipher(1, KEY, IV).transformFinalBlock(DATA);
		const twice = new PrimelCipher(1, KEY, IV).transformFinalBlock(once);
		expect(twice.equals(DATA)).toBe(false);
		expect(once.equals(DATA)).toBe(false);
	});
});
