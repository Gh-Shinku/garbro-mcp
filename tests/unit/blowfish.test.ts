import { Blowfish } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

function hexToWords(hex: string): [number, number] {
	const buffer = Buffer.from(hex, "hex");
	return [buffer.readUInt32BE(0), buffer.readUInt32BE(4)];
}

function wordsToHex([left, right]: [number, number]): string {
	const buffer = Buffer.alloc(8);
	buffer.writeUInt32BE(left >>> 0, 0);
	buffer.writeUInt32BE(right >>> 0, 4);
	return buffer.toString("hex");
}

describe("Blowfish codec", () => {
	// Vectors verified against `openssl enc -bf-ecb -provider legacy` (which zero-pads keys to its
	// fixed 16-byte length) plus the classic reference vector for an 8-byte key.
	const vectors: {
		key: string;
		plain: string;
		cipher: string;
		note?: string;
	}[] = [
		{
			key: "0000000000000000",
			plain: "0000000000000000",
			cipher: "4ef997456198dd78",
		},
		{
			key: "ffffffffffffffff",
			plain: "ffffffffffffffff",
			cipher: "51866fd5b85ecb8a",
			note: "classic 8-byte key vector",
		},
		{
			key: "0123456789abcdef",
			plain: "1111111111111111",
			cipher: "61f9c3802281b096",
			note: "classic 8-byte key vector",
		},
		{
			key: "0123456789abcdeffedcba9876543210",
			plain: "0000000000000000",
			cipher: "4e1cb595fca184b4",
		},
		{
			key: "000102030405060708090a0b0c0d0e0f",
			plain: "1111111111111111",
			cipher: "3811554092a56735",
		},
		{
			key: "deadbeefcafebabe0011223344556677",
			plain: "0123456789abcdef",
			cipher: "7ee0baf6c684d74c",
		},
	];

	it("enciphers the reference vectors", () => {
		for (const vector of vectors) {
			const blowfish = new Blowfish(Buffer.from(vector.key, "hex"));
			expect(
				wordsToHex(blowfish.encipherWords(...hexToWords(vector.plain))),
				vector.key,
			).toBe(vector.cipher);
		}
	});

	it("deciphers what it enciphered at the word level", () => {
		const blowfish = new Blowfish(Buffer.from("0123456789abcdef", "hex"));
		const enciphered = blowfish.encipherWords(0x01234567, 0x89abcdef);
		expect(blowfish.decipherWords(...enciphered)).toEqual([
			0x01234567, 0x89abcdef,
		]);
	});

	it("deciphers blocks with the little-endian halves GARbro uses", () => {
		const blowfish = new Blowfish(Buffer.from("0011223344556677", "hex"));
		const [left, right] = blowfish.encipherWords(0x11223344, 0x55667788);
		const encrypted = Buffer.alloc(8);
		encrypted.writeUInt32LE(left, 0);
		encrypted.writeUInt32LE(right, 4);
		const decrypted = blowfish.decipherBlocks(encrypted);
		expect(decrypted.readUInt32LE(0)).toBe(0x11223344);
		expect(decrypted.readUInt32LE(4)).toBe(0x55667788);
	});

	it("rejects empty keys and non-block-aligned input", () => {
		expect(() => new Blowfish(Buffer.alloc(0))).toThrow(/empty/);
		const blowfish = new Blowfish(Buffer.alloc(8));
		expect(() => blowfish.decipherBlocks(Buffer.alloc(7))).toThrow(
			/multiple of 8/,
		);
	});
});
