// Format reference: GARBro ArcFormats/Nejii/ArcCDT.cs, class `CdtOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive ends with a twelve-byte trailer that names this engine. */
const TRAILER_SIZE = 12;
const TRAILER = Buffer.from("RK1\0", "latin1");
/** Offsets inside the trailer: the count at 4 and the index offset at 8. */
const TRAILER_COUNT_OFFSET = 4;
const TRAILER_INDEX_OFFSET = 8;
/** A record is a fixed name field followed by four words. */
const NAME_SIZE = 0x10;
const RECORD_SIZE = NAME_SIZE + 0x10;
const STORED_SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
const PACKED_FIELD = 8;
const DATA_OFFSET_FIELD = 12;

export const nejiiCdtDescriptor: FormatDescriptor = {
	id: "nejii-cdt",
	name: "NEJII engine resource archive",
	extensions: ["cdt", "pdt", "vdt", "ovd"],
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
			source: "ArcFormats/Nejii/ArcCDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `CdtOpener.TryOpen`. The archive identifies itself from the end: the last twelve bytes hold
 * `RK1` and a null, the entry count, and the index offset, which must point inside the file.
 *
 * Records are 0x20 bytes wide: a 0x10-byte name field, the stored size, the unpacked size, a word that
 * marks the entry as compressed when it is non-zero, and the data offset. `CdtOpener.OpenEntry` decodes
 * compressed payloads as LZSS streams with GARbro's `LzssStream` defaults, which match
 * `@garbro-mcp/codecs`, and the port marks those entries as having an inexact size because the decoder
 * stops at the end of the stored stream rather than at the declared output length.
 */
async function readCdtIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size <= BigInt(TRAILER_SIZE)) return undefined;
	const trailerOffset = source.size - BigInt(TRAILER_SIZE);
	const trailer = await source.readAt(trailerOffset, TRAILER_SIZE);
	if (!trailer.subarray(0, TRAILER.length).equals(TRAILER)) return undefined;
	const count = trailer.readInt32LE(TRAILER_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(trailer.readUInt32LE(TRAILER_INDEX_OFFSET));
	if (indexOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameField = index.subarray(record, record + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const storedSize = BigInt(
			index.readUInt32LE(record + NAME_SIZE + STORED_SIZE_FIELD),
		);
		const unpackedSize = BigInt(
			index.readUInt32LE(record + NAME_SIZE + UNPACKED_SIZE_FIELD),
		);
		const packed = index.readInt32LE(record + NAME_SIZE + PACKED_FIELD) !== 0;
		const offset = BigInt(
			index.readUInt32LE(record + NAME_SIZE + DATA_OFFSET_FIELD),
		);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `CdtOpener.OpenEntry`: compressed payloads are LZSS streams with default settings. */
async function openCdtEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "LZSS entry"),
	);
	return Readable.from([inflateLzssAll(stored)]);
}

export const nejiiCdtFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nejiiCdtDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCdtIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCdtIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NEJII CDT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openCdtEntry,
});
