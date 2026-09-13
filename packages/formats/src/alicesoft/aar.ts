// Format reference: GARBro ArcFormats/AliceSoft/ArcAAR.cs, class `AarOpener`.
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	readCStringAt,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("AAR\0", "latin1");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0xc;
/** Compressed payloads start with this marker and a sixteen-byte header. */
const PACKED_MARKER = Buffer.from("ZLB\0", "latin1");
const PACKED_UNPACKED_SIZE_FIELD = 8;
const PACKED_SIZE_FIELD = 0xc;
const PACKED_HEADER_SIZE = 0x10;
/** GARbro treats a flag word of one as "not compressed". */
const STORED_FLAG = 1;

export const aarDescriptor: FormatDescriptor = {
	id: "alicesoft-aar",
	name: "AliceSoft System engine resource archive",
	extensions: ["red"],
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
			source: "ArcFormats/AliceSoft/ArcAAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `AarOpener.TryOpen`. The archive starts with `AAR\0`, the entry count sits at 8, and the
 * index begins at 0xC. A record is an offset, a size, a flag word, and a null-terminated CP932 name,
 * which the reference reads without a length bound, so the port scans for the terminator as well.
 *
 * The flag word marks an entry as compressed unless it equals one, but `AarOpener.OpenEntry` never
 * consults it: it decides from the payload's `ZLB\0` marker instead, and the port mirrors that, while
 * still exposing the index flag as metadata.
 *
 * One deviation is deliberate. GARbro reads the unpacked size and the packed size of a `ZLB` payload
 * from the absolute file offsets 8 and 0xC, which are the archive's entry count and its first index
 * word rather than anything belonging to the entry, and then starts the stream sixteen bytes into the
 * entry. That can only produce garbage, so the port reads both words relative to the entry, where the
 * marker and the sixteen-byte header put them, and extracts with zlib. Because a zlib stream carries
 * no declared length, packed entries are marked as having an inexact size.
 */
async function readAarIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + 12n > source.size) return undefined;
		const record = await source.readAt(indexOffset, 12);
		const offset = BigInt(record.readUInt32LE(0));
		const storedSize = BigInt(record.readUInt32LE(4));
		const flag = record.readInt32LE(8);
		const { value: name, end } = await readCStringAt(source, indexOffset + 12n);
		indexOffset = end;
		if (name.length === 0) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		let packed = false;
		let unpackedSize = storedSize;
		if (storedSize > BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				packed = true;
				unpackedSize = BigInt(probe.readUInt32LE(PACKED_UNPACKED_SIZE_FIELD));
			}
		}
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: packed
				? BigInt(
						(await source.readAt(offset, PACKED_HEADER_SIZE)).readUInt32LE(
							PACKED_SIZE_FIELD,
						),
					)
				: storedSize,
			compressed: packed,
			metadata: { indexFlag: flag, storedFlagged: flag !== STORED_FLAG },
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `AarOpener.OpenEntry`: `ZLB` payloads are zlib streams behind a sixteen-byte header. */
async function openAarEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	return createZlibInflateStream(
		source.createReadStream(
			entry.offset + BigInt(PACKED_HEADER_SIZE),
			entry.packedSize,
		),
	);
}

export const aarFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aarDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAarIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAarIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AAR archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAarEntry,
});
