// Format reference: GARBro ArcFormats/Scoop/ArcGX.cs, class `GxOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("PARROT1.0", "ascii");
const COUNT_OFFSET = 0xa;
const INDEX_SIZE_OFFSET = 0xc;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x12;
const COMPRESSION_FIELD = 0;
const NAME_OFFSET_FIELD = 2;
const OFFSET_FIELD = 6;
const SIZE_FIELD = 0xa;
const UNPACKED_SIZE_FIELD = 0xe;
/** GARBro treats these two values as stored and everything above them as compressed. */
const STORED_COMPRESSION_MAX = 1;

export const gxDescriptor: FormatDescriptor = {
	id: "scoop-gx",
	name: "Scoop resource archive",
	extensions: ["gx", "fx", "vx"],
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
			source: "ArcFormats/Scoop/ArcGX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `GxOpener.TryOpen`. The file starts with `PARROT1.0`, the entry count sits at 0xA, and a word
 * at 0xC bounds the index, which the reference resolves by reading that many bytes from the start of
 * the file. Records begin at 0x10 and are 0x12 bytes wide: a compression word, the offset of the
 * entry's name within the index region, then the data offset, the stored size, and the unpacked size.
 *
 * The name offset may not exceed the index size, and the name itself is read as a null-terminated
 * string from that position with the remaining index bytes as its limit. A compression value above one
 * marks the entry as compressed, and `GxOpener.OpenEntry` decodes those payloads as zlib streams.
 * Because a zlib stream carries no declared length, the port treats the unpacked size word as
 * informational and marks those entries as having an inexact size.
 */
async function readGxIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readUInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_OFFSET));
	if (indexSize > source.size || indexSize < BigInt(INDEX_OFFSET))
		return undefined;
	const indexEnd = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (indexEnd > indexSize) return undefined;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		bigintToBufferLength(indexEnd - BigInt(INDEX_OFFSET), "Scoop GX records"),
	);
	const nameTable = await source.readAt(
		0n,
		bigintToBufferLength(indexSize, "Scoop GX index"),
	);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const compression = index.readUInt16LE(record + COMPRESSION_FIELD);
		const nameOffset = BigInt(index.readUInt32LE(record + NAME_OFFSET_FIELD));
		if (nameOffset > indexSize) return undefined;
		const nameField = nameTable.subarray(
			bigintToBufferLength(nameOffset, "Scoop GX name offset"),
		);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = compression > STORED_COMPRESSION_MAX;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
			metadata: { compression },
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `GxOpener.OpenEntry`: payloads above the stored compression levels are zlib streams. */
async function openGxEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	return createZlibInflateStream(
		source.createReadStream(entry.offset, entry.packedSize),
	);
}

export const gxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE.subarray(0, 4) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGxIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readGxIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Scoop GX layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openGxEntry,
});
