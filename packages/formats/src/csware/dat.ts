// Format reference: GARBro ArcFormats/CsWare/ArcDAT.cs, class `PakOpener` (tag `DAT/CSWARE`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
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

const COUNT_FIELD = 0;
const PACKED_SIZE_FIELD = 4;
const ZLIB_OFFSET = 8;
/** The reference rejects the format unless the first byte at 0x08 is the zlib marker. */
const ZLIB_MARKER = 0x78;
const NAME_SIZE = 0x18;
const RECORD_SIZE = NAME_SIZE + 8;

export const cswareDatDescriptor: FormatDescriptor = {
	id: "csware-dat",
	name: "C's Ware BLITZ resource archive",
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
			source: "ArcFormats/CsWare/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PakOpener.TryOpen`. The archive carries no signature: it starts with the record count and
 * the packed size of a zlib-compressed index that begins at 0x08 (whose first byte must be the zlib
 * marker). Payload offsets are relative to the end of the compressed index.
 *
 * Each record is a 0x18-byte CP932 name followed by the payload offset and size. An empty name
 * rejects the archive, and every entry must pass the reference's placement check.
 */
async function readCswareIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(ZLIB_OFFSET)) return undefined;
	const header = await source.readAt(0n, ZLIB_OFFSET);
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const packedSize = BigInt(header.readUInt32LE(PACKED_SIZE_FIELD));
	if (packedSize >= source.size) return undefined;
	const available = source.size - BigInt(ZLIB_OFFSET);
	const storedLength = packedSize < available ? packedSize : available;
	const stored = await source.readAt(
		BigInt(ZLIB_OFFSET),
		bigintToBufferLength(storedLength, "C's Ware DAT index"),
	);
	if ((stored[0] ?? 0) !== ZLIB_MARKER) return undefined;
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(stored);
	} catch {
		return undefined;
	}
	if (index.length < count * RECORD_SIZE) return undefined;
	const dataOffset = BigInt(ZLIB_OFFSET) + packedSize;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE)) + dataOffset;
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				packedSize: size,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

export const cswareDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cswareDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCswareIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCswareIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C's Ware DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
