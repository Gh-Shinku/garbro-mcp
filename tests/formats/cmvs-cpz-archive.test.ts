// The archive of the newer layouts of the CVNS engine, against archives built in the test: a head of the
// layouts below the seventh, the digest it carries of the whole index, and an index of three tables written
// **through the reference's own inverses** — the three mixes of the index (`EncryptIndexStage1`,
// `EncryptIndexDirectory`, `EncryptIndexEntry`) and the two directions of the walk of `Cpz5Decoder`. The
// payloads stand of the walk of an entry of the archive as well, and one of them carries a `PS2A` head, so
// the walk of the window behind the entry walk is read of an end to end run.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { CMVS_CPZ5_SCHEME, Cpz5Decoder, cmvsMd5 } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { cpzFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	encryptCpzIndexDirectory,
	encryptCpzIndexEntry,
	encryptCpzIndexStage1,
} from "../../packages/formats/src/cmvs/cpz5-index.js";

const HEAD_SIZE = 0x40;
const HEAD_SUM_PLACES = 0x3c;
const HEAD_SUM_START = 0x923a564c;
const VERSION = 5;
/** The places of the head of a version below the seventh stand of these constants. */
const DIR_COUNT_XOR = -0x1c5ac27;
const DIR_ENTRIES_XOR = 0x37f298e7;
const FILE_ENTRIES_XOR = 0x7a6f3a2c;
const MASTER_KEY_XOR = 0xae7d39bf;
const ENCRYPTED_XOR = 0xfb73a955;
const DIGEST_XOR = 0x43de7c19;
/** The places of the head of the archive the test builds. */
const MASTER_KEY = 0x5a3c19e7;
const DIGEST_INPUT = [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00];
const DIR_KEYS = [0x0badf00d, 0x1ceb00da];
const ENTRY_RECORD_KEYS = [0x11111111, 0x22222222, 0x33333333];
const DIR_COUNT = 2;
const ENTRY_NAME_AT = 0x18;
/** The places of the walk of an entry of the archive, and of its index. */
const DIRECTORY_DECODE_KEY = 0x3a;
const ENTRY_DECODE_KEY = 0x7e;
const STAGE_KEY_XOR = 0x3795b39a;
const RECORD_PLACES_AT = 0x0c;
const RECORD_KEY_AT = 0x14;
const DIRECTORY_HEAD = 0x10;
const DIRECTORY_ENTRIES_AT = 8;
const DIRECTORY_KEY_AT = 0x0c;
/** The key of a `PS2A` payload of the test, as the walk of the window reads it out of 0x0c. */
const PS2_KEY = 0x00040000;
/** The places each word of the key of a directory stands of, taken from the opener of the engine. */
const DIRECTORY_KEY_ADDEND = [0x76a3bf29, 0, 0x10000000, 0];

interface Plan {
	readonly dir: number;
	readonly name: string;
	/** The places of the entry as the walk of the archive leaves them. */
	readonly plain: Buffer;
	/** The places of the entry as they stand in the archive. */
	readonly stored: Buffer;
	/** The count of the places the listing of the entry carries, which is the count of the stored run. */
	readonly listed: number;
}

/** A run of places of the test, read off the count rather than copied about. */
function run(count: number, base: number, addend: number): Buffer {
	return Buffer.from(
		[...Array(count).keys()].map((at) => (at * base + addend) & 0xff),
	);
}

/** The sum of the first places of a head, worked out here rather than read off the port. */
function sumOf(data: Buffer, length: number, start: number): number {
	let sum = start >>> 0;
	let at = 0;
	for (; at + 4 <= length; at += 4) sum = (sum + data.readUInt32LE(at)) >>> 0;
	for (; at < length; at += 1) sum = (sum + (data[at] ?? 0)) >>> 0;
	return sum;
}

/**
 * The key an entry of the archive is taken apart with, of the places of the head of the archive and of the
 * key of the record of the entry: the walk the reference carries in both directions.
 */
