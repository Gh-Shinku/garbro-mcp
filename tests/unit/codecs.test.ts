import {
	adler32,
	Adler32,
	crc32,
	crc32Normal,
	desDecryptBlock,
	desEcbDecrypt,
	desEncryptBlock,
	expandNibbleKey,
	inflateZlibBuffer,
} from "@garbro-mcp/codecs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("codecs", () => {
	it("computes the standard CRC-32 check vector", () => {
		expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
	});

	it("computes the CRC-32 of the normal polynomial", () => {
		// The normal polynomial stands the other way round, so the same string gives another value than the
		// check vector of the reflected one.
		expect(crc32Normal(Buffer.from("123456789"))).toBe(0x89a1897f);
		expect(crc32Normal(Buffer.alloc(0))).toBe(0);
		expect(crc32Normal(Buffer.from("123456789"), 0xffffffff)).toBe(0x0376e6e7);
	});

	it("computes Adler-32 incrementally with unsigned overflow semantics", () => {
		const first = Buffer.from("Wikipedia");
		expect(adler32(first)).toBe(0x11e60398);
		const incremental = new Adler32()
			.update(first.subarray(0, 4))
			.update(first.subarray(4));
		expect(incremental.value).toBe(0x11e60398);
		expect(incremental.hex).toBe("11e60398");
	});

	it("stands a block under the standard cipher and stands it back", () => {
		// The vector of the standard itself, whose key, block and block under the key are the numbers of its
		// own test.
		const key = Buffer.from("0123456789abcdef", "hex");
		const block = Buffer.from("4e6f772069732074", "hex");
		const cipher = Buffer.from("3fa40e8a984d4815", "hex");
		expect(desEncryptBlock(block, key)).toEqual(cipher);
		expect(desDecryptBlock(cipher, key)).toEqual(block);
		expect(
			desEncryptBlock(
				Buffer.from("0123456789abcdef", "hex"),
				Buffer.from("133457799bbcdff1", "hex"),
			).toString("hex"),
		).toBe("85e813540f0ab405");
		// The two vectors of the command line of the standard cipher, which stands the same blocks under the
		// same keys.
		expect(
			desEncryptBlock(
				Buffer.alloc(8, 0x00),
				Buffer.from("0011223344556677", "hex"),
			).toString("hex"),
		).toBe("2462db7fdc0060da");
		expect(
			desEncryptBlock(
				Buffer.from("deadbeefcafebabe", "hex"),
				Buffer.from("a1b2c3d4e5f60718", "hex"),
			).toString("hex"),
		).toBe("e13ddb5da91a05b6");
	});

	it("stands every whole block of a stream under the standard cipher", () => {
		const key = Buffer.from("0011223344556677", "hex");
		const plain = Buffer.from("deadbeefcafebabe0102030405060708", "hex");
		const cipher = Buffer.from("fc2f35623a31f19de404f3df18a4531b", "hex");
		expect(desEcbDecrypt(cipher, key)).toEqual(plain);
		expect(desEcbDecrypt(cipher.subarray(0, 8), key)).toEqual(
			plain.subarray(0, 8),
		);
		// The places of a block that do not stand whole stand as they stand.
		const short = Buffer.concat([
			cipher.subarray(0, 8),
			Buffer.from("0102030405", "hex"),
		]);
		expect(desEcbDecrypt(short, key)).toEqual(
			Buffer.concat([plain.subarray(0, 8), Buffer.from("0102030405", "hex")]),
		);
	});

	it("stands the four low places of every place of a key as the places of a key of its own", () => {
		// The key the reference stands its own pictures under stops at the place that holds nought.
		expect(
			expandNibbleKey(
				Buffer.from([15, 0, 1, 2, 8, 5, 10, 11, 5, 9, 14, 13, 1, 8, 0, 6]),
			).toString("hex"),
		).toBe("f000000000000000");
		// Every place of a colour stands as its four low places, the last place of a key that holds four
		// groups of places standing as four places of nought.
		expect(
			expandNibbleKey(
				Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
			).toString("hex"),
		).toBe("123456789abcdef0");
	});

	it("inflates zlib buffers and validates the declared output length", async () => {
		const input = Buffer.from("streamed zlib fixture");
		await expect(
			inflateZlibBuffer(deflateSync(input), input.length),
		).resolves.toEqual(input);
		await expect(
			inflateZlibBuffer(deflateSync(input), input.length - 1),
		).rejects.toThrow();
	});
});
