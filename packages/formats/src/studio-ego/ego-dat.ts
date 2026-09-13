// Format reference: GARBro ArcFormats/StudioEgo/ArcEGO.cs, classes `DatOpener` and `OldDatOpener`.
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const LENGTH_OFFSET = 0;
const INDEX_OFFSET = 4;
/** The index region starts this far behind the length word and must be large enough for one record. */
const MINIMUM_DATA_OFFSET = 0x14;
/** A record's span may not exceed this, which bounds its embedded name. */
const MAXIMUM_ENTRY_LENGTH = 0x100;
/** The newer layout puts a name at 0x10 and the offsets before it; the older one uses 0xC. */
const NEW_HEADER_SIZE = 0x10;
const OLD_HEADER_SIZE = 0x0c;
const OFFSET_TAIL = 8;
const SIZE_TAIL = 4;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/StudioEgo/ArcEGO.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const egoDatDescriptor: FormatDescriptor = {
	id: "studio-ego-dat-1",
	name: "Studio e.go! engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const egoOldDatDescriptor: FormatDescriptor = {
	id: "studio-ego-dat-0",
	name: "Studio e.go! engine resource archive, older layout",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/**
 * GARBro's shared index walk. The region length is the word at 0 plus four, and it must lie behind the
 * smallest possible index and inside the file. Records follow at 4 and are *variable* in size: each begins
 * with its own length, which must exceed the header size, stay within 0x100, and not cross the payload
 * start, and the name fills the rest of the record behind the header. The data offset and the size sit at the
 * end of the header, so both layouts share this walk and differ only in where that header ends.
 *
 * The reference accepts an empty name; the port rejects one, as it does for the other formats it ports, since
 * an entry without a path cannot be listed usefully.
 */
function readEgoIndex(
	index: Buffer,
	dataOffset: bigint,
	headerSize: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const entries: FixedEntry[] = [];
	const offsetField = headerSize - OFFSET_TAIL;
	const sizeField = headerSize - SIZE_TAIL;
	let cursor = BigInt(INDEX_OFFSET);
	while (cursor < dataOffset) {
		// The buffer begins at the index offset, so its positions are relative to it.
		const position = Number(cursor - BigInt(INDEX_OFFSET));
		if (position + headerSize > index.length) return undefined;
		const entryLength = BigInt(index.readUInt32LE(position + LENGTH_OFFSET));
		if (
			entryLength <= BigInt(headerSize) ||
			entryLength > BigInt(MAXIMUM_ENTRY_LENGTH)
		)
			return undefined;
		if (cursor + entryLength > dataOffset) return undefined;
		const nameLength = Number(entryLength) - headerSize;
		const nameField = index.subarray(
			position + headerSize,
			position + headerSize + nameLength,
		);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(position + offsetField));
		const size = BigInt(index.readUInt32LE(position + sizeField));
		if (offset < dataOffset) return undefined;
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		cursor += entryLength;
	}
	return entries;
}

/** Reads the shared header fields both layouts use. */
async function readEgoHeader(source: ByteSource): Promise<bigint | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + OFFSET_TAIL)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const dataOffset =
		BigInt(header.readUInt32LE(LENGTH_OFFSET)) + BigInt(INDEX_OFFSET);
	if (dataOffset <= BigInt(MINIMUM_DATA_OFFSET) || dataOffset >= source.size)
		return undefined;
	return dataOffset;
}

/**
 * GARBro `DatOpener.TryOpen`, the newer layout. Its records use a 0x10-byte header, so the data offset sits at
 * +8, the size at +0xC, and the name fills everything behind them. The reference also implements archive
 * creation for this variant, which is outside the scope of this read-only port, and it carries no signature or
 * extension, so the structural checks are the detection.
 */
async function readEgoDatIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const dataOffset = await readEgoHeader(source);
	if (dataOffset === undefined) return undefined;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		Number(dataOffset - BigInt(INDEX_OFFSET)),
	);
	return readEgoIndex(index, dataOffset, NEW_HEADER_SIZE, source.size);
}

/**
 * GARBro `OldDatOpener.TryOpen`, the older layout. Its records use a 0xC-byte header, which moves the data
 * offset to +4 and the size to +8 and leaves four more bytes to the name, so the shape of a record decides
 * which of the two layouts an archive belongs to.
 */
async function readEgoOldDatIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const dataOffset = await readEgoHeader(source);
	if (dataOffset === undefined) return undefined;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		Number(dataOffset - BigInt(INDEX_OFFSET)),
	);
	return readEgoIndex(index, dataOffset, OLD_HEADER_SIZE, source.size);
}

export const egoDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: egoDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readEgoDatIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readEgoDatIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio e.go! DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const egoOldDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: egoOldDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readEgoOldDatIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readEgoOldDatIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio e.go! older DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
