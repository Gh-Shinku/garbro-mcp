// The head of the newer archives of the CVNS engine, against heads built in the test: the places of the
// fields stand of the version the mark spells, and the head is held to a sum of its own places.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	cpzChecksum,
	readCpzHeader,
	verifyCpzIndex,
} from "../../packages/formats/src/cmvs/cpz5-header.js";

/** The places of the head of every layout, and of the sum of it. */
const HEAD_SIZE = 0x40;
const HEAD_SIZE_LONG = 0x48;
const SUM_PLACES = 0x3c;
const SUM_PLACES_LONG = 0x40;
const SUM_START = 0x923a564c;

interface HeadFixture {
	version: number;
	dirCount?: number;
	dirEntriesSize?: number;
	fileEntriesSize?: number;
	masterKey?: number;
	encrypted?: boolean;
	digest?: readonly number[];
	entryKey?: number;
	/** The count of the places of the key behind the index, of the seventh layout. */
	indexKeySize?: number;
	/** The digest of the head of the index, which stands at 0x10 of the head. */
	indexMd5?: Buffer;
}

/** The sum of the first places of a head, worked out here rather than read off the port. */
function sumOf(data: Buffer, length: number, start: number): number {
	let sum = start >>> 0;
	let at = 0;
	for (; at + 4 <= length; at += 4) sum = (sum + data.readUInt32LE(at)) >>> 0;
	for (; at < length; at += 1) sum = (sum + (data[at] ?? 0)) >>> 0;
	return sum;
}

/** A head of the engine, of the places of its fields taken apart the way the reference takes them. */
function buildHead(input: HeadFixture): Buffer {
	const old = input.version < 6;
	const long = input.version >= 7;
	const head = Buffer.alloc(long ? HEAD_SIZE_LONG : HEAD_SIZE, 0x00);
	head.write(`CPZ${input.version}`, 0, "latin1");
	head.writeInt32LE((input.dirCount ?? 3) ^ (old ? -0x1c5ac27 : -0x1c5ac26), 4);
	head.writeInt32LE(
		(input.dirEntriesSize ?? 0x20) ^ (old ? 0x37f298e7 : 0x37f298e8),
		8,
	);
	head.writeInt32LE(
		(input.fileEntriesSize ?? 0x40) ^ (old ? 0x7a6f3a2c : 0x7a6f3a2d),
		0x0c,
	);
	(input.indexMd5 ?? Buffer.alloc(0x10, 0x11)).copy(head, 0x10, 0, 0x10);
	head.writeUInt32LE(
		((input.masterKey ?? 0x11223344) ^ (old ? 0xae7d39bf : 0xae7d39b7)) >>> 0,
		0x30,
	);
	head.writeUInt32LE(
		((input.encrypted ? 1 : 0) ^ (old ? 0xfb73a955 : 0xfb73a956)) >>> 0,
		0x34,
	);
	(input.digest ?? [1, 2, 3, 4]).forEach((word, at) => {
		head.writeUInt32LE(
			(word ^ ((old ? 0x43de7c19 : 0x43de7c1a) + at)) >>> 0,
			0x20 + at * 4,
		);
	});
	if (!old) {
		head.writeUInt32LE(
			((input.entryKey ?? 0x12345678) ^ 0x37acf832) >>> 0,
			0x38,
		);
	}
	let initChecksum = SUM_START;
	if (long) {
		const size = input.indexKeySize ?? 0x20;
		head.writeInt32LE((size ^ 0x65ef99f3) | 0, 0x40);
		initChecksum = ((size ^ 0x65ef99f3) - 0x6dc5a9b4) >>> 0;
	}
	head.writeUInt32LE(
		sumOf(head, long ? SUM_PLACES_LONG : SUM_PLACES, initChecksum),
		long ? 0x44 : 0x3c,
	);
	return head;
}

/** The places of the run of an index, and the key behind them where the layout stands of one. */
function indexPlaces(places: number, key?: Buffer): Buffer {
	const body = Buffer.from(
		[...Array(places).keys()].map((at) => (at * 13 + 7) & 0xff),
	);
	if (!key) return body;
	return Buffer.concat([body, createHash("md5").update(key).digest(), key]);
}

