// Format reference: GARbro "ArcFormats/Qlie/ArcQLIE.cs", classes `PackOpener`, `QlieArchive`,
// `QlieEntry` and `PackIndexReader`, of the walks of the places of the file of "Encryption.cs".
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { decompressQliePack } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import {
	createQlieEncryption,
	ENCRYPTION_NONE,
	type QlieEncryption,
} from "./encryption.js";

const INDEX_SIZE = 0x1c;
const MARK = "FilePackVer";
const MARK_SIZE = MARK.length;
const MAJOR_AT = 0x0b;
const DOT_AT = 0x0c;
const MINOR_AT = 0x0d;
const COUNT_AT = 0x10;
const OFFSET_AT = 0x14;
const MAX_NAME = 0x100;
const DIGIT = 0x30;
const DOT = 0x2e;
/** The places of the file of the walk of the engine of the third kind of it at the end of the file. */
const ENGINE_KEY_AT = 0x41c;
const ENGINE_KEY_SIZE = 0x100;

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

/** The head of the index of the engine at the end of the archive of it. */
export interface QlieLayout {
	major: number;
	minor: number;
	count: number;
	indexOffset: number;
}

/**
 * `PackIndexReader`'s head: the letters `FilePackVer`, the places of the file of the version of the
 * engine, the count of the entries of it and the places of the file of the index of them.
 */
export function readQlieLayout(data: Buffer): QlieLayout | undefined {
	if (data.length <= INDEX_SIZE) return undefined;
	const at = data.length - INDEX_SIZE;
	if (data.toString("latin1", at, at + MARK_SIZE) !== MARK) return undefined;
	if (DOT !== data[at + DOT_AT]) return undefined;
	const major = (data[at + MAJOR_AT] ?? 0) - DIGIT;
	const minor = (data[at + MINOR_AT] ?? 0) - DIGIT;
	const count = data.readInt32LE(at + COUNT_AT);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = Number(data.readBigInt64LE(at + OFFSET_AT));
	// The reference stands of the places of the file of the *head* of the index of the engine of the
	// walk of the places of the file of the index of it; this port stands of the places of the file of
	// the index of the engine itself, of the walk of the places of the file of it alone.
	if (
		!Number.isSafeInteger(indexOffset) ||
		indexOffset < 0 ||
		indexOffset >= data.length
	) {
		return undefined;
	}
	return { major, minor, count, indexOffset };
}

/** The places of the file of the walk of the engine of the third kind of it, of the archive of it. */
export function readEngineKeyData(data: Buffer): Buffer | undefined {
	const at = data.length - ENGINE_KEY_AT;
	if (at < 0) return undefined;
	return data.subarray(at, at + ENGINE_KEY_SIZE);
}

/** The places of the file of an entry of the engine, of the index of it. */
export interface QlieIndexEntry {
	name: string;
	offset: bigint;
	/** The places of the file of the entry of the engine of the walk of the places of the file of it. */
	size: number;
	unpackedSize: number;
	packed: boolean;
	encryptionMethod: number;
	hash: number;
}

/**
 * `PackIndexReader.Read`: the entries of the engine of the index of them. The places of the file of
 * the name of an entry stand of no places of the file of the walk of the engine of it of the count of
 * `0x100` of them or above: the reference stands of `null` for the archive of it.
 */
export function readQlieEntries(
	data: Buffer,
	layout: QlieLayout,
	encryption: QlieEncryption,
): QlieIndexEntry[] | undefined {
	const entries: QlieIndexEntry[] = [];
	let at = layout.indexOffset;
	for (let i = 0; i < layout.count; i += 1) {
		if (at + 2 > data.length) return undefined;
		let nameLength = data.readUInt16LE(at);
		at += 2;
		if (nameLength > MAX_NAME) return undefined;
		if (encryption.isUnicode) nameLength *= 2;
		if (at + nameLength > data.length) return undefined;
		const raw = Buffer.from(data.subarray(at, at + nameLength));
		at += nameLength;
		const name = encryption.decryptName(raw);
		if (at + 28 > data.length) return undefined;
		const offset = data.readBigInt64LE(at);
		at += 8;
		const size = data.readUInt32LE(at);
		at += 4;
		if (!checkPlacement(offset, BigInt(size), BigInt(data.length))) {
			return undefined;
		}
		const unpackedSize = data.readUInt32LE(at);
		at += 4;
		const packed = 0 !== data.readInt32LE(at);
		at += 4;
		const encryptionMethod = data.readInt32LE(at);
		at += 4;
		let hash = 0;
		if ("with-hash" === encryption.indexLayout) {
			hash = data.readUInt32LE(at);
			at += 4;
		}
		entries.push({
			name,
			offset,
			size,
			unpackedSize,
			packed,
			encryptionMethod,
			hash,
		});
	}
	return entries;
}

/**
 * `PackOpener.TryOpen`: the entries of the engine. `PackVer1.0` of the reference stands of no places
 * of the file of the walk of the engine of it alone, of the three walks of the places of the file of
 * the index of the engine behind the letters `FilePackVer1.0` of the head of it.
 */
