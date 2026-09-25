// The index and payload walks of the newer archives of the CVNS engine, against runs written in the test.
//
// The reference carries every one of the walks of the index **both ways** (`EncryptIndexStage1`,
// `EncryptIndexDirectory`, `EncryptIndexEntry` beside their counterparts), so every pair is held to its own
// inverse here, and the places of a run of each are held to a second transcription of the same source as
// well: a Python mirror of `ArcFormats/Cmvs/ArcCPZ.cs` written apart from this port. That mirror is what
// found the one place this port had dropped (the addend of the first walk) — the pair of the round trip
// alone would have caught it as well, which is the reason every walk below is carried twice.
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import { CMVS_CPZ5_SCHEME } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
import {
	decryptCpzIndexDirectory,
	decryptCpzIndexEntry,
	decryptCpzIndexStage1,
	decryptCpzPb3,
	decryptCpzPs2,
	encryptCpzIndexDirectory,
	encryptCpzIndexEntry,
	encryptCpzIndexStage1,
	encryptCpzPb3,
	unpackCpzIndexKey,
	unpackCpzPs2,
} from "../../packages/formats/src/cmvs/cpz5-index.js";

/** The key of the head of an archive the walks of the index stand of. */
const MASTER_KEY = 0x12345678;
/** The key of a directory, of the four words a run of its entries stands of. */
const DIR_KEY = [0x01020304, 0x11223344, 0x55667788, 0x99aabbcc];
/** The seed of the walk of the entries of a directory, off the scheme of the engine. */
const ENTRY_SEED = CMVS_CPZ5_SCHEME.indexSeed;

/** A run of places of the test: the places of it are read off the count rather than copied about. */
function run(count: number, base = 7, addend = 3): Buffer {
	return Buffer.from(
		[...Array(count).keys()].map((at) => (at * base + addend) & 0xff),
	);
}

/** Packs places lowest-first within a word of thirty two places, and the word from its lowest byte up. */
function packWords(bits: readonly number[]): Buffer {
	const words = Math.max(Math.ceil(bits.length / 32), 0);
	const output = Buffer.alloc(words * 4);
	bits.forEach((bit, index) => {
		if (0 === bit) return;
		const word = Math.floor(index / 32) * 4;
		output.writeUInt32LE(
			(output.readUInt32LE(word) | (1 << (index % 32))) >>> 0,
			word,
		);
	});
	return output;
}

/** The places of a leaf of a byte: a clear bit and the eight places of the place itself. */
function leaf(value: number): number[] {
	const bits: number[] = [0];
	for (let place = 7; place >= 0; place -= 1) {
		bits.push((value >>> place) & 1);
	}
	return bits;
}

/** The places of a place of two behind the tree: a set bit and the two places behind it. */
function node(left: readonly number[], right: readonly number[]): number[] {
	return [1, ...left, ...right];
}

