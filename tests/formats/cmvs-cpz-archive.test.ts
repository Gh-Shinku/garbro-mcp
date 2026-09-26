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
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import {
	type CpzArchiveKey,
	encryptCpzIndexStage1,
} from "../../packages/formats/src/cmvs/cpz5-index.js";
import { findCpzArchiveKey } from "../../packages/formats/src/cmvs/cpz5-archive.js";

const HEAD_SIZE = 0x40;
const HEAD_SUM_PLACES = 0x3c;
const HEAD_SUM_START = 0x923a564c;
const VERSION = 5;
/** The places every field of the head stands of: the fifth layout first, the sixth behind it. */
const HEAD_XORS = {
	dirCount: [-0x1c5ac27, -0x1c5ac26],
	dirEntries: [0x37f298e7, 0x37f298e8],
	fileEntries: [0x7a6f3a2c, 0x7a6f3a2d],
	masterKey: [0xae7d39bf, 0xae7d39b7],
	encrypted: [0xfb73a955, 0xfb73a956],
	digest: [0x43de7c19, 0x43de7c1a],
	entryKey: 0x37acf832,
};
/** The places of the field of the key of the entries of the head, and of the walk of it. */
const HEAD_ENTRY_KEY_XOR = 0x37acf832;
const HEAD_ENTRY_KEY_AT = 0x38;
const HEAD_ENTRY_KEY_FACTOR = 0x7da8f173;
const HEAD_ENTRY_KEY_ADDEND = 0x13712765;
/** The places of a word of the engine. */
const WORD_PLACES = 4;
/** The places of a head of the seventh layout, and of the sum of it. */
const HEAD_SIZE_LONG = 0x48;
const HEAD_SUM_PLACES_LONG = 0x40;
const HEAD_SUM_AT_LONG = 0x44;
const HEAD_INDEX_KEY_AT = 0x40;
const HEAD_INDEX_KEY_XOR = 0x65ef99f3;
const HEAD_INIT_SUB = 0x6dc5a9b4;

/** The places a version spells: the head of it, the sum of that head, and the places of a file record. */
function layoutOf(version: number): {
	headSize: number;
	sumPlaces: number;
	sumAt: number;
	nameAt: number;
	checkSumAt: number;
	keyAt: number;
	longSize: boolean;
} {
	return version < 7
		? {
				headSize: HEAD_SIZE,
				sumPlaces: HEAD_SUM_PLACES,
				sumAt: HEAD_SUM_PLACES,
				nameAt: ENTRY_NAME_AT,
				checkSumAt: 0x10,
				keyAt: RECORD_KEY_AT,
				longSize: false,
			}
		: {
				headSize: HEAD_SIZE_LONG,
				sumPlaces: HEAD_SUM_PLACES_LONG,
				sumAt: HEAD_SUM_AT_LONG,
				nameAt: 0x1c,
				checkSumAt: 0x14,
				keyAt: 0x18,
				longSize: true,
			};
}
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

/** The key of an archive that stands of no `start.ps3` at all, which is the key of a stock build. */
const ZERO_KEY: CpzArchiveKey = {
	indexDirKey: 0,
	indexEntryKey: 0,
	entryDataKey1: 0,
	entryDataKey2: 0,
};

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
function entryKeyOf(
	dataKey: number,
	archiveKey: CpzArchiveKey,
	headerEntryKey: number,
): number {
	let key = ((MASTER_KEY ^ dataKey) + DIR_COUNT) >>> 0;
	key = (key ^ archiveKey.entryDataKey2) >>> 0;
	key = (key - CMVS_CPZ5_SCHEME.entrySubKey) >>> 0;
	return (key ^ (headerEntryKey + archiveKey.entryDataKey1)) >>> 0;
}

/**
 * The inverse of the walk of the rooms of a directory, of the key of the archive. The reference carries the
 * direction of that walk **without** the key of the archive alone, so this stands of the direction it does
 * carry, of the key added where the walk of the archive adds it (`seed += 0x10FB562A ^ arc_key`). It is a
 * transcription of the same source rather than an independent reading of it, which is the one piece of this
 * fixture that stands that way, and it stands so on purpose: the reference has no second direction to write
 * the run through.
 */
