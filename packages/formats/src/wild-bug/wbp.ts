// Format reference: GARBro ArcFormats/WildBug/ArcWBP.cs, class `WbpOpener`.
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head spells `ARCFORM`, a version digit, and ` WBUG ` around it. */
const MAGIC = Buffer.from("ARCFORM", "ascii");
const VERSION_OFFSET = 7;
const VERSION_MINIMUM = 2;
const VERSION_MAXIMUM = 4;
const VERSION_FOUR = 4;
const TAIL_MAGIC = Buffer.from(" WBUG ", "ascii");
const TAIL_OFFSET = 8;
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET_FIELD = 0x14;
const INDEX_SIZE_FIELD = 0x18;
const DATA_OFFSET_FIELD = 0x1c;
/** A version 3 record holds a name length byte and the name behind a fixed header. */
const V3_NAME_LENGTH_OFFSET = 9;
const V3_NAME_OFFSET = 0x14;
const V3_RECORD_HEADER = 0x14;
/** Version 4 keeps two hash tables of a hundred entries each. */
const HASH_TABLE_ENTRIES = 0x100;
const DIRECTORY_TABLE_OFFSET = 0x24;
const RESOURCE_TABLE_OFFSET = 0x424;
const HASH_TABLE_BYTES = HASH_TABLE_ENTRIES * 4;
/** A directory record is a hash byte, a name length, a two-byte id and the name. */
const DIRECTORY_NAME_LENGTH_OFFSET = 1;
const DIRECTORY_ID_OFFSET = 2;
const DIRECTORY_NAME_OFFSET = 4;
const DIRECTORY_HEADER = 5;
/** A resource record adds a data offset and a size in front of a name that sits much further in. */
const RESOURCE_OFFSET_FIELD = 4;
const RESOURCE_SIZE_FIELD = 8;
const RESOURCE_NAME_OFFSET = 0x14;
const RESOURCE_HEADER = 0x18;
const RECORD_ALIGNMENT = 3;
/** Bounds the hash chains so a damaged index cannot loop forever. */
const MAXIMUM_CHAIN = 0x100000;

