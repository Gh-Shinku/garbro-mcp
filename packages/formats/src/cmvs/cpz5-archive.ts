// Format reference: GARbro ArcFormats/Cmvs/ArcCPZ.cs, class `CpzOpener` (the layouts whose mark reads
// `CPZ5`, `CPZ6` or `CPZ7`), with the head of `ArcFormats/Cmvs/CpzHeader.cs`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The archive of the newer layouts of the CVNS engine holds its whole index in one run behind its head: a
// table of directories, a table of file records, and — of the seventh layout alone — a key behind both of
// them, packed with the Huffman tree of the engine. Every one of those places is taken apart by a walk of
// the engine, and the head carries the digest of the index as well: an index whose digest does not stand is
// not an index of this engine.
//
// One piece of the reference is not ported here, and the port therefore refuses an archive that stands of
// it: the reference reads the key of the archive out of a `start.ps3` beside it (`FindArchiveKey`), a
// payload of the engine whose tables name every archive the game ships of. An archive whose index was
// written with such a key, and whose head carries its own master key, cannot be walked by the port at all;
// the four places of the key the walk stands of (`IndexDirKey`, `IndexEntryKey`, `EntryDataKey1`,
// `EntryDataKey2`) are held to zero, which is the key of a stock build of the engine and of every archive
// of the layouts below the seventh, whose key the reference stands of zero as well.
//
// Both deviations of the walks themselves are kept as the reference writes them (the seed of the walk of a
// directory carries the key of the archive on the way in alone), and the fixtures of the test are written
// **through** the reference's own inverses: the three mixes of the index, the two directions of the walk of
// `Cpz5Decoder`, and the head, whose sum is worked out in the test rather than read off this port.

