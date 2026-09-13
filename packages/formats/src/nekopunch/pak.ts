// Format reference: GARBro ArcFormats/Nekopunch/ArcPAK.cs, class `PakOpener`.
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

const SIGNATURE = Buffer.from("PACK", "ascii");
const EXTENSION = "pak";
const COUNT_OFFSET = 4;
const PACKED_FLAG_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x40;
const WORD_SIZE = 4;
/** One record is the name field plus the unpacked size, stored size and offset words. */
const RECORD_SIZE = NAME_SIZE + WORD_SIZE * 3;
const UNPACKED_SIZE_FIELD = 0;
const STORED_SIZE_FIELD = 4;
const DATA_OFFSET_FIELD = 8;

export const nekopunchPakDescriptor: FormatDescriptor = {
	id: "nekopunch-pak",
	name: "Studio Nekopunch resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Nekopunch/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PakOpener.TryOpen`. A `PACK` archive keeps its entry count at 4 and one flag at 8 that
 * applies to the whole archive. Every record is 0x4C bytes: a 0x40-byte name field, then the unpacked
 * size, the stored size, and the data offset.
 *
 * When the flag is set `PakOpener.OpenEntry` decodes each payload as an LZSS stream with GARbro's
 * `LzssStream` defaults, which match `@garbro-mcp/codecs`, and the stored size is the compressed
 * length. Because that decoder stops at the end of the stream rather than at the declared output
 * length, packed entries are marked as having an inexact size.
 */
async function readNekopunchIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const isPacked = header.readInt32LE(PACKED_FLAG_OFFSET) !== 0;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const words = record + NAME_SIZE;
		const unpackedSize = BigInt(
			index.readUInt32LE(words + UNPACKED_SIZE_FIELD),
		);
		const storedSize = BigInt(index.readUInt32LE(words + STORED_SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(words + DATA_OFFSET_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: isPacked ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: isPacked,
		});
		if (isPacked) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `PakOpener.OpenEntry`: the archive-wide flag selects LZSS for every payload. */
async function openNekopunchEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "LZSS entry"),
	);
	return Readable.from([inflateLzssAll(stored)]);
}

export const nekopunchPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nekopunchPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readNekopunchIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readNekopunchIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Nekopunch PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openNekopunchEntry,
});