function encryptDirectoryWithKey(
	data: Buffer,
	length: number,
	key: readonly number[],
	archiveKey: number,
): void {
	let seed = 0x76548aef;
	const words = Math.floor(length / WORD_PLACES);
	let at = 0;
	for (; at < words; at += 1) {
		const from = at * WORD_PLACES;
		const word = data.readUInt32LE(from);
		const mixed = (((word + seed) >>> 0) >>> 3) | (((word + seed) >>> 0) << 29);
		data.writeUInt32LE(
			((((mixed >>> 0) + 0x4a91c262) >>> 0) ^ (key[at & 3] ?? 0)) >>> 0,
			from,
		);
		seed = (seed + (0x10fb562a ^ archiveKey)) >>> 0;
	}
	let place = words;
	for (let byte = words * WORD_PLACES; byte < length; byte += 1) {
		data[byte] =
			(((data[byte] ?? 0) - 0x37) ^ ((key[place++ & 3] ?? 0) >>> 6)) & 0xff;
	}
}

/** The same, of the run of the entries of a directory, of the key of the archive. */
function encryptEntriesWithKey(
	data: Buffer,
	at: number,
	length: number,
	key: readonly number[],
	seed: number,
	archiveKey: number,
): void {
	let place = 0;
	const words = Math.floor(length / WORD_PLACES);
	for (let word = 0; word < words; word += 1) {
		const from = at + word * WORD_PLACES;
		const value = data.readUInt32LE(from);
		const turned =
			(((value - 0x37a19e8b) >>> 0) >>> 2) | ((value - 0x37a19e8b) << 30);
		data.writeUInt32LE(
			((((turned >>> 0) + seed) >>> 0) ^ (key[word & 3] ?? 0)) >>> 0,
			from,
		);
		seed = (seed - (0x139fa9b ^ archiveKey)) >>> 0;
	}
	place = words;
	for (let byte = words * WORD_PLACES; byte < length; byte += 1) {
		data[at + byte] =
			(((data[at + byte] ?? 0) - 5) ^ ((key[place++ & 3] ?? 0) >>> 4)) & 0xff;
	}
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
	version: number,
): Buffer {
	const layout = layoutOf(version);
	const out = Buffer.alloc(layout.nameAt + name.length + 1, 0x00);
	out.writeInt32LE(out.length, 0);
	out.writeBigInt64LE(offset, 4);
	out.writeUInt32LE(places, RECORD_PLACES_AT);
	out.writeUInt32LE(0, layout.checkSumAt);
	out.writeUInt32LE(recordKey, layout.keyAt);
	out.write(name, layout.nameAt, "latin1");
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
function buildArchive(options?: {
	version?: number;
	breakRecord?: boolean;
	/** The key of an archive of the layouts above the sixth, which stands of a `start.ps3` beside it. */
	archiveKey?: CpzArchiveKey;
}): {
	archive: Buffer;
	plans: readonly Plan[];
	archiveKey: CpzArchiveKey;
} {
	const version = options?.version ?? VERSION;
	const places = layoutOf(version);
	const layout = version < 6 ? 0 : 1;
	const archiveKey = options?.archiveKey ?? ZERO_KEY;
	// The head of the layouts above the fifth carries the key of its entries of its own, of the walk of that
	// key: the places of the field stand of a turn of the value the walk leaves behind.
	const headEntryKey =
		version < 6
			? 0
			: (HEAD_ENTRY_KEY_ADDEND +
					Math.imul(
						HEAD_ENTRY_KEY_FACTOR,
						((0x12345678 >>> 5) | (0x12345678 << 27)) >>> 0,
					)) >>>
				0;
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
			entryKeyOf(dataKey, archiveKey, headEntryKey),
		);
		return out;
	});
	// The run of the records of every directory: the offsets of the places of the archive stand behind the
	// index, and the counts of the records are read of the counts of the entries alone.
	const recordSize = (at: number) =>
		places.nameAt + (plans[at]?.name.length ?? 0) + 1;
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
	const baseOffset = BigInt(places.headSize + dirEntriesSize + fileEntriesSize);
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
			version,
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
		encryptEntriesWithKey(
			index,
			from,
			to - (runs[dir] ?? 0),
			key,
			CMVS_CPZ5_SCHEME.indexSeed,
			archiveKey.indexEntryKey,
		);
		entryDecoder.encode(index, from, to - (runs[dir] ?? 0), ENTRY_DECODE_KEY);
	}
	const dirKey = [0, 1, 2, 3].map(
		(at) =>
			(digest[at] ?? 0) ^
			((MASTER_KEY + (DIRECTORY_KEY_ADDEND[at] ?? 0)) >>> 0),
	);
	encryptDirectoryWithKey(
		index,
		dirEntriesSize,
		dirKey,
		archiveKey.indexDirKey,
	);
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
	const head = Buffer.alloc(places.headSize, 0x00);
	head.write(`CPZ${version}`, 0, "latin1");
	head.writeInt32LE(DIR_COUNT ^ (HEAD_XORS.dirCount[layout] ?? 0), 4);
	head.writeInt32LE(dirEntriesSize ^ (HEAD_XORS.dirEntries[layout] ?? 0), 8);
	head.writeInt32LE(
		fileEntriesSize ^ (HEAD_XORS.fileEntries[layout] ?? 0),
		0x0c,
	);
	createHash("md5").update(index).digest().copy(head, 0x10, 0, 0x10);
	DIGEST_INPUT.forEach((word, at) => {
		head.writeUInt32LE(
			(word ^ ((HEAD_XORS.digest[layout] ?? 0) + at)) >>> 0,
			0x20 + at * 4,
		);
	});
	head.writeUInt32LE(
		(MASTER_KEY ^ (HEAD_XORS.masterKey[layout] ?? 0)) >>> 0,
		0x30,
	);
	head.writeUInt32LE((1 ^ (HEAD_XORS.encrypted[layout] ?? 0)) >>> 0, 0x34);
	if (version >= 6) {
		head.writeUInt32LE(
			(0x12345678 ^ HEAD_ENTRY_KEY_XOR) >>> 0,
			HEAD_ENTRY_KEY_AT,
		);
	}
	let sumStart = HEAD_SUM_START;
	if (version >= 7) {
		// The seventh layout names the count of the places of the key behind its index, of nothing here, and
		// the sum of its head stands of that count.
		// The places of that count stand of the fields of the head, which the sum of it stands of as well: the
		// count itself is nothing here, and the field is the count taken apart.
		head.writeInt32LE(HEAD_INDEX_KEY_XOR | 0, HEAD_INDEX_KEY_AT);
		sumStart = ((HEAD_INDEX_KEY_XOR >>> 0) - HEAD_INIT_SUB) >>> 0;
	}
	head.writeUInt32LE(sumOf(head, places.sumPlaces, sumStart), places.sumAt);
	return {
		archive: Buffer.concat([head, index, ...walked]),
		plans,
		archiveKey,
	};
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