import {
	GarbroError,
	decodeCp932,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	CMVS_CPZ5_SCHEME,
	Cpz5Decoder,
	cmvsMd5,
	type CmvsMd5Variant,
	type Cpz5Scheme,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import {
	readCpzHeader,
	verifyCpzIndex,
	type CpzHeader,
} from "./cpz5-header.js";
import {
	decryptCpzIndexDirectory,
	decryptCpzIndexEntry,
	decryptCpzIndexStage1,
	decryptCpzPb3,
	type CpzArchiveKey,
	unpackCpzIndexKey,
	unpackCpzPs2,
} from "./cpz5-index.js";

const SIGNS = ["CPZ5", "CPZ6", "CPZ7"];
const HEAD_SIZE_LONG = 0x48;
/** `CreateCpz5Scheme (Md5Variant.Mirai)`: the scheme of every layout the opener reads. */
const SCHEME: Cpz5Scheme = CMVS_CPZ5_SCHEME;
const MD5_VARIANT: CmvsMd5Variant = "mirai";
/** The count the places of an index are taken apart with before the walk of its directories. */
const STAGE_KEY_XOR = 0x3795b39a;
const DIRECTORY_DECODE_KEY = 0x3a;
const ENTRY_DECODE_KEY = 0x7e;
/** The places of the key behind the index of the seventh layout stand of the first three of a word of four. */
const KEY_PLACE_SHIFT = 3;
const KEY_PLACE_MASK = 0x3ff;
/** A key behind the index is read of any run longer than this count; anything shorter leaves the index. */
const INDEX_KEY_GATE = 24;
/** The head of a directory record, and the least run it can stand of. */
const DIRECTORY_HEAD = 0x10;
const DIRECTORY_NAME_AT = 0x10;
const DIRECTORY_KEY_AT = 0x0c;
const DIRECTORY_FILE_COUNT_AT = 4;
const DIRECTORY_ENTRIES_AT = 8;
const FILE_COUNT_LIMIT = 0x10000;
/** The places of a file record: its count, the run it stands at, its count of places, and its key. */
const RECORD_SIZE_AT = 0;
const RECORD_OFFSET_AT = 4;
const RECORD_PLACES_AT = 0x0c;
const RECORD_KEY_AT = 0x10;
/** The seventh layout carries its places as four places longer, so the key of a record stands four on. */
const RECORD_LONG_ADDEND = 4;
/** The places each word of the key of a directory stands of, and those of the key of the index. */
const DIRECTORY_KEY_ADDEND = [0x76a3bf29, 0, 0x10000000, 0];
/** The places of a word of the engine, of the head of a `start.ps3`, of its table and of the names behind it. */
const WORD_PLACES = 4;
const KEY_HEAD = 0x30;
const KEY_TABLE_COUNT_AT = 0x10;
const KEY_TABLE_OFFSET_AT = 0x14;
const KEY_TABLE_STRINGS_AT = 0x1c;
/** The pattern of three places the bytecode of a `start.ps3` stands of in front of a name of an archive. */
const KEY_PATTERN_BACK = 0x33;
const KEY_PATTERN = [2, 0, 1];
/** The places of the four words of the key behind the place of that pattern. */
const KEY_PLACES_BACK = [0x0c, 0x18, 0x24, 0x30];
/** The marks of the payloads the opener unpacks behind the walk of the entries. */
const PS2_MARKER = Buffer.from("PS2A", "ascii");
const PB3_MARKER = Buffer.from("PB3B", "ascii");
const PS2_PLACES = 0x30;
const PB3_PLACES = 0x40;

export const cpzDescriptor: FormatDescriptor = {
	id: "cmvs-cpz-archive",
	name: "CVNS engine resource archive (newer layouts)",
	extensions: ["cpz"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/ArcCPZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/CpzHeader.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/CmvsMD5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/HuffmanDecoder.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The places of the key of an archive, which the reference reads out of a `start.ps3` beside it. */
const ZERO_KEY: CpzArchiveKey = {
	indexDirKey: 0,
	indexEntryKey: 0,
	entryDataKey1: 0,
	entryDataKey2: 0,
};

/**
 * GARbro `CpzOpener.FindArchiveKey`: the key of an archive, read out of a `start.ps3` beside it. That file is
 * a payload of the engine of its own: the window walk of `PS2A` behind a table of four places a room, a run of
 * bytecode, and the names of the archives a game ships of. The name of the archive is looked up among those
 * names, and then the place of it within the run of the names is looked up among the places of the bytecode,
 * of a pattern of three places in front of it: the four places behind that place are the key.
 *
 * The reference reads the four places behind the place of the pattern without holding the place to the head
 * of the run; this port holds every place of them to the run it reads, so a run too short for the pattern is
 * turned away rather than read of the places in front of it.
 */
export async function findCpzArchiveKey(
	sourcePath: string,
): Promise<CpzArchiveKey | undefined> {
	const start = await readCompanionFile(sourcePath, "start.ps3");
	if (start === undefined) return undefined;
	if (
		start.length < PS2_MARKER.length ||
		!start.subarray(0, PS2_MARKER.length).equals(PS2_MARKER)
	) {
		return undefined;
	}
	const data = unpackCpzPs2(start);
	if (data.length < KEY_HEAD) return undefined;
	const tableCount = data.readInt32LE(KEY_TABLE_COUNT_AT);
	const tableEnd = KEY_HEAD + tableCount * WORD_PLACES;
	const stringsOffset = tableEnd + data.readInt32LE(KEY_TABLE_OFFSET_AT);
	const stringsSize = data.readInt32LE(KEY_TABLE_STRINGS_AT);
	if (
		tableEnd < KEY_HEAD ||
		stringsOffset < KEY_HEAD ||
		stringsOffset + stringsSize > data.length
	) {
		return undefined;
	}
	const wanted = fileNameOf(sourcePath);
	const arcId = findArchiveName(data, stringsOffset, stringsSize, wanted);
	if (arcId < 0) return undefined;
	const id = Buffer.alloc(WORD_PLACES, 0x00);
	id.writeUInt32LE(arcId >>> 0, 0);
	for (let at = tableEnd; at + WORD_PLACES <= stringsOffset; at += 1) {
		if (!data.subarray(at, at + WORD_PLACES).equals(id)) continue;
		if (at < KEY_PATTERN_BACK) continue;
		if (
			data[at - KEY_PATTERN_BACK] !== (KEY_PATTERN[0] ?? 0) ||
			data[at - KEY_PATTERN_BACK + 1] !== (KEY_PATTERN[1] ?? 0) ||
			data[at - KEY_PATTERN_BACK + 2] !== (KEY_PATTERN[2] ?? 0)
		) {
			continue;
		}
		const behind = KEY_PLACES_BACK;
		if (at < (behind[3] ?? 0)) continue;
		return {
			indexDirKey: data.readUInt32LE(at - (behind[0] ?? 0)),
			indexEntryKey: data.readUInt32LE(at - (behind[1] ?? 0)),
			entryDataKey1: data.readUInt32LE(at - (behind[2] ?? 0)),
			entryDataKey2: data.readUInt32LE(at - (behind[3] ?? 0)),
		};
	}
	return undefined;
}

/** The name of a file within a path of either separator, which the reference reads of `Path.GetFileName`. */
function fileNameOf(path: string): string {
	const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return at < 0 ? path : path.slice(at + 1);
}

/**
 * The place of a name within the run of the names of a `start.ps3`: the run stands of names of no more than
 * one place each, and the name of an archive stands of the name of the file alone, of either case, which is
 * what the reference asks of its own file system.
 */
function findArchiveName(
	data: Buffer,
	stringsOffset: number,
	stringsSize: number,
	wanted: string,
): number {
	const end = stringsOffset + stringsSize;
	let at = stringsOffset;
	while (at < end) {
		let terminator = data.indexOf(0, at);
		if (terminator === -1 || terminator > end) terminator = end;
		if (terminator !== at) {
			const text = decodeCp932(data.subarray(at, terminator));
			if (fileNameOf(text).toLowerCase() === wanted.toLowerCase()) {
				return at - stringsOffset;
			}
		}
		at = terminator + 1;
	}
	return -1;
}

/** The places an entry stands of at the reading of it: the key of the archive and the archive as a whole. */
interface CpzEntryState {
	readonly isEncrypted: boolean;
	readonly masterKey: number;
	readonly dirCount: number;
	readonly entryKey: number;
	/** The key of the entry within its directory, of the place of its record. */
	readonly dataKey: number;
	readonly digest: readonly number[];
	/** The key of the archive, of a `start.ps3` beside it where it stands of one. */
	readonly archiveKey: CpzArchiveKey;
}

interface CpzIndex {
	entries: FixedEntry[];
}

/**
 * GARbro `CpzOpener.TryOpen` and `ReadIndex`: the head, the digest of the index, and the two tables behind
 * it. The walks of the index run in one order alone, so the whole of it is tried once here: a failure at any
 * step means the index is not one of this engine's, and the reference throws `UnknownEncryptionScheme` for
 * it rather than opening a partial archive.
 */
async function openCpzIndex(
	source: ByteSource,
): Promise<{ header: CpzHeader; index: Buffer } | undefined> {
	if (source.size < BigInt(HEAD_SIZE_LONG)) return undefined;
	const head = await source.readAt(0n, HEAD_SIZE_LONG);
	const header = readCpzHeader(head);
	if (!header) return undefined;
	const indexSize = Number(header.indexSize);
	if (BigInt(header.indexOffset) + BigInt(indexSize) > source.size)
		return undefined;
	const index = await source.readAt(BigInt(header.indexOffset), indexSize);
	if (!verifyCpzIndex(header, index)) return undefined;
	return { header, index };
}

/**
 * The walk of the three tables of the index, and of the places of the entries behind them. The head of the
 * archive and the digest of its index are read first, and a run that stands of both of them but not of the
 * walk is not an index of this engine at all: the reference throws `UnknownEncryptionScheme` for it, which
 * this port holds to the error of a format that is not supported in this run rather than to a failure of
 * detection, so that an archive of a newer key of the engine is still named as the archive of this engine.
 */
async function walkCpzIndex(
	source: ByteSource,
	pass: { header: CpzHeader; index: Buffer },
	archiveKey: CpzArchiveKey,
): Promise<CpzIndex | undefined> {
	const { header, index } = pass;
	const fileTableSize = header.dirEntriesSize + header.fileEntriesSize;
	if (fileTableSize < 0 || fileTableSize > index.length) return undefined;
	if (header.indexKeySize > INDEX_KEY_GATE) {
		// The key behind the index stands within the places of the index it was read of; a head that names
		// more of them than the index carries is turned away rather than read past its own places.
		if (fileTableSize + header.indexKeySize > index.length) return undefined;
		const key = unpackCpzIndexKey(index, fileTableSize, header.indexKeySize);
		for (let at = 0; at < fileTableSize; at += 1) {
			index[at] =
				(index[at] ?? 0) ^ (key[(at + KEY_PLACE_SHIFT) % KEY_PLACE_MASK] ?? 0);
		}
	}

	// The digest of the head is read as the message of the engine's own MD5, whose result then feeds every
	// key of the walk.
	const digest = cmvsMd5(MD5_VARIANT, header.digest);
	const masterKey = header.masterKey;
	decryptCpzIndexStage1(index, (masterKey ^ STAGE_KEY_XOR) >>> 0, SCHEME);
	// The reference seeds one walk of the table and seeds it again for the runs of the entries; the table of
	// this port is built where the walk of it begins, so every seed stands of a walk of its own.
	const directoryDecoder = new Cpz5Decoder(SCHEME, masterKey, digest[1] ?? 0);
	directoryDecoder.decode(
		index,
		0,
		header.dirEntriesSize,
		DIRECTORY_DECODE_KEY,
	);
	const key = [
		(digest[0] ?? 0) ^ ((masterKey + (DIRECTORY_KEY_ADDEND[0] ?? 0)) >>> 0),
		(digest[1] ?? 0) ^ masterKey,
		(digest[2] ?? 0) ^ ((masterKey + (DIRECTORY_KEY_ADDEND[2] ?? 0)) >>> 0),
		(digest[3] ?? 0) ^ masterKey,
	];
	decryptCpzIndexDirectory(
		index,
		header.dirEntriesSize,
		key,
		archiveKey.indexDirKey,
	);

	const baseOffset = BigInt(header.indexOffset + header.indexSize);
	const entries: FixedEntry[] = [];
	const entryDecoder = new Cpz5Decoder(SCHEME, masterKey, digest[2] ?? 0);
	let dirOffset = 0;
	for (let id = 0; id < header.dirCount; id += 1) {
		if (dirOffset + DIRECTORY_HEAD > index.length) return undefined;
		const dirSize = index.readInt32LE(dirOffset);
		if (dirSize <= DIRECTORY_HEAD || dirSize > index.length) return undefined;
		const fileCount = index.readInt32LE(dirOffset + DIRECTORY_FILE_COUNT_AT);
		if (fileCount >= FILE_COUNT_LIMIT) return undefined;
		const entriesOffset = index.readInt32LE(dirOffset + DIRECTORY_ENTRIES_AT);
		const dirKey = index.readUInt32LE(dirOffset + DIRECTORY_KEY_AT);
		const dirName = decodeCStringField(
			index,
			dirOffset + DIRECTORY_NAME_AT,
			dirSize - DIRECTORY_NAME_AT,
		);
		const nextEntriesOffset =
			id + 1 === header.dirCount
				? header.fileEntriesSize
				: index.readInt32LE(dirOffset + dirSize + DIRECTORY_ENTRIES_AT);
		const curEntriesSize = nextEntriesOffset - entriesOffset;
		if (curEntriesSize <= 0) return undefined;
		const curOffset = header.dirEntriesSize + entriesOffset;
		const curEntriesEnd = curOffset + curEntriesSize;
		if (curOffset < 0 || curEntriesEnd > index.length) return undefined;
		entryDecoder.decode(index, curOffset, curEntriesSize, ENTRY_DECODE_KEY);
		for (let at = 0; at < 4; at += 1) {
			key[at] =
				(digest[at] ?? 0) ^ ((dirKey + (SCHEME.dirKeyAddend[at] ?? 0)) >>> 0);
		}
		decryptCpzIndexEntry(
			index,
			curOffset,
			curEntriesSize,
			key,
			SCHEME.indexSeed,
			archiveKey.indexEntryKey,
		);
		const isRootDir = dirName === "root";
		let recordAt = curOffset;
		for (let file = 0; file < fileCount; file += 1) {
			const recordSize = index.readInt32LE(recordAt + RECORD_SIZE_AT);
			if (recordSize > index.length || recordSize <= header.entryNameOffset) {
				return undefined;
			}
			const nameAt = recordAt + header.entryNameOffset;
			const name = decodeCStringField(index, nameAt, curEntriesEnd - nameAt);
			const path = normalizeEntryPath(
				isRootDir ? name : `${dirName}/${name}`,
			).path;
			const offset =
				baseOffset + index.readBigInt64LE(recordAt + RECORD_OFFSET_AT);
			const size = BigInt(index.readUInt32LE(recordAt + RECORD_PLACES_AT));
			let keyAt = recordAt + RECORD_KEY_AT;
			if (header.isLongSize) keyAt += RECORD_LONG_ADDEND;
			const dataKey = (index.readUInt32LE(keyAt + 4) + dirKey) >>> 0;
			if (!checkPlacement(offset, size, source.size)) return undefined;
			const state: CpzEntryState = {
				isEncrypted: header.isEncrypted,
				masterKey,
				dirCount: header.dirCount,
				entryKey: header.entryKey,
				dataKey,
				digest,
				archiveKey,
			};
			entries.push(
				createFixedEntry({
					id: entries.length,
					path,
					offset,
					size,
					encrypted: header.isEncrypted,
					metadata: { cpz: state },
				}),
			);
			recordAt += recordSize;
		}
		dirOffset += dirSize;
	}
	return { entries };
}

/**
 * GARbro `CpzOpener.OpenEntry`: the places of an entry are taken apart of a key of its own, which the place
 * of its record and the archive as a whole stand of, and a `PS2A` or `PB3B` payload behind that is then
 * walked the way its mark names.
 */
const cpzEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = await source.readAt(entry.offset, Number(entry.packedSize));
	const state = entry.metadata?.cpz as CpzEntryState | undefined;
	if (state?.isEncrypted === true) {
		let key = ((state.masterKey ^ state.dataKey) + state.dirCount) >>> 0;
		key = (key ^ state.archiveKey.entryDataKey2) >>> 0;
		key = (key - SCHEME.entrySubKey) >>> 0;
		key = (key ^ (state.entryKey + state.archiveKey.entryDataKey1)) >>> 0;
		const decoder = new Cpz5Decoder(
			SCHEME,
			state.digest[3] ?? 0,
			state.masterKey,
		);
		decoder.decryptEntry(data, state.digest, key);
	}
	if (
		data.length > PS2_PLACES &&
		data.subarray(0, PS2_MARKER.length).equals(PS2_MARKER)
	) {
		return Readable.from([unpackCpzPs2(data)]);
	}
	if (
		data.length > PB3_PLACES &&
		data.subarray(0, PB3_MARKER.length).equals(PB3_MARKER)
	) {
		decryptCpzPb3(data);
	}
	return Readable.from([data]);
};

export const cpzFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cpzDescriptor,
	detection: {
		signatures: SIGNS.map((sign) => ({
			bytes: Buffer.from(sign, "ascii"),
		})),
	},
	async detect(source: ByteSource, _sourcePath: string): Promise<boolean> {
		return (await openCpzIndex(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const pass = await openCpzIndex(source);
		// The reference reads the key of an archive out of a `start.ps3` beside it for the layouts above the
		// sixth alone; every layout below them, and every stock build, stands of a key of nothing.
		const key =
			pass !== undefined && pass.header.version > 6
				? ((await findCpzArchiveKey(sourcePath)) ?? ZERO_KEY)
				: ZERO_KEY;
		const index = pass ? await walkCpzIndex(source, pass, key) : undefined;
		if (!pass || !index) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Unknown encryption scheme of a CVNS archive",
			);
		}
		return {
			entries: index.entries,
			metadata: {
				entryCount: index.entries.length,
				version: pass.header.version,
			},
		};
	},
	openEntry: cpzEntryOpener,
});
