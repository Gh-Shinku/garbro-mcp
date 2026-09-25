// The dword walk of the CVNS engine, held to a second transcription of the same source and to the two
// directions the reference carries of the walk.
//
// The reference carries the walk backwards as well as forwards (`Cpz5Decoder.Encode` and
// `Cpz5Decoder.EncryptEntry` beside `Decode` and `DecryptEntry`), which no other cipher of the engines this
// project reads does, so the strongest thing this test can say of the walk is that the two directions are
// each other's inverse - over a run of a whole count of words, over a tail shorter than one, and over the
// places of a scheme whose secret stands shorter than the sixteen words the walk reads. The places
// themselves are held to a second transcription of `ArcFormats/Cmvs/ArcCPZ.cs`, worked out outside this
// package, since no engine outside the reference stands of this walk.
import { Buffer } from "node:buffer";
import {
	CMVS_CPZ5_SCHEME,
	Cpz5Decoder,
	type Cpz5Scheme,
	initCpz5Table,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const KEY = 0x12345678;
const SUMMAND = 0x9abcdef0;
const DIGEST = [0x00112233, 0x44556677, 0x8899aabb, 0xccddeeff];
const SEED = 0x5a5a5a5a;

/** The places of a run of the test, of a count of them read from the lowest place of a byte up. */
function run(places: number): Buffer {
	return Buffer.from(
		[...Array(places).keys()].map((at) => (at * 7 + 1) & 0xff),
	);
}

const TABLE = [
	"f6510413b7ff52b0822b195731ee1449db8a617217b411d21ba6544a1cb16e9b858128e3937001ed120068bc73d95c05bac023dddca5891fc8560ce047a358505941f1d7a744d6422c86f7088f87d84fa8e5cc06d3ebe148b85f335a9e905e64fc0dab21d4208429cd966f6b91c5748c8e357ceacb4bf377b56d303d60cf7999c475dfbea43af424e2c92a156762c27a1efde4944cb280692e18da8b0a7bc1cabbaf3c1a958db97d6583ac1045973bd03f0b53c7030eec397e2f0932784363bf5b0fa2c63e9c266cf2fb372d4d980734a9d1e822fee9f8f9a19f9db3f0e6aece4eefe702f576ad5d7fd5a0c3b638466a92de27bd25aa401d6688165571fa369a",
].join("");

/** The scheme of the engine, of the secret of the reference. */
const SCHEME: Cpz5Scheme = CMVS_CPZ5_SCHEME;

describe("CVNS dword walk", () => {
	it("stands of a table of the places of a byte of the reference", () => {
		const table = initCpz5Table(SCHEME, KEY, SUMMAND);
		expect(Buffer.from(table).toString("hex")).toBe(TABLE);
		// The table of the walk stands of swaps of its own place of every place, so it is a permuting of the
		// places of a byte whatever the key and the place behind it are.
		expect([...table].sort((left, right) => left - right)).toEqual(
			Array.from({ length: 256 }, (_value, place) => place),
		);
		expect(
			[...initCpz5Table(SCHEME, 0, 0)].sort((left, right) => left - right),
		).toEqual(Array.from({ length: 256 }, (_value, place) => place));
	});

	it("walks a run of the places of a table both ways", () => {
		// `Decode` stands of the table over the place of a key, and `Encode` of the table backwards: over a
		// run of the places of the table the two are each other's inverse.
		const decoder = new Cpz5Decoder(SCHEME, KEY, SUMMAND);
		const clear = run(40);
		const decoded = Buffer.from(clear);
		decoder.decode(decoded, 0, decoded.length, 0x3c);
		expect(decoded.toString("hex")).toBe(
			"a3dcdd68811bd214ff603d7c96fc64e187a7d7090b657dc1b26715df88926aade6fe22370fc81f5c",
		);
		const again = Buffer.from(decoded);
		decoder.encode(again, 0, again.length, 0x3c);
		expect(again.toString("hex")).toBe(clear.toString("hex"));
	});

	it("walks the places of an entry both ways", () => {
		// `DecryptEntry` stands of a secret of the scheme, of the digest of the head of the archive and of a
		// seed, over the words of the run and then over a tail shorter than a word of its own.
		const decoder = new Cpz5Decoder(SCHEME, 0x2547a39e, 0x1a743125);
		const clear = run(23);
		const written = Buffer.from(clear);
		decoder.encryptEntry(written, DIGEST, SEED);
		expect(written.toString("hex")).toBe(
			"7aea9e9daa2c9ce42dfe5efe6a2777be045f76146249ef",
		);
		const read = Buffer.from(written);
		decoder.decryptEntry(read, DIGEST, SEED);
		expect(read.toString("hex")).toBe(clear.toString("hex"));
		// The other direction stands of the same places as well.
		const back = Buffer.from(read);
		decoder.encryptEntry(back, DIGEST, SEED);
		expect(back.equals(written)).toBe(true);
	});

	it("stands of the words past a shorter secret as the seed of the walk", () => {
		// A scheme whose secret stands shorter than the sixteen words the walk reads leaves the words behind
		// it at the seed, which the two directions stand of alike.
		const short: Cpz5Scheme = {
			...SCHEME,
			secret: SCHEME.secret.slice(0, 2),
		};
		const decoder = new Cpz5Decoder(short, 0x2547a39e, 0x1a743125);
		for (const places of [0, 3, 4, 15, 16, 64]) {
			const clear = run(places);
			const written = Buffer.from(clear);
			decoder.encryptEntry(written, DIGEST, SEED);
			const read = Buffer.from(written);
			decoder.decryptEntry(read, DIGEST, SEED);
			expect(read.toString("hex")).toBe(clear.toString("hex"));
		}
		// A scheme of a secret of the length of the walk stands of the same places as one of every one of
		// them, since the reference reads sixteen words of it alone.
		const long = new Cpz5Decoder(
			{ ...SCHEME, secret: SCHEME.secret },
			0x2547a39e,
			0x1a743125,
		);
		const clear = run(32);
		const written = Buffer.from(clear);
		long.encryptEntry(written, DIGEST, SEED);
		const read = Buffer.from(written);
		decoder.decryptEntry(read, DIGEST, SEED);
		expect(read.equals(Buffer.from(clear))).toBe(false);
	});
});
