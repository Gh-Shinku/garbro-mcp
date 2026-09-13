// Format reference: GARBro ArcFormats/ActiveSoft/ArcADPACK.cs, class `PakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
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
const COUNT_OFFSET = 0;
const COUNT_MINIMUM = 1;
/** A count of exactly this value selects the voice archive layout. */
const VOICE_MARKER = 0x4000;
/** The plain layout starts its index right behind the count and uses 0x10-byte records. */
const PLAIN_INDEX_OFFSET = 2;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 8;
const EXTENSION_SIZE = 4;
const OFFSET_FIELD = 12;
/** The voice layout keeps a count at 2, then eight-byte offset records and separate name records. */
const VOICE_COUNT_OFFSET = 2;
const VOICE_INDEX_OFFSET = 4;
const VOICE_OFFSET_RECORD = 8;
const VOICE_OFFSET_FIELD = 4;
const VOICE_SIZE_FIELD = 0x0c;

export const a98Descriptor: FormatDescriptor = {
	id: "adpack-a98",
	name: "A98SYS Engine resource archive",
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
			source: "ArcFormats/ActiveSoft/ArcADPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PakOpener.ReadName`. A name is an eight-byte field followed by a four-byte extension field, and
 * the reference trims whitespace from both, which also drops any trailing padding. An extension is only
 * appended when it is not empty.
 */
function readName(field: Buffer, position: number): string | undefined {
	const nameField = field.subarray(position, position + NAME_SIZE);
	const nameTerminator = nameField.indexOf(0);
	const name = decodeCp932(
		nameTerminator === -1 ? nameField : nameField.subarray(0, nameTerminator),
	).trimEnd();
	if (name.length === 0) return undefined;
	const extensionField = field.subarray(
		position + NAME_SIZE,
		position + NAME_SIZE + EXTENSION_SIZE,
	);
	const extensionTerminator = extensionField.indexOf(0);
	const extension = decodeCp932(
		extensionTerminator === -1
			? extensionField
			: extensionField.subarray(0, extensionTerminator),
	).trimEnd();
	return extension.length === 0 ? name : `${name}.${extension}`;
}

/** GARBro's type lookup consults the resource catalog; the port approximates the common kinds by name. */
function inferredType(name: string): string | undefined {
	const extension = sourceExtension(name);
	if (
		["bmp", "gif", "jpeg", "jpg", "png", "tga", "tif", "tiff"].includes(
			extension,
		)
	)
		return "image";
	if (["ogg", "wav", "mp3"].includes(extension)) return "audio";
	return undefined;
}

/**
 * GARBro `PakOpener.TryOpen`. The word at 0 is the entry count, and a count of exactly 0x4000 switches to
 * the voice archive layout; anything at or below one is rejected.
 *
 * In the plain layout the index starts at 2 and each 0x10-byte record holds a name, an extension, and an
 * offset, while the size comes from the next record's offset — which is why the announced count is one more
 * than the number of entries the reference returns, the extra slot carrying the end of the data. An offset
 * must not point inside the index region.
 *
 * In the voice layout a second count sits at 2 and the index starts at 4 with eight-byte offset records
 * whose word sits at +4. That first pass stops early when an offset equals the file end on the last
 * announced record, so the entry list may be shorter than the count suggests; the name records then follow
 * immediately at the position that pass stopped at, each holding a name, an extension and a stored size
 * rather than a derived one. Payloads are stored verbatim in both layouts.
 */
async function readA98Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(PLAIN_INDEX_OFFSET + 2)) return undefined;
	const count = (await source.readAt(0n, 2)).readInt16LE(COUNT_OFFSET);
	if (count <= COUNT_MINIMUM) return undefined;
	if (count === VOICE_MARKER) return readVoiceIndex(source);
	return readPlainIndex(source, count);
}

async function readPlainIndex(
	source: ByteSource,
	count: number,
): Promise<FixedEntry[] | undefined> {
	const indexSize = count * RECORD_SIZE;
	if (BigInt(PLAIN_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(PLAIN_INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count - 1; id += 1) {
		const record = id * RECORD_SIZE;
		const name = readName(index, record);
		if (name === undefined) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const nextOffset = BigInt(
			index.readUInt32LE(record + RECORD_SIZE + OFFSET_FIELD),
		);
		if (nextOffset < offset) return undefined;
		const size = nextOffset - offset;
		if (offset < BigInt(indexSize)) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const type = inferredType(name);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				...(type === undefined ? {} : { metadata: { inferredType: type } }),
			}),
		);
	}
	return entries;
}

async function readVoiceIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const header = await source.readAt(0n, VOICE_INDEX_OFFSET);
	const count = header.readInt16LE(VOICE_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const offsetsSize = count * VOICE_OFFSET_RECORD;
	if (BigInt(VOICE_INDEX_OFFSET + offsetsSize) > source.size) return undefined;
	const offsets = await source.readAt(BigInt(VOICE_INDEX_OFFSET), offsetsSize);

	const starts: bigint[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(offsets.readUInt32LE(position + VOICE_OFFSET_FIELD));
		position += VOICE_OFFSET_RECORD;
		if (offset === source.size && id + 1 === count) break;
		if (offset > source.size) return undefined;
		starts.push(offset);
	}
	const namesOffset = BigInt(VOICE_INDEX_OFFSET + offsetsSize);
	const namesSize = starts.length * RECORD_SIZE;
	if (namesOffset + BigInt(namesSize) > source.size) return undefined;
	const names = await source.readAt(namesOffset, namesSize);

	const entries: FixedEntry[] = [];
	for (const [id, offset] of starts.entries()) {
		const record = id * RECORD_SIZE;
		const name = readName(names, record);
		if (name === undefined) return undefined;
		const size = BigInt(names.readUInt32LE(record + VOICE_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const type = inferredType(name);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				...(type === undefined ? {} : { metadata: { inferredType: type } }),
			}),
		);
	}
	return entries;
}

export const a98Format: ArchiveFormat = defineFixedArchive({
	descriptor: a98Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readA98Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readA98Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid A98SYS PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
