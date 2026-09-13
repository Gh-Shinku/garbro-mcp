// Format reference: GARBro ArcFormats/Mugi/ArcBIN.cs, class `BinOpener`.
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The index occupies a fixed region at the head of the file. */
const NAME_TABLE_OFFSET = 0;
const OFFSET_TABLE_OFFSET = 0x8000;
const SIZE_TABLE_OFFSET = 0xa000;
const INDEX_SIZE = 0xc000;
const NAME_SIZE = 0x10;
const WORD_SIZE = 4;
/** GARbro sizes its temporary offset array to this many entries. */
const MAX_ENTRIES = 0x800;

export const mugiBinDescriptor: FormatDescriptor = {
	id: "mugi-bin",
	name: "Mugi's resource archive",
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
			source: "ArcFormats/Mugi/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `BinOpener.TryOpen`. The file starts with a fixed 0xC000-byte index region: names of 0x10
 * bytes each from 0, a table of data offsets at 0x8000, and the unpacked sizes at 0xA000. The first
 * offset must equal the end of the index region, and the offset table is walked until it reaches the
 * end of the file, which also terminates the entry list: the value that ends the walk becomes the last
 * entry's end boundary.
 *
 * Sizes are the gaps between consecutive offsets, so they cannot be read from the index. An entry is
 * compressed when its stored size differs from its declared unpacked size, and those payloads are
 * decoded as LZSS streams with GARbro's `LzssStream` defaults, which match `@garbro-mcp/codecs`. There
 * is no signature or extension to detect this format by, so the fixed layout is itself the detection.
 */
async function readMugiIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size <= BigInt(INDEX_SIZE)) return undefined;
	const index = await source.readAt(0n, INDEX_SIZE);
	const firstOffset = BigInt(index.readUInt32LE(OFFSET_TABLE_OFFSET));
	if (firstOffset !== BigInt(INDEX_SIZE)) return undefined;

	const offsets: bigint[] = [firstOffset];
	let offset = firstOffset;
	let position = OFFSET_TABLE_OFFSET + WORD_SIZE;
	while (offset !== source.size) {
		if (offsets.length >= MAX_ENTRIES) return undefined;
		const previous = offsets[offsets.length - 1] ?? 0n;
		offset = BigInt(index.readUInt32LE(position));
		if (offset < previous || offset > source.size) return undefined;
		offsets.push(offset);
		position += WORD_SIZE;
	}
	// The terminating value becomes the last entry's end boundary, as in the reference.
	const count = offsets.length - 1;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const name = decodeCStringField(
			index,
			NAME_TABLE_OFFSET + id * NAME_SIZE,
			NAME_SIZE,
		);
		if (name.length === 0) return undefined;
		const start = offsets[id] ?? 0n;
		const storedSize = (offsets[id + 1] ?? 0n) - start;
		const unpackedSize = BigInt(
			index.readUInt32LE(SIZE_TABLE_OFFSET + id * WORD_SIZE),
		);
		if (!checkPlacement(start, storedSize, source.size)) return undefined;
		const packed = storedSize !== unpackedSize;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset: start,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
		});
		// The decoder stops at the end of the stored stream rather than at the declared length.
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `BinOpener.OpenEntry`: payloads are LZSS streams when their two sizes differ. */
async function openMugiEntry(
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

export const mugiBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mugiBinDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMugiIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readMugiIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mugi index layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openMugiEntry,
});
