// Format reference: GARBro ArcFormats/JamCreation/ArcDAT.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
/** The index always lives in a sibling file with this name, which is never opened as a volume. */
const INDEX_FILE_NAME = "00000000.dat";
const VERSION_OFFSET = 0x14;
const VERSION = 1;
/** Five section descriptors, each an offset and a size, start at 0x18. */
const TABLE_OFFSET = 0x18;
const TABLE_ENTRIES = 5;
const TABLE_RECORD_SIZE = 8;
const HEADER_SIZE = TABLE_OFFSET + TABLE_ENTRIES * TABLE_RECORD_SIZE;
/** Section records are 24 bytes and carry a flag word at 0x10. */
const ENTRY_STRIDE = 24;
const WORD_SIZE = 4;
const ID_FIELD = 0;
const OFFSET_FIELD = 4;
const SIZE_FIELD = 8;
const UNPACKED_SIZE_FIELD = 12;
const FLAGS_FIELD = 0x10;
/** A flag word of exactly this value marks a directory rather than a file. */
const DIRECTORY_FLAGS = 0x80000000;
const PACKED_FLAG = 0x100;
const ENCRYPTED_FLAG = 0x200;

export const jamDatDescriptor: FormatDescriptor = {
	id: "jam-creation-dat",
	name: "Jam Creation resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/JamCreation/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `DatOpener.Decrypt`. A delta cipher: each byte subtracts the running index plus the previous
 * decrypted byte, both reduced to eight bits, and the first byte is left alone.
 */
function decryptDelta(data: Buffer, length: number): Buffer {
	if (data.length === 0) return data;
	let previous = data[0] ?? 0;
	for (
		let position = 1;
		position < length && position < data.length;
		position += 1
	) {
		const value =
			((data[position] ?? 0) - ((position + previous) & 0xff)) & 0xff;
		data[position] = value;
		previous = value;
	}
	return data;
}

interface Section {
	offset: number;
	size: number;
}

function readUInt32Le(data: Buffer, offset: number): number {
	if (offset + 4 > data.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Jam Creation index is truncated");
	}
	return data.readUInt32LE(offset);
}

function readSection(data: Buffer, start: number, length: number): Buffer {
	return decryptDelta(data.subarray(start, start + length), length);
}

function readCString(data: Buffer, offset: number): string | undefined {
	if (offset < 0 || offset >= data.length) return undefined;
	const terminator = data.indexOf(0, offset);
	const end = terminator === -1 ? data.length : terminator;
	return decodeCp932(data.subarray(offset, end));
}

/**
 * GARBro `DatOpener.ReadIndex`. The index is a sibling `00000000.dat`, and the volume file itself only
 * supplies payload bytes and the length its entries are validated against. The index header checks a
 * version word at 0x14, then describes five sections at 0x18 as offset and size pairs: a 24-byte record
 * table behind a count, a name offset table behind a count, a name pool, and the same pair for archive
 * names.
 *
 * Every section is decrypted with a delta cipher that runs only as far as the count it announces, which
 * the port reproduces. Archive names map a volume's file name to an identifier, and the record table is
 * then walked in 24-byte strides: a flag word of exactly 0x80000000 sets the directory name that prefixes
 * the entries that follow, while any other record adds an entry when its identifier matches this volume.
 * The reference skips records that fail the placement check rather than rejecting the archive, and it
 * keeps no entries at all as a failure.
 */
async function readJamIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const archiveName = basename(sourcePath);
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (archiveName.toLowerCase() === INDEX_FILE_NAME) return undefined;
	const companion = await readCompanionFile(sourcePath, INDEX_FILE_NAME);
	if (!companion || companion.length < HEADER_SIZE) return undefined;
	if (readUInt32Le(companion, VERSION_OFFSET) !== VERSION) return undefined;

	const sections: Section[] = [];
	for (let index = 0; index < TABLE_ENTRIES; index += 1) {
		const position = TABLE_OFFSET + index * TABLE_RECORD_SIZE;
		sections.push({
			offset: readUInt32Le(companion, position),
			size: readUInt32Le(companion, position + 4),
		});
	}
	for (const section of sections) {
		if (section.size < 4) return undefined;
		if (
			BigInt(section.offset) + BigInt(section.size) >
			BigInt(companion.length)
		)
			return undefined;
	}
	const [
		recordSection,
		nameSection,
		namePoolSection,
		arcNameSection,
		arcPoolSection,
	] = sections as [Section, Section, Section, Section, Section];

	const count = companion.readInt32LE(recordSection.offset);
	if (!isSaneCount(count)) return undefined;
	if (ENTRY_STRIDE * count > recordSection.size - 4) return undefined;
	const records = readSection(
		companion,
		recordSection.offset + 4,
		ENTRY_STRIDE * count,
	);

	const nameCount = companion.readInt32LE(nameSection.offset);
	if (nameCount < 0 || WORD_SIZE * nameCount > nameSection.size - 4)
		return undefined;
	const nameOffsets = readSection(
		companion,
		nameSection.offset + 4,
		WORD_SIZE * nameCount,
	);
	const namePool = readSection(
		companion,
		namePoolSection.offset,
		namePoolSection.size,
	);

	const arcCount = companion.readInt32LE(arcNameSection.offset);
	if (arcCount < 0 || WORD_SIZE * arcCount > arcNameSection.size - 4)
		return undefined;
	const arcNameOffsets = readSection(
		companion,
		arcNameSection.offset + 4,
		WORD_SIZE * arcCount,
	);
	const arcPool = readSection(
		companion,
		arcPoolSection.offset,
		arcPoolSection.size,
	);

	let archiveId = -1;
	for (let index = 0; index < arcCount; index += 1) {
		const nameOffset = arcNameOffsets.readInt32LE(index * WORD_SIZE);
		const name = readCString(arcPool, nameOffset);
		if (name === archiveName) {
			archiveId = index;
			break;
		}
	}
	if (archiveId === -1) return undefined;

	const entries: FixedEntry[] = [];
	let directory = "";
	for (let index = 0; index < count; index += 1) {
		const position = index * ENTRY_STRIDE;
		const flags = records.readUInt32LE(position + FLAGS_FIELD);
		if (flags === DIRECTORY_FLAGS) {
			const nameOffset = nameOffsets.readInt32LE(index * WORD_SIZE);
			directory = readCString(namePool, nameOffset) ?? "";
			continue;
		}
		if (records.readInt32LE(position + ID_FIELD) !== archiveId) continue;
		const nameOffset = nameOffsets.readInt32LE(index * WORD_SIZE);
		const name = readCString(namePool, nameOffset);
		if (name === undefined) continue;
		const offset = BigInt(records.readUInt32LE(position + OFFSET_FIELD));
		const storedSize = BigInt(records.readUInt32LE(position + SIZE_FIELD));
		const unpackedSize = BigInt(
			records.readUInt32LE(position + UNPACKED_SIZE_FIELD),
		);
		// GARbro skips a misplaced record instead of rejecting the whole index.
		if (!checkPlacement(offset, storedSize, source.size)) continue;
		const packed = (flags & PACKED_FLAG) !== 0;
		const encrypted = (flags & ENCRYPTED_FLAG) !== 0;
		const path = directory.length === 0 ? name : `${directory}/${name}`;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(path),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
			encrypted,
			metadata: { archiveId, packed, encrypted, unpackedSize },
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARBro `DatOpener.OpenEntry`. Packing wins over encryption, so an entry carrying both flags is only
 * unzipped; an entry that is merely encrypted has the delta cipher applied to its bytes, which keeps its
 * length; everything else is stored verbatim.
 */
async function openJamEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (entry.compressed) return createZlibInflateStream(Readable.from([stored]));
	if (entry.metadata?.encrypted === true) {
		return Readable.from([decryptDelta(stored, stored.length)]);
	}
	return Readable.from([stored]);
}

export const jamDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: jamDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readJamIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readJamIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Jam Creation layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openJamEntry,
});
