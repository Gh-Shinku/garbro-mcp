// Format reference: GARBro Legacy/Melonpan/ArcTTD.cs, class `TtdOpener`.
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

/** The signature is the four bytes `WCW\0`. */
const SIGNATURE = 0x00574357;
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 12;
/** A record is a size word, an offset word, and a name of the derived width. */
const RECORD_HEADER_SIZE = 0xc;
const MIN_NAME_LENGTH = 8;
const WORD_SIZE = 4;
/** Packed payloads announce themselves with this marker. */
const PACKED_MARKER = Buffer.from("DSFF", "ascii");
const PACKED_HEADER_SIZE = 8;
/** GARBro overrides the LZSS ring position for this format. */
const LZSS_FRAME_INIT_POSITION = 0xff0;

export const ttdDescriptor: FormatDescriptor = {
	id: "melonpan-ttd",
	name: "Melonpan resource archive",
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
			source: "Legacy/Melonpan/ArcTTD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `TtdOpener.TryOpen`. The entry count sits at 4 and the index starts at 12 with 0xC-byte
 * record headers: a size word and an offset word, followed by a name whose width the reference derives
 * from the first record's offset — `(first_offset - 12) / count - 0xC` — and requires to be at least
 * eight bytes. Each record advances by that fixed width.
 *
 * GARBro never sets the packed flag while reading the index; `TtdOpener.OpenEntry` sets it lazily when
 * a payload starts with `DSFF`, and then treats the following word as the unpacked size and decodes
 * everything behind the eight-byte header as LZSS with a ring position of 0xFF0 instead of the default.
 * The port performs the same inspection while reading the index so listing and extraction agree, and
 * marks those entries as having an inexact size because the decoder stops at the end of the stream.
 */
async function readTtdIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	// The header is followed by the first record's size and offset words, which set the name width.
	if (source.size < BigInt(INDEX_OFFSET + RECORD_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + RECORD_HEADER_SIZE);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = header.readInt32LE(INDEX_OFFSET + WORD_SIZE);
	const nameLength =
		Math.trunc((firstOffset - INDEX_OFFSET) / count) - RECORD_HEADER_SIZE;
	if (nameLength < MIN_NAME_LENGTH) return undefined;
	const recordSize = RECORD_HEADER_SIZE + nameLength;
	if (recordSize <= RECORD_HEADER_SIZE) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = BigInt(INDEX_OFFSET + id * recordSize);
		if (record + BigInt(recordSize) > source.size) return undefined;
		const field = await source.readAt(record, recordSize);
		const size = BigInt(field.readUInt32LE(0));
		const offset = BigInt(field.readUInt32LE(WORD_SIZE));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const nameField = field.subarray(RECORD_HEADER_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;

		let packed = false;
		let unpackedSize = size;
		if (size > BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				packed = true;
				unpackedSize = BigInt(probe.readUInt32LE(PACKED_MARKER.length));
			}
		}
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : size,
			packedSize: size,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `TtdOpener.OpenEntry`: `DSFF` payloads are LZSS streams with a raised ring position. */
async function openTtdEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(
			entry.packedSize - BigInt(PACKED_HEADER_SIZE),
			"LZSS entry",
		),
	);
	return Readable.from([
		inflateLzssAll(stored, { frameInitPosition: LZSS_FRAME_INIT_POSITION }),
	]);
}

export const ttdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ttdDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTtdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readTtdIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Melonpan TTD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openTtdEntry,
});
