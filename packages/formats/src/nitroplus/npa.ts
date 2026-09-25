// Format reference: GARbro "ArcFormats/NitroPlus/ArcNPA.cs", classes `NpaOpener`, `NpaEntry`,
// `NpaArchive`, `EncryptionScheme` and `Indexer`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	decodeCp932,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

/** `NpaOpener.Signature`: `NPA\x01`. */
const MARK = Buffer.from("NPA\x01", "latin1");
const MARK_SIZE = MARK.length;
/** The head runs from the mark up to the first record of the index. */
const HEAD_SIZE = 41;
const KEY1_AT = 7;
const KEY2_AT = 11;
const COMPRESSED_AT = 15;
const ENCRYPTED_AT = 16;
const TOTAL_AT = 17;
const FOLDERS_AT = 21;
const FILES_AT = 25;
const DIR_SIZE_AT = 37;
/** A record is the name length, the name, the type byte and four words. */
const NAME_LENGTH_SIZE = 4;
const RECORD_TAIL_SIZE = 17;
/** `Indexer.AddDirectory` writes 1 for a folder and 2 for a file; `TryOpen` skips the folders. */
const DIRECTORY_TYPE = 1;
/** `NpaOpener.DecryptName` steps this much per name place. */
const NAME_KEY_STEP = 0xfc;
/** The two letters of a zlib head and the base of its check. */
const ZLIB_METHOD_MASK = 0x0f;
const ZLIB_METHOD = 8;
const ZLIB_CHECK_BASE = 31;
const ZLIB_HEAD_SIZE = 2;

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidArchive("The archive of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/**
 * `NpaOpener.DecryptName`: the amount a name place carries, from the place it stands at, the number of the
 * record and the key of the archive. The reference adds this to every place of the stored name; the writer
 * subtracts it, so the arithmetic mirrors `Indexer`.
 */
export function npaNameKey(
	index: number,
	entryNumber: number,
	archiveKey: number,
): number {
	let key = NAME_KEY_STEP * index;
	key -= archiveKey >> 0x18;
	key -= archiveKey >> 0x10;
	key -= archiveKey >> 0x08;
	key -= archiveKey & 0xff;
	key -= entryNumber >> 0x18;
	key -= entryNumber >> 0x10;
	key -= entryNumber >> 0x08;
	key -= entryNumber;
	return key & 0xff;
}

/**
 * `NpaOpener.GetArchiveKey`. The reference keeps the sum for the Lamento scheme and the product for every
 * other title; a scheme stands only for an encrypted archive, which this port refuses, so the key of an
 * archive it opens is always the product, with the thirty two bit wrap the reference's own arithmetic has.
 */
export function npaArchiveKey(key1: number, key2: number): number {
	return Math.imul(key1, key2);
}

/** A record of the index of the engine, with the name places already restored. */
export interface NpaRecord {
	rawName: Buffer;
	name: string;
	folderId: number;
	/** The place of the record inside the payload of the archive, as the index stores it. */
	offset: number;
	/** The places of the file of the entry as it stands stored. */
	size: number;
	/** The places of the file of the entry as the reference reads it out. */
	unpackedSize: number;
}

/** The head and the index of a NitroPlus archive. */
export interface NpaLayout {
	total: number;
	folders: number;
	files: number;
	dirSize: number;
	compressed: boolean;
	entries: NpaRecord[];
}

/** `NpaOpener.TryOpen`: the head and the index of the engine, every folder record left out. */
export function readNpaIndex(data: Buffer): NpaLayout {
	if (data.length < HEAD_SIZE || !data.subarray(0, MARK_SIZE).equals(MARK)) {
		throw invalidArchive("Not a NitroPlus resource archive");
	}
	const key1 = data.readInt32LE(KEY1_AT);
	const key2 = data.readInt32LE(KEY2_AT);
	const compressed = 0 !== (data[COMPRESSED_AT] ?? 0);
	const encrypted = 0 !== (data[ENCRYPTED_AT] ?? 0);
	const total = data.readInt32LE(TOTAL_AT);
	const folders = data.readInt32LE(FOLDERS_AT);
	const files = data.readInt32LE(FILES_AT);
	const dirSize = data.readUInt32LE(DIR_SIZE_AT);
	if (total < folders + files) {
		throw invalidArchive("The count of the entries of the index of the engine");
	}
	if (dirSize >= data.length) {
		throw invalidArchive("The places of the file of the index of the engine");
	}
	if (encrypted) {
		// The reference asks the user for the scheme of the game and throws when the title is unknown;
		// every scheme it knows lives outside this port.
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The places of the file of the walk of the engine of the game of the archive of it",
		);
	}
	const key = npaArchiveKey(key1, key2);
	const entries: NpaRecord[] = [];
	let at = HEAD_SIZE;
	for (let i = 0; i < total; i += 1) {
		if (at + NAME_LENGTH_SIZE > data.length) {
			throw invalidArchive(
				"The places of the file of a record of the index of the engine",
			);
		}
		const nameSize = data.readInt32LE(at);
		// The reference compares the length against the size of the index as an unsigned word, so a
		// negative length stands as a large one here too.
		if (nameSize >>> 0 >= dirSize) {
			throw invalidArchive(
				"The places of the file of the name of a record of the engine",
			);
		}
		const infoAt = at + NAME_LENGTH_SIZE + nameSize;
		if (infoAt + RECORD_TAIL_SIZE > data.length) {
			throw invalidArchive(
				"The places of the file of a record of the index of the engine",
			);
		}
		const type = data[at + NAME_LENGTH_SIZE + nameSize] ?? 0;
		if (DIRECTORY_TYPE !== type) {
			const rawName = Buffer.from(data.subarray(at + NAME_LENGTH_SIZE, infoAt));
			for (let x = 0; x < rawName.length; x += 1) {
				rawName[x] = ((rawName[x] ?? 0) + npaNameKey(x, i, key)) & 0xff;
			}
			const record: NpaRecord = {
				rawName,
				name: decodeCp932(rawName),
				folderId: data.readInt32LE(infoAt + 1),
				offset: data.readUInt32LE(infoAt + 5),
				size: data.readUInt32LE(infoAt + 9),
				unpackedSize: data.readUInt32LE(infoAt + 13),
			};
			const place = BigInt(dirSize) + BigInt(record.offset) + BigInt(HEAD_SIZE);
			if (!checkPlacement(place, BigInt(record.size), BigInt(data.length))) {
				throw invalidArchive("The place of the entry of the engine");
			}
			entries.push(record);
		}
		at = infoAt + RECORD_TAIL_SIZE;
	}
	return { total, folders, files, dirSize, compressed, entries };
}

