// Format reference: GARBro ArcFormats/BlackRainbow/ArcPAK.cs, class `PakOpener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "pak";
/** The index trails the file: its record count and size are the last two words. */
const TRAILER_SIZE = 8;
const COUNT_TAIL = 8;
const INDEX_SIZE_TAIL = 4;
/** A record is three words, a character count and the name it measures. */
const OFFSET_FIELD = 0;
const PACKED_SIZE_FIELD = 4;
const UNPACKED_SIZE_FIELD = 8;
const NAME_LENGTH_FIELD = 12;
const RECORD_HEADER_SIZE = 16;
const MAXIMUM_NAME_LENGTH = 0x100;
/** This sentinel in the unpacked size marks a payload that is stored rather than deflated. */
const STORED_SENTINEL = 0xffffffff;
const UTF16_CHAR_SIZE = 2;

export const meltyPakDescriptor: FormatDescriptor = {
	id: "black-rainbow-melty-pak",
	name: "BlackRainbow/Melty resource archive",
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
			source: "ArcFormats/BlackRainbow/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PakOpener.TryOpen`. The archive carries no signature, and its index is *trailing*: the record count is
 * the word eight bytes from the end and the index size the word after it, so the index begins that size before
 * the trailer. The size must leave the trailer and the index inside the file.
 *
 * Records hold a data offset, a packed size, an unpacked size and a character count followed by that many
 * UTF-16LE characters as the name. The unpacked size doubles as a flag: a sentinel of all ones means the payload
 * is stored, and any other value means it is deflated and that word gives its expanded length. A character count
 * outside one to 0x100 rejects the archive, as does a name the index cannot supply in full.
 *
 * The reference decompresses without checking the result against the declared length, so the port streams the
 * zlib output and marks those entries as having an inexact size. It performs no placement check beyond the
 * payload's own span, which the port keeps, and validates the offset bound the same way.
 */
async function readMeltyIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size <= BigInt(TRAILER_SIZE)) return undefined;
	const trailerOffset = source.size - BigInt(TRAILER_SIZE);
	const trailer = await source.readAt(trailerOffset, TRAILER_SIZE);
	const count = trailer.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = BigInt(trailer.readUInt32LE(INDEX_SIZE_TAIL));
	if (indexSize >= BigInt(trailerOffset)) return undefined;
	const indexOffset = trailerOffset - indexSize;
	const index = await source.readAt(indexOffset, Number(indexSize));

	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + RECORD_HEADER_SIZE > index.length) return undefined;
		const nameLength = index.readInt32LE(position + NAME_LENGTH_FIELD);
		if (nameLength <= 0 || nameLength > MAXIMUM_NAME_LENGTH) return undefined;
		const nameBytes = nameLength * UTF16_CHAR_SIZE;
		const nameOffset = position + RECORD_HEADER_SIZE;
		if (nameOffset + nameBytes > index.length) return undefined;
		const name = index
			.toString("utf16le", nameOffset, nameOffset + nameBytes)
			.replace(/\0.*$/, "");
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(position + OFFSET_FIELD));
		const packedSize = BigInt(index.readUInt32LE(position + PACKED_SIZE_FIELD));
		const unpackedSize = index.readUInt32LE(position + UNPACKED_SIZE_FIELD);
		if (!checkPlacement(offset, packedSize, source.size)) return undefined;
		const packed = unpackedSize !== STORED_SENTINEL;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? BigInt(unpackedSize) : packedSize,
			packedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
		position = nameOffset + nameBytes;
	}
	return entries;
}

/** GARBro `PakOpener.OpenEntry`: a deflated payload is streamed through zlib, anything else is stored. */
async function openMeltyEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	return createZlibInflateStream(
		source.createReadStream(entry.offset, entry.packedSize),
	);
}

export const meltyPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: meltyPakDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMeltyIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMeltyIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Melty PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openMeltyEntry,
});