function entryKeyOf(dataKey: number): number {
	let key = ((MASTER_KEY ^ dataKey) + DIR_COUNT) >>> 0;
	key = (key - CMVS_CPZ5_SCHEME.entrySubKey) >>> 0;
	// The head of a layout below the seventh carries no key of its entries of its own.
	return (key ^ 0) >>> 0;
}

/** The digest of the head of the archive, of the engine's own walk of five places. */
function cmvsMd5Digest(): readonly number[] {
	return cmvsMd5("mirai", DIGEST_INPUT);
}

/**
 * The places of a `PS2A` payload: the head of the walk of the window, and a run of literal places behind it
 * put through the inverse of the walk of `DecryptPs2`, which the reference carries one way alone.
 */
function ps2Container(literals: Buffer): Buffer {
	const body: number[] = [];
	for (let at = 0; at < literals.length; at += 1) {
		if (0 === at % 8) body.push(0xff);
		body.push(literals[at] ?? 0);
	}
	const out = Buffer.alloc(0x30 + body.length, 0x00);
	out.write("PS2A", 0, "latin1");
	out.writeUInt32LE(PS2_KEY, 12);
	out.writeInt32LE(literals.length, 0x28);
	Buffer.from(body).copy(out, 0x30);
	const shift = ((PS2_KEY >>> 20) % 5) + 1;
	const mixed = ((PS2_KEY >>> 24) + (PS2_KEY >>> 3)) >>> 0;
	for (let at = 0x30; at < out.length; at += 1) {
		const place = out[at] ?? 0;
		const turned = ((place << shift) | (place >>> (8 - shift))) & 0xff;
		out[at] = ((turned ^ mixed) + 0x7c) & 0xff;
	}
	return out;
}

/** The record of a file of the archive, of the places the walk of the entries reads of it. */
function fileRecord(
	name: string,
	offset: bigint,
	places: number,
	recordKey: number,
): Buffer {
	const out = Buffer.alloc(ENTRY_NAME_AT + name.length + 1, 0x00);
	out.writeInt32LE(out.length, 0);
	out.writeBigInt64LE(offset, 4);
	out.writeUInt32LE(places, RECORD_PLACES_AT);
	out.writeUInt32LE(0, 0x10);
	out.writeUInt32LE(recordKey, RECORD_KEY_AT);
	out.write(name, ENTRY_NAME_AT, "latin1");
	return out;
}

/** The record of a directory: its count of places, its count of files, and the run of its own records. */
function directoryRecord(
	name: string,
	files: number,
	entriesOffset: number,
	dirKey: number,
): Buffer {
	const out = Buffer.alloc(DIRECTORY_HEAD + name.length + 1, 0x00);
	out.writeInt32LE(out.length, 0);
	out.writeInt32LE(files, 4);
	out.writeInt32LE(entriesOffset, DIRECTORY_ENTRIES_AT);
	out.writeUInt32LE(dirKey, DIRECTORY_KEY_AT);
	out.write(name, DIRECTORY_HEAD, "latin1");
	return out;
}

/**
 * An archive of the layout of `CPZ5`: the head, the index of its three tables written through the inverses of
 * the walks the reference reads them with, and the places of its entries.
 */
