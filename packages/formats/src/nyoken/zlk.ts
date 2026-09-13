// Format reference: GARBro Legacy/Nyoken/ArcZLK.cs, class `ZlkOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature spells `ZLK` and a space. */
const SIGNATURE = Buffer.from("ZLK ", "ascii");
const VERSION_OFFSET = 4;
const VERSION_MINIMUM = 1;
const VERSION_MAXIMUM = 100;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 12;
/** A record is three words, a flag byte, a name length byte and the name itself. */
const OFFSET_FIELD = 0;
const PACKED_SIZE_FIELD = 4;
const UNPACKED_SIZE_FIELD = 8;
const FLAGS_FIELD = 12;
const NAME_LENGTH_FIELD = 13;
const RECORD_HEADER_SIZE = 14;

export const zlkDescriptor: FormatDescriptor = {
	id: "nyoken-zlk",
	name: "Nyotai Kougaku Kenkyuujo resource archive",
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
			source: "Legacy/Nyoken/ArcZLK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `ZlkOpener.TryOpen`. The signature spells `ZLK` and a space, the word behind it is a version that must
 * land between one and a hundred, and the entry count sits at 8. Records follow at 12 with a stride that varies:
 * each holds the data offset, a packed size, an unpacked size, a flag byte and a name length byte, followed by
 * that many name bytes.
 *
 * A non-zero flag marks the payload as deflated, and the unpacked size is recorded alongside the stored span. The
 * reference checks the payload's placement against the file, which the port keeps, and it carries no extension, so
 * the header fields plus the record walk are the detection.
 *
 * `ZlkOpener.OpenEntry` streams a deflated payload through zlib without checking the result against the declared
 * length, so the port streams the output and marks those entries as having an inexact size. Stored payloads are
 * emitted verbatim.
 */
async function readZlkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = header.readInt32LE(VERSION_OFFSET);
	if (version < VERSION_MINIMUM || version > VERSION_MAXIMUM) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(RECORD_HEADER_SIZE) > source.size) return undefined;
		const record = await source.readAt(position, RECORD_HEADER_SIZE);
		const nameLength = record.readUInt8(NAME_LENGTH_FIELD);
		if (nameLength === 0) return undefined;
		if (position + BigInt(RECORD_HEADER_SIZE + nameLength) > source.size)
			return undefined;
		const name = decodeCStringField(
			await source.readAt(position + BigInt(RECORD_HEADER_SIZE), nameLength),
			0,
			nameLength,
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(record.readUInt32LE(OFFSET_FIELD));
		const packedSize = BigInt(record.readUInt32LE(PACKED_SIZE_FIELD));
		const unpackedSize = BigInt(record.readUInt32LE(UNPACKED_SIZE_FIELD));
		const packed = record.readUInt8(FLAGS_FIELD) !== 0;
		if (!checkPlacement(offset, packedSize, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : packedSize,
			packedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
		position += BigInt(RECORD_HEADER_SIZE + nameLength);
	}
	return entries;
}

/** GARBro `ZlkOpener.OpenEntry`: a deflated payload is streamed through zlib, anything else is stored. */
async function openZlkEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	return createZlibInflateStream(
		source.createReadStream(entry.offset, entry.packedSize),
	);
}

export const zlkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zlkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readZlkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readZlkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Nyoken ZLK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openZlkEntry,
});
