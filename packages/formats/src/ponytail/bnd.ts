// Format reference: GARBro Legacy/Ponytail/ArcBND.cs, class `BndOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	decodeCStringField,
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { unpackLz1 } from "./lz1.js";

const SIGNATURE = Buffer.from("Bind", "ascii");
const VERSION = Buffer.from(" ver.0", "ascii");
const VERSION_OFFSET = SIGNATURE.length;
const COUNT_OFFSET = 0x0d;
const INDEX_OFFSET = 0x0f;
const NAME_SIZE = 8;
const EXTENSION_SIZE = 3;
const SIZE_OFFSET = 0x0c;
const PAYLOAD_OFFSET = 0x14;
const INDEX_RECORD_SIZE = 0x18;
/** Compressed payloads announce themselves with this marker. */
const PACKED_MARKER = Buffer.from("lz1_", "ascii");
const MARKER_EXTENSION_OFFSET = 4;
const MARKER_UNPACKED_SIZE = 5;
const MARKER_HEADER_SIZE = 9;
/** Compressed entries are the ones whose name ends in this character. */
const PACKED_SUFFIX = "Z";

/**
 * GARbro `BndOpener.TryOpen`. A `Bind` signature followed by ` ver.0` opens the file, the entry count
 * is an int16 at 0x0D and the index starts at the offset stored at 0x0F.
 *
 * Every 0x18-byte record is an 8.3 name — an eight-byte name and a three-byte extension, each read up
 * to its first zero byte and trimmed — followed by the stored size at 0x0C and the payload offset at
 * 0x14. Both fields are placement-checked.
 *
 * A second pass probes entries whose name ends in `Z` for the `lz1_` marker. Such an entry is
 * compressed, its unpacked size follows the marker's fourth byte, and the byte in between names the
 * real extension character, which replaces the trailing `Z`. GARbro also skips entries whose
 * catalog-derived type is an image here; under the 8.3 name limit that combination cannot occur, since
 * a name can only end in `Z` when its extension does too.
 */
async function readBndIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET) + 4n) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header
			.subarray(VERSION_OFFSET, VERSION_OFFSET + VERSION.length)
			.equals(VERSION)
	)
		return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * INDEX_RECORD_SIZE) > source.size)
		return undefined;

	const index = await source.readAt(indexOffset, count * INDEX_RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * INDEX_RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE).trim();
		const extension = decodeCStringField(
			index,
			record + NAME_SIZE,
			EXTENSION_SIZE,
		).trim();
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + PAYLOAD_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${name}.${extension}`),
				offset,
				size,
			}),
		);
	}
	for (const entry of entries) await resolvePackedEntry(source, entry);
	return entries;
}

/** The `lz1_` probe, which also recovers the real extension character of a packed entry. */
async function resolvePackedEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<void> {
	if (!entry.path.endsWith(PACKED_SUFFIX)) return;
	if (entry.size < BigInt(MARKER_HEADER_SIZE)) return;
	const stored = await source.readAt(entry.offset, MARKER_HEADER_SIZE);
	if (!stored.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) return;
	const extension = String.fromCharCode(
		stored[MARKER_EXTENSION_OFFSET] ?? 0,
	).toUpperCase();
	entry.path = `${entry.path.slice(0, -1)}${extension}`;
	entry.size = BigInt(stored.readUInt32LE(MARKER_UNPACKED_SIZE));
	entry.compressed = true;
	entry.sizeKnown = true;
}

/** GARbro `BndOpener.OpenEntry`: packed payloads skip the nine-byte marker and are LZ1 decoded. */
const bndEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const stored = await source.readAt(
		entry.offset + BigInt(MARKER_HEADER_SIZE),
		Number(entry.packedSize) - MARKER_HEADER_SIZE,
	);
	return Readable.from([unpackLz1(stored, Number(entry.size))]);
};

export const ponytailBndDescriptor: FormatDescriptor = {
	id: "ponytail-bnd",
	name: "Ponytail Soft resource archive",
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
			source: "Legacy/Ponytail/ArcBND.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ponytailBndFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ponytailBndDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readBndIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readBndIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BND layout");
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: bndEntryOpener,
});
