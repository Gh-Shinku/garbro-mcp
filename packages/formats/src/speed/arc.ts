// Format reference: GARBro ArcFormats/Speed/ArcARC.cs
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

/** The archive head doubles as GARbro's signature, so the first table's record length is fixed. */
const SIGNATURE = 0xff;
const NAME_RECORD_OFFSET = 0;
const NAME_RECORD_COUNT_OFFSET = 4;
const ENTRY_COUNT_OFFSET = 8;
const NAME_TABLE_OFFSET = 0x10;
const MIN_RECORD_LENGTH = 0x10;
const MAX_RECORD_LENGTH = 0x200;
/** The reference reserves two extra records in front of each table. */
const TABLE_PADDING_RECORDS = 2;
/** The second-level table holds 32-bit offsets. */
const OFFSET_RECORD_LENGTH = 4;
const SECOND_HEADER_OFFSET = 0x10;
/** Payloads are preceded by a size word, and images by a sixteen-byte image header. */
const DATA_PREFIX = 4;
const IMAGE_PREFIX = 16;

/**
 * Extensions the reference classifies as images through its resource catalog. The port has no
 * catalog, so it approximates the classification with the same extension list to decide whether an
 * entry is preceded by an image header.
 */
const IMAGE_EXTENSIONS = new Set([
	"bmp",
	"dds",
	"gif",
	"jpeg",
	"jpg",
	"png",
	"tga",
	"tif",
	"tiff",
	"webp",
]);

export const speedArcDescriptor: FormatDescriptor = {
	id: "speed-arc",
	name: "REC engine resource archive",
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
			source: "ArcFormats/Speed/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isImageName(name: string): boolean {
	const extension = name.split(".").pop();
	if (extension === undefined || extension === name) return false;
	return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * GARBro `ArcOpener.TryOpen`. The first word doubles as the signature and as the record length of the
 * name table, so it is always `0xFF`; the record count follows at 4 and the entry count at 8. Behind
 * the name table sits a second header whose record length must be four, followed by the offset table
 * and the payloads themselves.
 *
 * Every entry's payload is preceded by a size word, and images add a further twelve bytes on top of
 * it. Because the index stores no sizes, they are derived from the distance to the next entry, minus
 * that size word, and the final entry runs to the end of the file. GARbro assigns those offsets using
 * its resource catalog; the port approximates that with an extension list.
 */
async function readSpeedArcIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(NAME_TABLE_OFFSET)) return undefined;
	const header = await source.readAt(0n, NAME_TABLE_OFFSET);
	if (header.readUInt32LE(NAME_RECORD_OFFSET) !== SIGNATURE) return undefined;
	const recordLength = header.readUInt32LE(NAME_RECORD_OFFSET);
	if (recordLength < MIN_RECORD_LENGTH || recordLength > MAX_RECORD_LENGTH)
		return undefined;
	const recordCount = header.readUInt32LE(NAME_RECORD_COUNT_OFFSET);
	const count = header.readInt32LE(ENTRY_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (recordCount < count) return undefined;
	if (BigInt(recordLength) * BigInt(recordCount) >= source.size)
		return undefined;
	if (BigInt(NAME_TABLE_OFFSET + recordLength * count) > source.size)
		return undefined;

	const nameTable = await source.readAt(
		BigInt(NAME_TABLE_OFFSET),
		recordLength * count,
	);
	const names: string[] = [];
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * recordLength;
		const field = nameTable.subarray(record, record + recordLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		names.push(name);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: 0n,
				size: 0n,
			}),
		);
	}

	// The second header trails the padded name table.
	const secondOffset = BigInt(
		NAME_TABLE_OFFSET + recordLength * (recordCount + TABLE_PADDING_RECORDS),
	);
	if (secondOffset + BigInt(SECOND_HEADER_OFFSET) > source.size)
		return undefined;
	const second = await source.readAt(secondOffset, SECOND_HEADER_OFFSET);
	const offsetRecordLength = second.readUInt32LE(0);
	const offsetRecordCount = second.readUInt32LE(4);
	if (offsetRecordLength !== OFFSET_RECORD_LENGTH) return undefined;
	if (second.readInt32LE(8) !== count) return undefined;

	const tableOffset = secondOffset + BigInt(SECOND_HEADER_OFFSET);
	const dataOffset =
		tableOffset +
		BigInt(offsetRecordLength * (offsetRecordCount + TABLE_PADDING_RECORDS)) +
		BigInt(DATA_PREFIX);
	if (BigInt(offsetRecordLength * count) > source.size) return undefined;
	const offsets = await source.readAt(tableOffset, offsetRecordLength * count);

	const starts: bigint[] = [];
	for (const [id, entry] of entries.entries()) {
		const name = names[id] ?? "";
		const base =
			dataOffset + BigInt(offsets.readUInt32LE(id * offsetRecordLength));
		const offset =
			base + BigInt(isImageName(name) ? IMAGE_PREFIX : DATA_PREFIX);
		if (offset > source.size) return undefined;
		starts.push(offset);
		entry.offset = offset;
	}
	for (const [id, entry] of entries.entries()) {
		const next = starts[id + 1];
		const size =
			next === undefined
				? source.size - entry.offset
				: next - BigInt(DATA_PREFIX) - entry.offset;
		if (size < 0n) return undefined;
		entry.size = size;
		// The size word in front of the payload is authoritative for extraction.
		const declared =
			entry.offset >= BigInt(DATA_PREFIX)
				? (
						await source.readAt(entry.offset - BigInt(DATA_PREFIX), 4)
					).readUInt32LE(0)
				: undefined;
		entry.packedSize =
			declared !== undefined &&
			checkPlacement(entry.offset, BigInt(declared), source.size)
				? BigInt(declared)
				: size;
	}
	return entries;
}

export const speedArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: speedArcDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0xff, 0, 0, 0]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSpeedArcIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSpeedArcIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid REC archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.offset < BigInt(DATA_PREFIX))
			throw new GarbroError("INVALID_ARCHIVE", "Missing payload size word");
		const size = BigInt(
			(await source.readAt(entry.offset - BigInt(DATA_PREFIX), 4)).readUInt32LE(
				0,
			),
		);
		if (!checkPlacement(entry.offset, size, source.size))
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Payload lies outside the archive",
			);
		return source.createReadStream(entry.offset, size);
	},
});
