// Format reference: GARBro Legacy/Aaru/ArcDL1.cs, class `Dl1Opener`.
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

/** The head is `DL1.0` followed by a 0x1A byte. */
const SIGNATURE = Buffer.from("DL1.0\x1a", "latin1");
const COUNT_OFFSET = 8;
const INDEX_OFFSET_FIELD = 0xa;
const DATA_OFFSET = 0x10;
/** A record is a fixed name field followed by the stored size. */
const NAME_SIZE = 0xc;
const RECORD_SIZE = NAME_SIZE + 4;
/** Packed payloads begin with this marker, then the unpacked size at +6 and LZSS data at +10. */
const PACKED_MARKER = Buffer.from("LZ", "ascii");
const PACKED_SIZE_FIELD = 6;
const PACKED_HEADER_SIZE = 10;

export const dl1Descriptor: FormatDescriptor = {
	id: "csware-dl1",
	name: "C's ware resource archive",
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
			source: "Legacy/Aaru/ArcDL1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Dl1Opener.TryOpen`. The file starts with `DL1.0` and a 0x1A byte, the entry count sits at 8,
 * and a word at 0xA points at the index. Payloads start at 0x10 and follow each other in index order,
 * so each entry's offset is the sum of the sizes before it rather than a stored value.
 *
 * Records are 0x10 bytes wide: a 0xC-byte name field and the stored size. `Dl1Opener.OpenEntry` marks
 * an entry as packed when its payload starts with `LZ`, reads the unpacked size from the word at +6, and
 * decodes the LZSS stream that begins at +10 with GARbro's `LzssStream` defaults, which match
 * `@garbro-mcp/codecs`. The port performs that inspection while reading the index so listing and
 * extraction agree, and marks those entries as having an inexact size because the decoder stops at the
 * end of the stored stream.
 */
async function readDl1Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DATA_OFFSET)) return undefined;
	const header = await source.readAt(0n, DATA_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);

	const entries: FixedEntry[] = [];
	let offset = BigInt(DATA_OFFSET);
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameField = index.subarray(record, record + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const storedSize = BigInt(index.readUInt32LE(record + NAME_SIZE));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		let packed = false;
		let unpackedSize = storedSize;
		if (storedSize > BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				packed = true;
				unpackedSize = BigInt(probe.readUInt32LE(PACKED_SIZE_FIELD));
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
		offset += storedSize;
	}
	return entries;
}

/** GARBro `Dl1Opener.OpenEntry`: `LZ` payloads are LZSS streams with default settings. */
async function openDl1Entry(
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
	return Readable.from([inflateLzssAll(stored)]);
}

export const dl1Format: ArchiveFormat = defineFixedArchive({
	descriptor: dl1Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE.subarray(0, 4) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDl1Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDl1Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DL1 archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openDl1Entry,
});