function buildArchive(options?: { breakRecord?: boolean }): {
	archive: Buffer;
	plans: readonly Plan[];
} {
	const digest = cmvsMd5Digest();
	// Three entries over two directories: the first directory carries a run of places as they stand and one
	// behind a `PS2A` head, the second a run of a picture of its own.
	const plainEntries = [
		Buffer.from("first payload", "latin1"),
		run(0x18, 5, 1),
		run(0x40, 3, 2),
	];
	const literals = Buffer.from("packed-literal-run!", "latin1");
	const carried = [
		plainEntries[0] ?? Buffer.alloc(0),
		ps2Container(literals),
		plainEntries[2] ?? Buffer.alloc(0),
	];
	const plans: Plan[] = [
		{
			dir: 0,
			name: "a.txt",
			plain: plainEntries[0] ?? Buffer.alloc(0),
			stored: carried[0] ?? Buffer.alloc(0),
			listed: carried[0]?.length ?? 0,
		},
		{
			dir: 0,
			name: "packed.dat",
			// The walk of the window keeps the head of the payload and stands the places behind it: the run the
			// reference reads of an archive is the head of `PS2A` and then the places of the window.
			plain: Buffer.concat([
				(carried[1] ?? Buffer.alloc(0)).subarray(0, 0x30),
				literals,
			]),
			stored: carried[1] ?? Buffer.alloc(0),
			listed: carried[1]?.length ?? 0,
		},
		{
			dir: 1,
			name: "b.bin",
			plain: plainEntries[2] ?? Buffer.alloc(0),
			stored: carried[2] ?? Buffer.alloc(0),
			listed: carried[2]?.length ?? 0,
		},
	];
	// The walks of the archive stand of the places of the entries as the record of each of them holds them.
	const walked = plans.map((plan, at) => {
		const dataKey =
			((ENTRY_RECORD_KEYS[at] ?? 0) + (DIR_KEYS[plan.dir] ?? 0)) >>> 0;
		const out = Buffer.from(plan.stored);
		new Cpz5Decoder(CMVS_CPZ5_SCHEME, digest[3] ?? 0, MASTER_KEY).encryptEntry(
			out,
			digest,
			entryKeyOf(dataKey),
		);
		return out;
	});
	// The run of the records of every directory: the offsets of the places of the archive stand behind the
	// index, and the counts of the records are read of the counts of the entries alone.
	const recordSize = (at: number) =>
		ENTRY_NAME_AT + (plans[at]?.name.length ?? 0) + 1;
	const fileEntriesSize = plans.reduce(
		(sum, _plan, at) => sum + recordSize(at),
		0,
	);
	const runs: number[] = [];
	{
		let at = 0;
		for (let dir = 0; dir < DIR_COUNT; dir += 1) {
			runs.push(at);
			for (let index = 0; index < plans.length; index += 1) {
				if ((plans[index]?.dir ?? -1) === dir) at += recordSize(index);
			}
		}
	}
	const dirs = [
		{
			name: "root",
			files: 2,
			entriesOffset: runs[0] ?? 0,
			key: DIR_KEYS[0] ?? 0,
		},
		{
			name: "sub",
			files: 1,
			entriesOffset: runs[1] ?? 0,
			key: DIR_KEYS[1] ?? 0,
		},
	];
	const dirTable = Buffer.concat(
		dirs.map((dir) =>
			directoryRecord(dir.name, dir.files, dir.entriesOffset, dir.key),
		),
	);
	const dirEntriesSize = dirTable.length;
	const baseOffset = BigInt(HEAD_SIZE + dirEntriesSize + fileEntriesSize);
	let dataAt = baseOffset;
	const offsets = plans.map((plan) => {
		const at = dataAt;
		dataAt += BigInt(plan.listed);
		return at;
	});
	// The record of an entry carries the offset of its places **behind the index**, the way the reference
	// reads it: the head, the index and the places of the entries of the archive stand in that order.
	const records = plans.map((plan, at) =>
		fileRecord(
			plan.name,
			(offsets[at] ?? 0n) - baseOffset,
			plan.listed,
			ENTRY_RECORD_KEYS[at] ?? 0,
		),
	);
	const index = Buffer.concat([dirTable, ...records]);
	if (options?.breakRecord === true) {
		// A record of a count of nothing is not a record of this engine at all.
		index.writeInt32LE(0, dirEntriesSize);
	}
	// The inverses of the walks of the index, in the order the walk of it reads them backwards: the runs of
	// the entries of every directory, the table of the directories, and then the first mix of the whole index.
	const entryDecoder = new Cpz5Decoder(
		CMVS_CPZ5_SCHEME,
		MASTER_KEY,
		digest[2] ?? 0,
	);
	for (let dir = 0; dir < DIR_COUNT; dir += 1) {
		const from = dirEntriesSize + (runs[dir] ?? 0);
		const to = dir + 1 === DIR_COUNT ? fileEntriesSize : (runs[dir + 1] ?? 0);
		const key = [0, 1, 2, 3].map(
			(at) =>
				(digest[at] ?? 0) ^
				(((DIR_KEYS[dir] ?? 0) + (CMVS_CPZ5_SCHEME.dirKeyAddend[at] ?? 0)) >>>
					0),
		);
		encryptCpzIndexEntry(
			index,
			from,
			to - (runs[dir] ?? 0),
			key,
			CMVS_CPZ5_SCHEME.indexSeed,
		);
		entryDecoder.encode(index, from, to - (runs[dir] ?? 0), ENTRY_DECODE_KEY);
	}
	const dirKey = [0, 1, 2, 3].map(
		(at) =>
			(digest[at] ?? 0) ^
			((MASTER_KEY + (DIRECTORY_KEY_ADDEND[at] ?? 0)) >>> 0),
	);
	encryptCpzIndexDirectory(index, dirEntriesSize, dirKey);
	new Cpz5Decoder(CMVS_CPZ5_SCHEME, MASTER_KEY, digest[1] ?? 0).encode(
		index,
		0,
		dirEntriesSize,
		DIRECTORY_DECODE_KEY,
	);
	encryptCpzIndexStage1(
		index,
		(MASTER_KEY ^ STAGE_KEY_XOR) >>> 0,
		CMVS_CPZ5_SCHEME,
	);
	// The head: the places of the fields of a version below the seventh, the digest of the index, and the sum
	// of its own places.
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(`CPZ${VERSION}`, 0, "latin1");
	head.writeInt32LE(DIR_COUNT ^ DIR_COUNT_XOR, 4);
	head.writeInt32LE(dirEntriesSize ^ DIR_ENTRIES_XOR, 8);
	head.writeInt32LE(fileEntriesSize ^ FILE_ENTRIES_XOR, 0x0c);
	createHash("md5").update(index).digest().copy(head, 0x10, 0, 0x10);
	DIGEST_INPUT.forEach((word, at) => {
		head.writeUInt32LE((word ^ (DIGEST_XOR + at)) >>> 0, 0x20 + at * 4);
	});
	head.writeUInt32LE((MASTER_KEY ^ MASTER_KEY_XOR) >>> 0, 0x30);
	head.writeUInt32LE((1 ^ ENCRYPTED_XOR) >>> 0, 0x34);
	head.writeUInt32LE(sumOf(head, HEAD_SUM_PLACES, HEAD_SUM_START), 0x3c);
	return { archive: Buffer.concat([head, index, ...walked]), plans };
}