export const wbpDescriptor: FormatDescriptor = {
	id: "wildbug-wbp",
	name: "Wild Bug's engine resource archive",
	extensions: [],
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
			source: "ArcFormats/WildBug/ArcWBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The checksum a hash record must carry is the sum of its name bytes, reduced to eight bits. */
function nameChecksum(name: Buffer): number {
	let checksum = 0;
	for (const byte of name) checksum = (checksum + byte) & 0xff;
	return checksum;
}

/**
 * GARBro `WbpOpener.OpenV3`, shared by versions two and three. A record holds the data offset and size in
 * its first eight bytes, a name length byte at nine, and the name behind a 0x14-byte header, and the stride
 * is that header plus the name length with no alignment. Payload bounds are checked against the file.
 */
async function readV3(
	source: ByteSource,
	count: number,
	indexOffset: number,
): Promise<FixedEntry[] | undefined> {
	const entries: FixedEntry[] = [];
	let position = indexOffset;
	for (let id = 0; id < count; id += 1) {
		if (position + V3_RECORD_HEADER + 1 > Number(source.size)) return undefined;
		const header = await source.readAt(BigInt(position), V3_RECORD_HEADER + 1);
		const nameLength = header.readUInt8(V3_NAME_LENGTH_OFFSET);
		if (nameLength === 0) return undefined;
		const nameField = await source.readAt(
			BigInt(position + V3_NAME_OFFSET),
			nameLength,
		);
		const name = decodeCp932(nameField);
		if (name.length === 0) return undefined;
		const offset = BigInt(header.readUInt32LE(0));
		const size = BigInt(header.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		position += nameLength + V3_RECORD_HEADER;
	}
	return entries;
}

/**
 * GARBro `WbpOpener.OpenV4`. Two hundred-and-fifty-six-entry tables at 0x24 and 0x424 point at hash chains:
 * the directory table names the folders and the resource table names the entries inside them. Every record
 * begins with a hash byte that must equal its bucket index and, as a cross-check, the sum of its name bytes;
 * a directory record then carries a two-byte id and its name behind a five-byte header, and a resource
 * record carries the data offset and size in front of a name that sits at +0x14, advancing by its header plus
 * the name length rounded up to four bytes.
 *
 * Names are joined without a separator, because a directory name keeps whatever separator the archive
 * stored, and a leading backslash is trimmed from it. A resource naming a directory id that was never
 * declared rejects the archive, and the reference does not bound its chains, so the port adds a chain limit
 * while keeping its other checks, including the absent placement check that version four shares with neither
 * of the other two versions.
 */
async function readV4(
	source: ByteSource,
	indexOffset: number,
	indexSize: number,
): Promise<FixedEntry[] | undefined> {
	const dirTable = await source.readAt(
		BigInt(DIRECTORY_TABLE_OFFSET),
		HASH_TABLE_BYTES,
	);
	const resTable = await source.readAt(
		BigInt(RESOURCE_TABLE_OFFSET),
		HASH_TABLE_BYTES,
	);
	const indexEnd = BigInt(indexOffset + indexSize);

	const directories = new Map<number, string>();
	for (let bucket = 0; bucket < HASH_TABLE_ENTRIES; bucket += 1) {
		const start = dirTable.readUInt32LE(bucket * 4);
		if (start === 0) continue;
		let position = BigInt(start);
		for (let step = 0; step < MAXIMUM_CHAIN; step += 1) {
			if (position + BigInt(DIRECTORY_HEADER) > source.size) return undefined;
			const header = await source.readAt(position, DIRECTORY_HEADER);
			if (header.readUInt8(0) !== bucket) break;
			const nameLength = header.readUInt8(DIRECTORY_NAME_LENGTH_OFFSET);
			const dirId = header.readUInt16LE(DIRECTORY_ID_OFFSET);
			const nameField = await source.readAt(
				position + BigInt(DIRECTORY_NAME_OFFSET),
				nameLength,
			);
			if (nameChecksum(nameField) !== bucket) return undefined;
			directories.set(dirId, decodeCp932(nameField).replace(/^\\+/, ""));
			position += BigInt(DIRECTORY_HEADER + nameLength);
		}
	}

	const entries: FixedEntry[] = [];
	for (let bucket = 0; bucket < HASH_TABLE_ENTRIES; bucket += 1) {
		const start = resTable.readUInt32LE(bucket * 4);
		if (start === 0) continue;
		let position = BigInt(start);
		for (let step = 0; step < MAXIMUM_CHAIN; step += 1) {
			if (position >= indexEnd) break;
			const header = await source.readAt(position, RESOURCE_NAME_OFFSET);
			if (header.readUInt8(0) !== bucket) break;
			const nameLength = header.readUInt8(DIRECTORY_NAME_LENGTH_OFFSET);
			const dirId = header.readUInt16LE(DIRECTORY_ID_OFFSET);
			const nameField = await source.readAt(
				position + BigInt(RESOURCE_NAME_OFFSET),
				nameLength,
			);
			if (nameChecksum(nameField) !== bucket) return undefined;
			const directory = directories.get(dirId);
			// The reference indexes its table directly and would throw for an unknown id.
			if (directory === undefined) return undefined;
			const name = directory + decodeCp932(nameField);
			if (name.length === 0) return undefined;
			const offset = BigInt(header.readUInt32LE(RESOURCE_OFFSET_FIELD));
			const size = BigInt(header.readUInt32LE(RESOURCE_SIZE_FIELD));
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(name),
					offset,
					size,
				}),
			);
			position += BigInt(
				(RESOURCE_HEADER + nameLength + RECORD_ALIGNMENT) & ~RECORD_ALIGNMENT,
			);
		}
	}
	return entries;
}

/**
 * GARBro `WbpOpener.TryOpen`. The head spells `ARCFORM`, a version digit and ` WBUG `; the version must be
 * two, three or four, the entry count sits at 0x10, and the index offset, index size and data offset follow.
 * The data offset must not precede the index and must stay inside the file, and the index must fit.
 *
 * Versions two and three share one record layout and version four uses hash tables instead, so the port
 * splits at four exactly as the reference does. Payloads are stored verbatim.
 */
async function readWbpIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DATA_OFFSET_FIELD + 4)) return undefined;
	const header = await source.readAt(0n, DATA_OFFSET_FIELD + 4);
	if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
	if (
		!header
			.subarray(TAIL_OFFSET, TAIL_OFFSET + TAIL_MAGIC.length)
			.equals(TAIL_MAGIC)
	)
		return undefined;
	const version = (header.readUInt8(VERSION_OFFSET) - 0x30) | 0;
	if (version < VERSION_MINIMUM || version > VERSION_MAXIMUM) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_FIELD);
	const indexSize = header.readUInt32LE(INDEX_SIZE_FIELD);
	const dataOffset = header.readUInt32LE(DATA_OFFSET_FIELD);
	if (dataOffset < indexOffset || BigInt(dataOffset) > source.size)
		return undefined;
	if (BigInt(indexOffset + indexSize) > source.size) return undefined;
	if (version === VERSION_FOUR) {
		return readV4(source, indexOffset, indexSize);
	}
	return readV3(source, count, indexOffset);
}

export const wbpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wbpDescriptor,
	detection: { signatures: [{ bytes: MAGIC }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWbpIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWbpIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Wild Bug WBP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
