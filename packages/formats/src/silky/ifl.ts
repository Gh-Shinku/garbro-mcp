// Format reference: GARBro ArcFormats/Silky/ArcIFL.cs, class `IflOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature spells `IFLS`. */
const SIGNATURE = Buffer.from("IFLS", "ascii");
const DATA_OFFSET_FIELD = 4;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 12;
/** A record is a 0x10-byte name field followed by the data offset and size. */
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
const RECORD_SIZE = 0x18;
/** A payload announces its packed layout with this marker. */
const PACKED_MARKER = Buffer.from("CMP_", "ascii");
const PACKED_HEADER_SIZE = 12;
const UNPACKED_SIZE_FIELD = 4;
/** Payloads this short are never packed. */
const MINIMUM_PACKED_SIZE = 12;
/** Another Silky format owns these images, so they are emitted as stored. */
const FOREIGN_EXTENSION = "grd";
/** GARbro's LZSS ring fill for this format. */
const LZSS_FRAME_FILL = 0x20;

export const iflDescriptor: FormatDescriptor = {
	id: "silky-ifl",
	name: "Silky's engine resource archive",
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
			source: "ArcFormats/Silky/ArcIFL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `IflOpener.TryOpen`. The signature spells `IFLS`, a data offset sits at 4 and only bounds-checks the
 * header — the records' offsets are absolute and not relative to it — and the entry count at 8. Records follow at
 * 12 with a 0x18-byte stride: a 0x10-byte name field, the data offset and the size. A blank name rejects the
 * archive and every payload is checked against the file.
 *
 * `IflOpener.OpenEntry` marks a payload as packed lazily, when its span is longer than twelve bytes, its name is
 * not a `.grd` image belonging to another Silky format, and its first four bytes spell `CMP_`. Such a payload
 * declares its expanded length at +4 and holds an LZSS stream from +12, decoded with a ring fill of 0x20 rather
 * than the default. The port performs the same inspection while reading the index so listing and extraction agree,
 * and marks those entries as having an inexact size because the decoder stops at the end of the stream.
 */
async function readIflIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (dataOffset <= BigInt(INDEX_OFFSET) || dataOffset >= source.size)
		return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		let packed = false;
		let unpackedSize = storedSize;
		if (
			storedSize > BigInt(MINIMUM_PACKED_SIZE) &&
			sourceExtension(name) !== FOREIGN_EXTENSION
		) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				packed = true;
				unpackedSize = BigInt(probe.readUInt32LE(UNPACKED_SIZE_FIELD));
			}
		}
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

/**
 * GARBro `IflOpener.OpenEntry`. A packed payload declares its expanded length at +4 and holds an LZSS stream
 * behind the twelve-byte header, decoded with GARbro's ring fill of 0x20; everything else is emitted verbatim.
 */
async function openIflEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(
			entry.packedSize - BigInt(PACKED_HEADER_SIZE),
			"LZSS entry",
		),
	);
	return Readable.from([
		inflateLzssAll(stored, { frameFill: LZSS_FRAME_FILL }),
	]);
}

export const iflFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iflDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIflIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIflIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky IFL layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openIflEntry,
});