describe("CVNS CPZ head", () => {
	it("reads the head of the layout of the mark `CPZ5`", () => {
		const head = readCpzHeader(
			buildHead({
				version: 5,
				dirCount: 7,
				dirEntriesSize: 0x20,
				fileEntriesSize: 0x40,
				masterKey: 0xdeadbeef,
				encrypted: true,
				digest: [0xaa, 0xbb, 0xcc, 0xdd],
				indexMd5: Buffer.alloc(0x10, 0x5a),
			}),
		);
		if (!head) throw new Error("no head");
		expect(head.version).toBe(5);
		expect(head.dirCount).toBe(7);
		expect(head.dirEntriesSize).toBe(0x20);
		expect(head.fileEntriesSize).toBe(0x40);
		expect(head.masterKey).toBe(0xdeadbeef);
		expect(head.isEncrypted).toBe(true);
		expect(head.digest).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
		expect(head.indexOffset).toBe(HEAD_SIZE);
		expect(head.indexSize).toBe(0x60);
		expect(head.entryKey).toBe(0);
		expect(head.entryNameOffset).toBe(0x18);
		expect(head.isLongSize).toBe(false);
		expect(head.indexMd5.equals(Buffer.alloc(0x10, 0x5a))).toBe(true);
	});

	it("reads the head of the layouts of the marks `CPZ6` and `CPZ7`", () => {
		// The newer layouts stand of a key of the entries of their own, of a turn of the key of the head.
		const entryKey = 0x12345678;
		const six = readCpzHeader(buildHead({ version: 6, entryKey }));
		if (!six) throw new Error("no head");
		const turn = ((entryKey >>> 5) | (entryKey << 27)) >>> 0;
		expect(six.entryKey).toBe((0x13712765 + Math.imul(0x7da8f173, turn)) >>> 0);
		expect(six.entryKey).not.toBe(0);
		expect(six.isLongSize).toBe(false);
		expect(six.indexKeySize).toBe(0);
		// The seventh layout names the count of the places of the key of its index as well, of a count of
		// its own the sum of its head begins at.
		const keySize = 0x30;
		const seven = readCpzHeader(
			buildHead({ version: 7, entryKey, indexKeySize: keySize }),
		);
		if (!seven) throw new Error("no head");
		expect(seven.version).toBe(7);
		expect(seven.indexKeySize).toBe(keySize);
		expect(seven.initChecksum).toBe(
			((keySize ^ 0x65ef99f3) - 0x6dc5a9b4) >>> 0,
		);
		expect(seven.indexOffset).toBe(HEAD_SIZE_LONG);
		expect(seven.indexSize).toBe((0x20 + 0x40 + keySize) >>> 0);
		expect(seven.entryNameOffset).toBe(0x1c);
		expect(seven.isLongSize).toBe(true);
		expect(seven.entryKey).toBe(six.entryKey);
	});

	it("turns away a head of a sum of its own that does not stand", () => {
		const good = buildHead({ version: 5 });
		expect(readCpzHeader(good)).toBeDefined();
		const wrong = Buffer.from(good);
		wrong.writeUInt32LE((wrong.readUInt32LE(0x3c) + 1) >>> 0, 0x3c);
		expect(readCpzHeader(wrong)).toBeUndefined();
		// A head that stands short of the places of its own version, and a mark of another engine.
		expect(readCpzHeader(good.subarray(0, HEAD_SIZE - 1))).toBeUndefined();
		const other = Buffer.from(good);
		other.write("CPX5", 0, "latin1");
		expect(readCpzHeader(other)).toBeUndefined();
		const digit = Buffer.from(good);
		digit.write("CPZX", 0, "latin1");
		expect(readCpzHeader(digit)).toBeUndefined();
		// The sum stands of the places of the head, which the port works out of the same places.
		expect(cpzChecksum(good, 0, SUM_PLACES, SUM_START)).toBe(
			sumOf(good, SUM_PLACES, SUM_START),
		);
	});

	it("holds the places of an index to the digest of the head", () => {
		const entries = 0x30;
		const index = indexPlaces(entries);
		const head = readCpzHeader(
			buildHead({
				version: 5,
				dirEntriesSize: 0x10,
				fileEntriesSize: 0x20,
				indexMd5: createHash("md5").update(index).digest(),
			}),
		);
		if (!head) throw new Error("no head");
		expect(head.indexSize).toBe(entries);
		expect(verifyCpzIndex(head, index)).toBe(true);
		expect(verifyCpzIndex(head, index.subarray(0, index.length - 1))).toBe(
			false,
		);
		const changed = Buffer.from(index);
		changed[0x11] = (changed[0x11] ?? 0) ^ 0xff;
		expect(verifyCpzIndex(head, changed)).toBe(false);
	});

	it("holds the key behind the index of the seventh layout to its own digest", () => {
		// The places of the older layouts end with the entries of the index; the seventh stands of a key
		// behind them, of the digest of that key at the head of it.
		const entries = 0x20;
		const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		const index = indexPlaces(entries, key);
		const head = readCpzHeader(
			buildHead({
				version: 7,
				dirEntriesSize: 0x10,
				fileEntriesSize: 0x10,
				indexKeySize: 0x10 + key.length,
				indexMd5: createHash("md5").update(index).digest(),
			}),
		);
		if (!head) throw new Error("no head");
		expect(index.length).toBe(head.indexSize);
		expect(verifyCpzIndex(head, index)).toBe(true);
		const other = indexPlaces(
			entries,
			Buffer.from("ffeeddccbbaa99887766554433221100", "hex"),
		);
		expect(verifyCpzIndex(head, other)).toBe(false);
	});
});