describe("CVNS walk of the index", () => {
	it("turns the places of an index about, both ways", () => {
		const plain = run(19);
		const cipher = Buffer.from(plain);
		encryptCpzIndexStage1(cipher, MASTER_KEY, CMVS_CPZ5_SCHEME);
		// The places of the run, worked out apart from this port: the words of it and the three places of
		// its tail, which stand of a turn of their own.
		expect(cipher.toString("hex")).toBe(
			"f0fa99517c11165bd1daf60b416967d608921b",
		);
		const back = Buffer.from(cipher);
		decryptCpzIndexStage1(back, MASTER_KEY, CMVS_CPZ5_SCHEME);
		expect(back.equals(plain)).toBe(true);
		// A run of two words, of no tail at all, read the other way.
		const words = run(8, 1, 0);
		decryptCpzIndexStage1(words, MASTER_KEY, CMVS_CPZ5_SCHEME);
		expect(words.toString("hex")).toBe("2c67049c1a2a381e");
	});

	it("turns the places of a directory about, both ways", () => {
		const plain = run(19);
		const cipher = Buffer.from(plain);
		encryptCpzIndexDirectory(cipher, 19, DIR_KEY);
		expect(cipher.toString("hex")).toBe(
			"04765c9d0d5023731926c2721684ed54308e94",
		);
		const back = Buffer.from(cipher);
		decryptCpzIndexDirectory(back, 19, DIR_KEY, 0);
		expect(back.equals(plain)).toBe(true);
		const words = run(8, 1, 0);
		decryptCpzIndexDirectory(words, 8, DIR_KEY, 0);
		expect(words.toString("hex")).toBe("26721d45ddbd43d5");
	});

	it("stands of the key of the archive on the way in, and not on the way back", () => {
		// The reference adds the key of the archive to the seed of this walk on the way in alone, so the two
		// directions are each other's inverse for an archive whose key stands of nothing — the key of a stock
		// build of the engine — and part company for any other. Both places are kept as the reference writes
		// them, and this is what the difference comes to.
		const plain = run(19);
		const cipher = Buffer.from(plain);
		encryptCpzIndexDirectory(cipher, 19, DIR_KEY);
		const wrong = Buffer.from(cipher);
		decryptCpzIndexDirectory(wrong, 19, DIR_KEY, 5);
		expect(wrong.equals(plain)).toBe(false);
		expect(wrong.toString("hex")).toBe(
			"030a11181a262d3431424950485e656c737a81",
		);
	});

	it("turns the places of the entries of a directory about, both ways", () => {
		const plain = run(19);
		const cipher = Buffer.from(plain);
		encryptCpzIndexEntry(cipher, 3, 12, DIR_KEY, ENTRY_SEED);
		// The run stands within the places of the index about it, which this walk leaves as they stand.
		expect(cipher.subarray(0, 3).equals(plain.subarray(0, 3))).toBe(true);
		expect(cipher.subarray(15).equals(plain.subarray(15))).toBe(true);
		expect(cipher.toString("hex")).toBe(
			"030a1175e8c4a699c4b17cc17307266c737a81",
		);
		const back = Buffer.from(cipher);
		decryptCpzIndexEntry(back, 3, 12, DIR_KEY, ENTRY_SEED, 0);
		expect(back.equals(plain)).toBe(true);
		const words = run(16, 1, 0);
		decryptCpzIndexEntry(words, 0, 16, DIR_KEY, ENTRY_SEED, 0);
		expect(words.toString("hex")).toBe("66790a96c23483eb2b408c11980b55f7");
	});

	it("holds a run of the entries to the places it was read of", () => {
		// The reference throws of both a place behind the run and a count that runs past it.
		const words = run(16, 1, 0);
		expect(() => decryptCpzIndexEntry(words, 17, 4, DIR_KEY, 0, 0)).toThrow(
			GarbroError,
		);
		expect(() => decryptCpzIndexEntry(words, -1, 4, DIR_KEY, 0, 0)).toThrow(
			/stands outside/,
		);
		expect(() => decryptCpzIndexEntry(words, 8, 9, DIR_KEY, 0, 0)).toThrow(
			/runs past/,
		);
		expect(() => encryptCpzIndexEntry(words, 0, -1, DIR_KEY, 0)).toThrow(
			GarbroError,
		);
	});

	it("reads the key behind the index of the seventh layout", () => {
		// The head of a key of four places: the count of the places of the run at 0x10 of it, the key itself
		// at 0x14, and the run of the tree behind that, taken apart by the places of the key.
		const key = Buffer.from([0xd1, 0x9c, 0x3a, 0x77]);
		const wanted = Buffer.from("vkvk", "latin1");
		// A tree of two places, of 'k' to the left and 'v' to the right, and then the run of the tree: a
		// right place, a left one, and the same again.
		const packed = packWords([...node(leaf(0x6b), leaf(0x76)), 1, 0, 1, 0]);
		const block = Buffer.alloc(0x18 + packed.length, 0x00);
		block.writeInt32LE(wanted.length, 0x10);
		key.copy(block, 0x14);
		packed.copy(block, 0x18);
		for (let at = 0; at < packed.length; at += 1) {
			block[0x18 + at] = (block[0x18 + at] ?? 0) ^ (key[at & 3] ?? 0);
		}
		const out = unpackCpzIndexKey(block, 0, block.length);
		expect(out.equals(wanted)).toBe(true);
	});

	it("turns the places of a `PS2A` payload about, and walks the window behind them", () => {
		const body = run(0x50, 5, 1);
		const cipher = Buffer.from(body);
		decryptCpzPs2(cipher);
		// The places of the run, worked out apart from this port, of the key at 0x0c of the head.
		expect(cipher.toString("hex")).toBe(
			"01060b10151a1f24292e33383d42474c51565b60656a6f74797e83888d92979ca1a6abb0b5babfc4c9ced3d8dde2e7ec73f4768b0d8e008507981a9f119214a92bac2ea325a638bd3fb032b749ca4cc1",
		);
	});

	it("walks the window of a `PS2A` payload through the places of the head of it", () => {
		// The reference carries the walk of a payload of the engine one way alone, so the run of the test is
		// written through its inverse here: the bytes the walk of the window is to read, put behind the head
		// of the payload as the places a walk of the window of the engine would have left them.
		const literals = Buffer.from("PS2A-payload-literal-run!", "latin1");
		const declared = literals.length;
		// The walk of the window stands of a control place of eight flags, so a run longer than eight places
		// carries a control place of its own behind every eight of them.
		const body: number[] = [];
		for (let at = 0; at < declared; at += 1) {
			if (0 === at % 8) body.push(0xff);
			body.push(literals[at] ?? 0);
		}
		const plain = Buffer.alloc(0x30 + body.length, 0x00);
		plain.write("PS2A", 0, "latin1");
		plain.writeUInt32LE(0x00040000, 12);
		plain.writeInt32LE(declared, 0x28);
		Buffer.from(body).copy(plain, 0x30);
		// The inverse of `DecryptPs2`, written here: the turn of a place of a byte to the left, the key and
		// then the place the walk takes off.
		const key = plain.readUInt32LE(12);
		const shift = ((key >>> 20) % 5) + 1;
		const mixed = ((key >>> 24) + (key >>> 3)) >>> 0;
		for (let at = 0x30; at < plain.length; at += 1) {
			const turned =
				((plain[at] ?? 0) << shift) | ((plain[at] ?? 0) >>> (8 - shift));
			plain[at] = ((((turned & 0xff) ^ mixed) + 0x7c) & 0xff) >>> 0;
		}
		const out = unpackCpzPs2(plain);
		expect(out.length).toBe(0x30 + declared);
		expect(out.subarray(0x30).equals(literals)).toBe(true);
		expect(out.subarray(0, 4).toString("latin1")).toBe("PS2A");
	});

	it("turns the places of a `PB3B` payload about, both ways", () => {
		const body = run(0x80, 5, 1);
		const cipher = Buffer.from(body);
		encryptCpzPb3(cipher);
		const back = Buffer.from(cipher);
		decryptCpzPb3(back);
		expect(back.equals(body)).toBe(true);
		const read = run(0x80, 5, 1);
		decryptCpzPb3(read);
		// The places of the run, worked out apart from this port: the walk reads the places of its source out
		// of the tail of the run, so a run shorter than the places it reads of cannot be turned back.
		expect(read.toString("hex")).toBe(
			"01060b10151a1f24c5bea1aaa5868182655e614a45464122251e010a05e6e1e2c5bec1aaa5a6a182857e616a65464142251e210a050a0f14191e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dce1e6ebf0f5faff04090e13181d22272c31363b40454a4f54595e63686d72777c",
		);
	});
});