function readQlieIndex(
	data: Buffer,
	layout: QlieLayout,
): QlieIndexEntry[] | undefined {
	const keyData = readEngineKeyData(data);
	if (1 === layout.major) {
		const walks: QlieEncryption[] = [];
		const first = createQlieEncryption(layout.major, layout.minor, keyData);
		walks.push(first);
		walks.push(createQlieEncryption(2, 0, keyData, "without-hash"));
		walks.push(createQlieEncryption(2, 0, keyData));
		for (const walk of walks) {
			const entries = readQlieEntries(data, layout, walk);
			if (entries) return entries;
		}
		return undefined;
	}
	const encryption = createQlieEncryption(layout.major, layout.minor, keyData);
	return readQlieEntries(data, layout, encryption);
}

/** The places of the file of the encryption of the engine of the index of the archive of it. */
function encryptionOf(
	keyData: Buffer,
	major: number,
	minor: number,
): QlieEncryption {
	return createQlieEncryption(major, minor, keyData);
}

/** The places of the file of the walk of the engine of an entry of the archive of it. */
interface QlieMetadata {
	major: number;
	minor: number;
	method: number;
	packed: boolean;
	stored: number;
}

function metadataOf(entry: FixedEntry): QlieMetadata {
	const metadata = entry.metadata as Partial<QlieMetadata> | undefined;
	if (
		!metadata ||
		"number" !== typeof metadata.major ||
		"number" !== typeof metadata.minor ||
		"number" !== typeof metadata.method ||
		"boolean" !== typeof metadata.packed ||
		"number" !== typeof metadata.stored
	) {
		throw invalidArchive(
			"The entry of the engine stands of no places of the file of it",
		);
	}
	return metadata as QlieMetadata;
}

/**
 * `PackOpener.ReadEntryBytes`: the places of the file of an entry of the engine: the walk of the
 * places of the file of the cipher of it first, of the walk of the places of the file of the picture
 * of it behind it.
 */
async function readEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Buffer> {
	const metadata = metadataOf(entry);
	const data = Buffer.from(await source.readAt(entry.offset, metadata.stored));
	if (0 !== metadata.method) {
		const keyData = await readTail(source);
		const encryption = encryptionOf(keyData, metadata.major, metadata.minor);
		encryption.decryptEntry(data, 0, data.length, {
			encryptionMethod: metadata.method,
			name: entry.path,
		});
	}
	if (metadata.packed) {
		try {
			return decompressQliePack(data);
		} catch {
			// `PackOpener.ReadEntryBytes`: the places of the file of the walk of the engine of an entry
			// of no places of the file of the mark of it stand of the places of the file of the entry of
			// the engine itself.
			return data;
		}
	}
	return data;
}

/** The places of the file of the walk of the engine of the third kind of it at the end of the file. */
async function readTail(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	const at = size - ENGINE_KEY_AT;
	if (!Number.isSafeInteger(at) || at < 0) {
		throw invalidArchive(
			"The archive of the engine of no places of the file of the key of it",
		);
	}
	return Buffer.from(await source.readAt(BigInt(at), ENGINE_KEY_SIZE));
}

export const qliePackDescriptor: FormatDescriptor = {
	id: "qlie-pack-archive",
	name: "QLIE engine resource archive",
	extensions: ["pack"],
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
			source: "ArcFormats/Qlie/ArcQLIE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const qliePackArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qliePackDescriptor,
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(INDEX_SIZE)) return false;
		try {
			const tail = await source.readAt(
				source.size - BigInt(INDEX_SIZE),
				INDEX_SIZE,
			);
			return Buffer.from(tail).toString("latin1", 0, MARK_SIZE) === MARK;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readQlieLayout(data);
		if (!layout) throw invalidArchive("Not an archive of the engine");
		void sourcePath;
		const entries = readQlieIndex(data, layout);
		if (!entries)
			throw invalidArchive(
				"The index of the engine stands of no places of the file of it",
			);
		const directory: FixedEntry[] = [];
		for (const entry of entries) {
			const known = normalizeEntryPath(entry.name);
			const size = BigInt(entry.packed ? entry.unpackedSize : entry.size);
			const base = {
				id: directory.length,
				path: known.path,
				offset: entry.offset,
				size,
				compressed: entry.packed || ENCRYPTION_NONE !== entry.encryptionMethod,
				metadata: {
					major: layout.major,
					minor: layout.minor,
					method: entry.encryptionMethod,
					packed: entry.packed,
					stored: entry.size,
				},
			};
			const fixed = createFixedEntry(
				entry.packed ? { ...base, packedSize: BigInt(entry.size) } : base,
			);
			directory.push(
				known.rawPath ? { ...fixed, rawPath: known.rawPath } : fixed,
			);
		}
		return {
			entries: directory,
			metadata: {
				major: layout.major,
				minor: layout.minor,
				count: entries.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([await readEntry(source, entry)]);
	},
});
