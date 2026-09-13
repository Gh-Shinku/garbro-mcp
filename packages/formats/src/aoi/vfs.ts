// Format reference: GARBro ArcFormats/Aoi/ArcVFS.cs, class `VfsOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "vfs";
/** The two signatures are the words `FV` and `VL`. */
const SIGNATURE_FV = 0x4656;
const SIGNATURE_VL = 0x4c56;
const VERSION_OFFSET = 2;
const COUNT_OFFSET = 4;
const ENTRY_SIZE_OFFSET = 6;
const INDEX_SIZE_OFFSET = 8;
const FILE_SIZE_FIELD = 0x0c;
const HEADER_SIZE = 0x10;
/** Versions at or above this word use the wider records with a separate name pool. */
const VERSION_TWO = 0x0200;
const INDEX_OFFSET = 0x10;
/** A version one record is a 0x13-byte name field and four words. */
const V1_NAME_SIZE = 0x13;
const V1_OFFSET_FIELD = 0x13;
const V1_SIZE_FIELD = 0x17;
const V1_UNPACKED_FIELD = 0x1b;
const V1_PACKED_FIELD = 0x1f;
/** A version two record points into a UTF-16 name pool instead of carrying its own name. */
const V2_NAME_OFFSET_FIELD = 0;
const V2_OFFSET_FIELD = 0x0a;
const V2_SIZE_FIELD = 0x0e;
const V2_UNPACKED_FIELD = 0x12;
const V2_PACKED_FIELD = 0x16;
/** The name pool holds a character count, then four bytes the reference skips before the text. */
const POOL_LENGTH_SIZE = 4;
const POOL_HEADER_SIZE = 8;
const UTF16_CHAR_SIZE = 2;

export const vfsDescriptor: FormatDescriptor = {
	id: "aoi-vfs",
	name: "Aoi engine resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Aoi/ArcVFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * A name read out of the version two pool, which stops at the first null character.
 */
function poolName(pool: string, start: number): string {
	const end = pool.indexOf("\u0000", start);
	return end === -1 ? pool.slice(start) : pool.slice(start, end);
}

/**
 * GARBro `VfsOpener.OpenV2`, the layout versions from 0x0200 onward use. Records keep the stride the header
 * announces but hold only a character index into a UTF-16 name pool that trails them, followed by the data
 * offset, both sizes and the packed flag. The pool begins right behind the last record with a character count,
 * and the reference skips four bytes behind that count before reading the text — so the text sits eight bytes
 * into the pool block, not four.
 *
 * A character index outside the pool rejects the archive, as does a name that is empty. Payloads are stored
 * verbatim, because neither version in the reference installs an entry decoder, so the packed flag is only a
 * hint for the image and audio layers above.
 */
async function readV2Index(
	source: ByteSource,
	count: number,
	entrySize: number,
): Promise<FixedEntry[] | undefined> {
	const recordsSize = entrySize * count;
	if (BigInt(INDEX_OFFSET + recordsSize + POOL_LENGTH_SIZE) > source.size)
		return undefined;
	const records = await source.readAt(BigInt(INDEX_OFFSET), recordsSize);
	const poolOffset = BigInt(INDEX_OFFSET + recordsSize);
	const poolLength = (
		await source.readAt(poolOffset, POOL_LENGTH_SIZE)
	).readInt32LE(0);
	if (poolLength < 0) return undefined;
	const poolBytes = poolLength * UTF16_CHAR_SIZE;
	if (poolOffset + BigInt(POOL_HEADER_SIZE + poolBytes) > source.size)
		return undefined;
	const poolBuffer = await source.readAt(
		poolOffset + BigInt(POOL_HEADER_SIZE),
		poolBytes,
	);
	const pool = poolBuffer.toString("utf16le");

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * entrySize;
		if (record + V2_PACKED_FIELD + 1 > records.length) return undefined;
		const nameOffset = records.readInt32LE(record + V2_NAME_OFFSET_FIELD);
		if (nameOffset < 0 || nameOffset >= poolLength) return undefined;
		const name = poolName(pool, nameOffset);
		if (name.length === 0) return undefined;
		const offset = BigInt(records.readUInt32LE(record + V2_OFFSET_FIELD));
		const size = BigInt(records.readUInt32LE(record + V2_SIZE_FIELD));
		const unpackedSize = BigInt(
			records.readUInt32LE(record + V2_UNPACKED_FIELD),
		);
		const packed = records.readUInt8(record + V2_PACKED_FIELD) !== 0;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				packedSize: size,
				compressed: packed,
				metadata: { packed, unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return entries;
}

/**
 * GARBro `VfsOpener.TryOpen`. The first word is one of two signatures — `FV` or `VL` — followed by a version,
 * the entry count, the record stride and an index size, while the word at 0xC must equal the file's own length.
 * A stride or index size of zero or less rejects the archive, and the count is the only sane-count check.
 *
 * Versions below 0x0200 store each entry's name in a 0x13-byte field inside its own record, with the data
 * offset, both sizes and the packed flag behind it. The format carries no extension beyond its `.vfs` name, so
 * the header fields and the length cross-check are the detection.
 */
async function readVfsIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const signature = header.readUInt16LE(0);
	if (signature !== SIGNATURE_FV && signature !== SIGNATURE_VL)
		return undefined;
	const version = header.readUInt16LE(VERSION_OFFSET);
	const count = header.readUInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const entrySize = header.readInt16LE(ENTRY_SIZE_OFFSET);
	const indexSize = header.readInt32LE(INDEX_SIZE_OFFSET);
	if (entrySize <= 0 || indexSize <= 0) return undefined;
	if (BigInt(header.readUInt32LE(FILE_SIZE_FIELD)) !== source.size)
		return undefined;
	if (version >= VERSION_TWO) return readV2Index(source, count, entrySize);

	const recordsSize = entrySize * count;
	if (entrySize < V1_PACKED_FIELD + 1) return undefined;
	if (BigInt(INDEX_OFFSET + recordsSize) > source.size) return undefined;
	const records = await source.readAt(BigInt(INDEX_OFFSET), recordsSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * entrySize;
		const nameField = records.subarray(record, record + V1_NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(records.readUInt32LE(record + V1_OFFSET_FIELD));
		const size = BigInt(records.readUInt32LE(record + V1_SIZE_FIELD));
		const unpackedSize = BigInt(
			records.readUInt32LE(record + V1_UNPACKED_FIELD),
		);
		const packed = records.readUInt8(record + V1_PACKED_FIELD) !== 0;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				packedSize: size,
				compressed: packed,
				metadata: { packed, unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return entries;
}

export const vfsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vfsDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVfsIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readVfsIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aoi VFS layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