describe("CVNS archive of the newer layouts", () => {
	it("lists and reads the entries of an archive of the fifth layout", async () => {
		const { archive, plans } = buildArchive();
		await expectArchive({
			format: cpzFormat,
			archive,
			sourcePath: "sample.cpz",
			entries: plans.map((plan) => ({
				path: plan.dir === 0 ? plan.name : `sub/${plan.name}`,
				size: plan.listed,
				content: plan.plain,
			})),
			metadata: { entryCount: 3, version: 5 },
		});
	});

	it("holds the head of an archive to the sum of its own places", async () => {
		const { archive } = buildArchive();
		const broken = Buffer.from(archive);
		broken[0x3c] = ((broken[0x3c] ?? 0) ^ 0x01) & 0xff;
		await expectArchive({
			format: cpzFormat,
			archive: broken,
			entries: [],
			detected: false,
		});
		// A run of places that is not the run of the index of the head is not an index of this engine: the
		// digest of the head stands of it.
		const other = Buffer.from(archive);
		other[HEAD_SIZE + 0x20] = ((other[HEAD_SIZE + 0x20] ?? 0) ^ 0x40) & 0xff;
		await expectArchive({
			format: cpzFormat,
			archive: other,
			entries: [],
			detected: false,
		});
	});

	it("refuses an archive whose walk of the index does not stand", async () => {
		// The head and the digest of the index stand of this archive, and the walk of its records does not: the
		// reference throws `UnknownEncryptionScheme` for it rather than opening a partial archive.
		const { archive } = buildArchive({ breakRecord: true });
		const source = new BufferByteSource(archive);
		expect(await cpzFormat.detect(source, "sample.cpz")).toBe(true);
		await expect(cpzFormat.open(source, "sample.cpz")).rejects.toThrow(
			/Unknown encryption scheme/,
		);
	});
});
