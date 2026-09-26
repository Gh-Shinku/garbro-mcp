// The BSHF cipher of the Entis GLS engine, against the permutation the reference's own walk builds: a
// password of no bytes leaves every bit where it was, a password of ones takes the places in a hand-computed
// order, and every password is a permutation of the two hundred and fifty six bits of a block.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	BshfDecodeContext,
	decodeBshf,
	decodeBshfBuffer,
	prepareBshfPassword,
} from "@garbro-mcp/codecs";

/** A source block whose bytes stand in a pattern that makes a misplaced bit visible. */
function sourceBlock(): Buffer {
	const source = Buffer.alloc(32, 0);
	for (let at = 0; at < source.length; at += 1) {
		source[at] = (at * 37 + 11) & 0xff;
	}
	return source;
}

describe("BSHF cipher of the Entis GLS engine", () => {
	it("expands a short password with the marker and the running sum", () => {
		// Three bytes and then the marker `0x1b`, and every byte behind it the sum of the byte the count wraps
		// to and the byte before it: 0x61 + 0x1b, 0x62 + 0x7c, 0x63 + 0xde, 0x1b + 0x41.
		const bytes = prepareBshfPassword("abc");
		expect(bytes.length).toBe(32);
		expect([...bytes.subarray(0, 8)]).toEqual([
			0x61, 0x62, 0x63, 0x1b, 0x7c, 0xde, 0x41, 0x5c,
		]);
	});

	it("keeps a password of thirty two bytes or more as it stands", () => {
		const long = "0123456789abcdef0123456789abcdef";
		const bytes = prepareBshfPassword(long);
		expect(bytes.length).toBe(32);
		expect(Buffer.from(bytes).toString("latin1")).toBe(long);
		// One byte more stands as it is too, with no marker and no sum.
		const longer = prepareBshfPassword(`${long}x`);
		expect(longer.length).toBe(33);
		expect(longer[32]).toBe(0x78);
	});

	it("takes an empty password as a space, and a character outside ASCII as a question mark", () => {
		expect([...prepareBshfPassword("").subarray(0, 3)]).toEqual([
			0x20, 0x1b, 0x3b,
		]);
		expect([...prepareBshfPassword("é").subarray(0, 3)]).toEqual([
			0x3f, 0x1b, 0x5a,
		]);
	});

	it("takes the places of a password of no bytes in the order of its own scan", () => {
		// The counter stands still, but the scan moves on from the place the bit before took, so the first
		// eight bits of the source land in the first byte of the block in reverse order and the bits behind
		// them land where the scan reaches next, byte by byte, eight places at a step.
		const password = prepareBshfPassword("\0".repeat(32));
		const at = (index: number): number[] => {
			const source = Buffer.alloc(32, 0);
			source[index >> 3] = 0x80 >> (index & 7);
			return [...decodeBshfBuffer(password, source, 0)];
		};
		const placeOf = (index: number): string => {
			const decoded = at(index);
			const which = decoded.findIndex((byte) => 0 !== byte);
			return `${which}:${(decoded[which] ?? 0).toString(16)}`;
		};
		expect(placeOf(0)).toBe("0:80");
		expect(placeOf(7)).toBe("0:1");
		// The counter reaches the first byte, finds it full, and steps eight places on: the ninth bit of the
		// source lands in the second byte at the low place its own counter names, and the bits behind it fill
		// the third byte from the high place down.
		expect(placeOf(8)).toBe("1:1");
		expect(placeOf(9)).toBe("3:80");
		expect(placeOf(16)).toBe("3:1");
		expect(placeOf(17)).toBe("4:1");
		expect(placeOf(18)).toBe("6:80");
		const source = sourceBlock();
		expect([...decodeBshfBuffer(password, source, 0)]).not.toEqual([...source]);
		expect([...decodeBshf(source, "\0".repeat(32), 32)]).toEqual([
			...decodeBshfBuffer(password, source, 0),
		]);
	});

	it("takes the places a password of ones names, high bits first and backwards", () => {
		// The counter is the password byte of every step: it starts at two hundred and fifty five and counts
		// down, so the first eight bits of the source land in the last byte, the first of them in its lowest
		// place. A password byte of `0xff` is not one a text can carry — an ASCII password turns every wide
		// character into a question mark — so the block is decoded from the expanded password directly.
		const password = new Uint8Array(32).fill(0xff);
		const first = Buffer.alloc(32, 0);
		first[0] = 0x80;
		const decodedFirst = decodeBshfBuffer(password, first, 0);
		expect(decodedFirst[31]).toBe(0x01);
		const last = Buffer.alloc(32, 0);
		last[0] = 0x01;
		const decodedLast = decodeBshfBuffer(password, last, 0);
		expect(decodedLast[31]).toBe(0x80);
	});

	it("moves every bit of a block to a place of its own", () => {
		// A permutation: one bit in gives one bit out, and the two hundred and fifty six single bit sources
		// give two hundred and fifty six different places.
		const password = new Uint8Array(32).fill(0xff);
		const seen = new Set<string>();
		let weight = 0;
		for (let index = 0; index < 256; index += 1) {
			const source = Buffer.alloc(32, 0);
			source[index >> 3] = 0x80 >> (index & 7);
			const decoded = decodeBshfBuffer(password, source, 0);
			const set = [...decoded].filter((byte) => 0 !== byte).length;
			weight += set;
			expect(set).toBe(1);
			const bits = [...decoded].reduce(
				(total, byte) => total + byte.toString(2).split("1").length - 1,
				0,
			);
			expect(bits).toBe(1);
			seen.add(Buffer.from(decoded).toString("hex"));
		}
		expect(seen.size).toBe(256);
		expect(weight).toBe(256);
	});

	it("walks the password forward for every block", () => {
		const password = "0123456789abcdef0123456789abcdef!";
		const source = sourceBlock();
		const doubled = Buffer.concat([source, source]);
		const decoded = decodeBshf(doubled, password, 64);
		// The first block starts at the first place of the password, so it is the block decoded on its own.
		expect([...decoded.subarray(0, 32)]).toEqual([
			...decodeBshfBuffer(prepareBshfPassword(password), source, 0),
		]);
		// The second block starts one place further, so the same source bytes come out differently.
		expect([...decoded.subarray(32, 64)]).not.toEqual([
			...decoded.subarray(0, 32),
		]);
		expect([...decoded.subarray(32, 64)]).toEqual([
			...decodeBshfBuffer(prepareBshfPassword(password), source, 1),
		]);
	});

	it("hands a block out in as many calls as the caller asks for", () => {
		const password = "\0".repeat(32);
		const source = sourceBlock();
		const expected = decodeBshfBuffer(prepareBshfPassword(password), source, 0);
		const context = new BshfDecodeContext(password, source);
		const output = Buffer.alloc(32, 0);
		expect(context.decodeBshfCodeBytes(output, 0, 20)).toBe(20);
		expect(context.decodeBshfCodeBytes(output, 20, 12)).toBe(12);
		expect([...output]).toEqual([...expected]);
	});

	it("drops a block that stands short, and turns away a stream that runs out", () => {
		const password = "\0".repeat(32);
		const source = sourceBlock();
		const short = Buffer.concat([source, source.subarray(0, 8)]);
		// The first block is whole, so the first thirty two bytes can be read.
		expect([...decodeBshf(short, password, 32)]).toEqual([
			...decodeBshfBuffer(prepareBshfPassword(password), source, 0),
		]);
		// The eight bytes behind it are not a block, so a longer read runs out.
		expect(() => decodeBshf(short, password, 64)).toThrow();
	});
});