/** The places of the `start.ps3` the test builds: its table, its bytecode, and the names behind both. */
const PS3_TABLE_COUNT = 2;
const PS3_BYTECODE_PLACES = 0x80;
/** The place of the name within the bytecode, and the places of the pattern in front of it. */
const PS3_NAME_AT = 0x38;
const PS3_PATTERN = [2, 0, 1];
/** The places of the four words of the key behind that place. */
const PS3_KEY_BACK = [0x0c, 0x18, 0x24, 0x30];
/** The key the `start.ps3` of the test names. */
const KEYS: CpzArchiveKey = {
	indexDirKey: 0x0a0b0c0d,
	indexEntryKey: 0x1a1b1c1d,
	entryDataKey1: 0x2a2b2c2d,
	entryDataKey2: 0x3a3b3c3d,
};

/**
 * The places of a `start.ps3`, the payload of the engine the key of an archive is read of: the head of the
 * walk of the window, a table of four places a room, a run of bytecode of the names of the archives a game
 * ships, and the names themselves. The key of the test stands in the bytecode, of the pattern the reference
 * reads of it.
 */
function startPs3(input: {
	names: readonly string[];
	wanted: string;
	keys: CpzArchiveKey;
	pattern?: readonly number[];
	mark?: string;
}): Buffer {
	const strings = Buffer.concat(
		input.names.map((name) => Buffer.from(`${name}\u0000`, "latin1")),
	);
	const run = Buffer.alloc(
		PS3_TABLE_COUNT * WORD_PLACES + PS3_BYTECODE_PLACES + strings.length,
		0x40,
	);
	run.writeUInt32LE(0x11111111, 0);
	run.writeUInt32LE(0x22222222, WORD_PLACES);
	const bytecodeAt = PS3_TABLE_COUNT * WORD_PLACES;
	strings.copy(run, bytecodeAt + PS3_BYTECODE_PLACES);
	let id = 0;
	let at = 0;
	for (const name of input.names) {
		if (name === input.wanted) break;
		at += name.length + 1;
	}
	id = at;
	const nameAt = bytecodeAt + PS3_NAME_AT;
	run.writeUInt32LE(id >>> 0, nameAt);
	const words = [
		input.keys.entryDataKey2,
		input.keys.entryDataKey1,
		input.keys.indexEntryKey,
		input.keys.indexDirKey,
	];
	words.forEach((word, place) => {
		run.writeUInt32LE(word >>> 0, nameAt - (PS3_KEY_BACK[3 - place] ?? 0));
	});
	(input.pattern ?? PS3_PATTERN).forEach((place, index) => {
		run[nameAt - 0x33 + index] = place;
	});
	const container = ps2Container(run);
	container.write(input.mark ?? "PS2A", 0, "latin1");
	container.writeInt32LE(PS3_TABLE_COUNT, 0x10);
	container.writeInt32LE(PS3_BYTECODE_PLACES, 0x14);
	container.writeInt32LE(strings.length, 0x1c);
	return container;
}

