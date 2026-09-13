// Format reference: GARBro ArcFormats/Silky/ArcAzurite.cs (`SilkyArcOpener`) and
// ArcFormats/Silky/ArcAi6Win.cs (`Ai6Opener.OpenEntry`).
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
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "arc";
const INDEX_SIZE_OFFSET = 0;
const INDEX_OFFSET = 4;
const MIN_INDEX_SIZE = 10;
/** Each record holds three big-endian words in a row. */
const WORD_SIZE = 4;
const RECORD_TAIL = WORD_SIZE * 3;
/** Bounds the walk so a damaged index cannot allocate without limit. */
const MAX_ENTRIES = 0x100000;

const STORED_SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
const DATA_OFFSET_FIELD = 8;

export const azuriteDescriptor: FormatDescriptor = {
	id: "silky-azurite",
	name: "Silky's resource archive",
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
			source: "ArcFormats/Silky/ArcAzurite.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Silky/ArcAi6Win.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `SilkyArcOpener.TryOpen`. The index size sits at 0 and the index itself runs from 4 for that
 * many bytes, which must be at least ten and stay clear of the file end. A record starts with a byte
 * name length, then the name, then three big-endian words: the stored size, the unpacked size, and the
 * data offset, which must land behind the index.
 *
 * Names are obfuscated by adding a decreasing key that starts at the name length, so the first byte is
 * shifted by the length and the last by one. An entry counts as compressed whenever its stored size
 * differs from its unpacked size, and `Ai6Opener.OpenEntry` decodes those with GARbro's default LZSS
 * settings, which match the defaults of `@garbro-mcp/codecs`.
 */
async function readAzuriteIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + MIN_INDEX_SIZE)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_OFFSET));
	if (indexSize < BigInt(MIN_INDEX_SIZE) || indexSize >= source.size - 4n)
		return undefined;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		bigintToBufferLength(indexSize, "Azurite index"),
	);
	if ((index[0] ?? 0) === 0) return undefined;

	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		const nameLength = index[position] ?? 0;
		if (nameLength === 0) return undefined;
		position += 1;
		if (position + nameLength + RECORD_TAIL > index.length) return undefined;
		const nameBytes = Buffer.from(
			index.subarray(position, position + nameLength),
		);
		for (let byte = 0; byte < nameLength; byte += 1) {
			nameBytes[byte] = ((nameBytes[byte] ?? 0) + nameLength - byte) & 0xff;
		}
		const name = decodeCp932(nameBytes);
		if (name.length === 0) return undefined;
		position += nameLength;

		const storedSize = BigInt(index.readUInt32BE(position + STORED_SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32BE(position + UNPACKED_SIZE_FIELD),
		);
		const offset = BigInt(index.readUInt32BE(position + DATA_OFFSET_FIELD));
		position += RECORD_TAIL;
		if (offset < indexSize + BigInt(INDEX_OFFSET)) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		if (entries.length >= MAX_ENTRIES) return undefined;
		const packed = storedSize !== unpackedSize;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
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

/** GARbro `Ai6Opener.OpenEntry`: packed entries are plain LZSS streams with default settings. */
async function openAzuriteEntry(
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

export const azuriteFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azuriteDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readAzuriteIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAzuriteIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Azurite index layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAzuriteEntry,
});
