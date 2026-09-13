// Format reference: GARbro ArcFormats/Eternity/ArcGLNK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GLNK", "ascii");
const HEADER_SIZE = 0x12;
const VERSION_OFFSET = 4;
const COUNT_OFFSET = 6;
const INDEX_OFFSET_OFFSET = 0x0a;
const INDEX_LENGTH_OFFSET = 0x0e;
/** Versions from 0x6e on store an extra 32-bit field per record. */
const LONG_RECORD_VERSION = 0x6e;
const LONG_RECORD_TAIL = 12;
const SHORT_RECORD_TAIL = 8;

export const glnkDescriptor: FormatDescriptor = {
	id: "miris-glnk",
	name: "Studio Miris GLNK resource archive",
	extensions: [
		"dat",
		"glk",
		"mlk",
		"slk",
		"gl",
		"ml",
		"sl",
		"ets",
		"etg",
		"etm",
	],
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
			source: "ArcFormats/Eternity/ArcGLNK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `GlnkOpener.TryOpen`. The index holds a byte-sized name length, the name, an offset and a
 * size; the record tail is 8 or 12 bytes wide depending on the archive version, and the running
 * index length is decremented to detect truncated indexes.
 */
async function readGlnkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = header.readUInt16LE(VERSION_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	const indexLength = header.readInt32LE(INDEX_LENGTH_OFFSET);
	if (
		indexLength < 0 ||
		indexOffset > source.size ||
		BigInt(indexLength) > source.size - indexOffset
	)
		return undefined;
	const recordTail =
		version >= LONG_RECORD_VERSION ? LONG_RECORD_TAIL : SHORT_RECORD_TAIL;
	const index = await source.readAt(indexOffset, indexLength);
	const entries: FixedEntry[] = [];
	let position = 0;
	let remaining = indexLength;
	for (let id = 0; id < count; id += 1) {
		if (remaining <= 0) return undefined;
		const nameLength = index[position++] ?? 0;
		if (position + nameLength + 8 > index.length) return undefined;
		const name = decodeCStringField(index, position, nameLength);
		position += nameLength;
		const offset = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
		position += recordTail;
		remaining -= 1 + nameLength + recordTail;
	}
	return entries;
}

export const glnkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: glnkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGlnkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readGlnkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GLNK archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