describe("CVNS key of an archive", () => {
	it("reads the key of an archive out of a `start.ps3` beside it", async () => {
		const start = startPs3({
			names: ["other.arc", "voice.cpz"],
			wanted: "voice.cpz",
			keys: KEYS,
		});
		await withCompanionFiles(
			"voice.cpz",
			{ "start.ps3": start, "voice.cpz": Buffer.from("CPZ5", "latin1") },
			async (mainPath) => {
				await expect(findCpzArchiveKey(mainPath)).resolves.toEqual(KEYS);
			},
		);
	});

	it("turns away a `start.ps3` that does not name the archive, of a key", async () => {
		const absent = startPs3({
			names: ["other.arc"],
			wanted: "voice.cpz",
			keys: KEYS,
		});
		const other = startPs3({
			names: ["other.arc", "voice.cpz"],
			wanted: "voice.cpz",
			keys: KEYS,
			pattern: [2, 0, 2],
		});
		const wrong = startPs3({
			names: ["other.arc", "voice.cpz"],
			wanted: "voice.cpz",
			keys: KEYS,
			mark: "PS2B",
		});
		await withCompanionFiles("voice.cpz", {}, async (mainPath) => {
			// A `start.ps3` that does not stand beside the archive at all.
			await expect(findCpzArchiveKey(mainPath)).resolves.toBeUndefined();
		});
		await withCompanionFiles(
			"voice.cpz",
			{
				"start.ps3": absent,
				"voice.cpz": Buffer.from("CPZ5", "latin1"),
			},
			async (mainPath) => {
				await expect(findCpzArchiveKey(mainPath)).resolves.toBeUndefined();
			},
		);
		await withCompanionFiles(
			"voice.cpz",
			{
				"start.ps3": other,
				"voice.cpz": Buffer.from("CPZ5", "latin1"),
			},
			async (mainPath) => {
				await expect(findCpzArchiveKey(mainPath)).resolves.toBeUndefined();
			},
		);
		await withCompanionFiles(
			"voice.cpz",
			{
				"start.ps3": wrong,
				"voice.cpz": Buffer.from("CPZ5", "latin1"),
			},
			async (mainPath) => {
				await expect(findCpzArchiveKey(mainPath)).resolves.toBeUndefined();
			},
		);
	});

	it("reads an archive of the seventh layout that stands of the key of its `start.ps3`", async () => {
		// The reference reads the key of an archive out of a `start.ps3` beside it for the layouts **above the
		// sixth** alone, so the archive of this case is one of the seventh: its head stands of the count of the
		// places of the key behind its index — of nothing here — and the places of its records stand four on.
		const { archive, plans } = buildArchive({ version: 7, archiveKey: KEYS });
		const start = startPs3({
			names: ["other.arc", "voice.cpz"],
			wanted: "voice.cpz",
			keys: KEYS,
		});
		await withCompanionFiles(
			"voice.cpz",
			{ "start.ps3": start, "voice.cpz": archive },
			async (mainPath) => {
				await expectCompanionArchive({
					format: cpzFormat,
					mainPath,
					entries: plans.map((plan) => ({
						path: plan.dir === 0 ? plan.name : `sub/${plan.name}`,
						size: plan.listed,
						content: plan.plain,
					})),
					metadata: { entryCount: 3, version: 7 },
				});
			},
		);
	});
});