/** Whether the places of the file carry the two letters every zlib stream of the engine begins with. */
export function hasZlibHead(data: Buffer, at = 0): boolean {
	if (at + ZLIB_HEAD_SIZE > data.length) return false;
	const head = data.subarray(at, at + ZLIB_HEAD_SIZE);
	const cmf = head[0] ?? 0;
	const flg = head[1] ?? 0;
	if (ZLIB_METHOD !== (cmf & ZLIB_METHOD_MASK)) return false;
	return 0 === ((cmf << 8) | flg) % ZLIB_CHECK_BASE;
}

export const nitroplusNpaDescriptor: FormatDescriptor = {
	id: "nitroplus-npa",
	name: "NitroPlus resource archive",
	extensions: ["npa"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/NitroPlus/ArcNPA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nitroplusNpaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nitroplusNpaDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		if (source.size < BigInt(MARK_SIZE)) return false;
		try {
			readNpaIndex(await readStored(source));
			return true;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		void sourcePath;
		const data = await readStored(source);
		const layout = readNpaIndex(data);
		// The reference packs every entry of an archive whose head says so apart from the ones whose
		// extension names a picture, which it looks up in the whole format catalog. This port keeps the
		// flag of the head for every entry and decides at extraction by the zlib head of the payload,
		// which hands over the same bytes for every archive the reference itself writes.
		const packed = layout.compressed;
		const entries: FixedEntry[] = layout.entries.map((record, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset:
					BigInt(layout.dirSize) + BigInt(record.offset) + BigInt(HEAD_SIZE),
				size: BigInt(packed ? record.unpackedSize : record.size),
				packedSize: BigInt(record.size),
				compressed: packed,
				metadata: {
					folderId: record.folderId,
					unpackedSize: record.unpackedSize,
					storedSize: record.size,
				},
			}),
		);
		return {
			entries,
			metadata: {
				total: layout.total,
				folders: layout.folders,
				files: layout.files,
				compressed: layout.compressed,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Number(entry.packedSize);
		if (!Number.isSafeInteger(stored) || stored < 0) {
			throw invalidArchive("The places of the file of the entry of the engine");
		}
		const read = await source.readAt(entry.offset, stored);
		const data = Buffer.isBuffer(read) ? read : Buffer.from(read as Uint8Array);
		if (entry.compressed && hasZlibHead(data)) {
			try {
				return Readable.from([await inflateZlibBuffer(data)]);
			} catch {
				// A payload the head calls packed but that does not hold a whole zlib stream is handed
				// over as it stands, where the reference's own reader would throw.
			}
		}
		return Readable.from([data]);
	},
});
