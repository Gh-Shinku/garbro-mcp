// Format reference: GARBro ArcFormats/AliceSoft/ArcALD.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const TRAILER_SIZE = 0x10;
/** AliceSoft System engine versions GARbro accepts in the trailer. */
const VERSIONS = new Set([0x014c4e, 0x012020]);
const TRAILER_HEADER_SIZE = 0x10;
const TRAILER_COUNT_OFFSET = 9;
const INDEX_LENGTH_MASK = 0xffffff;
const INDEX_RECORD_SIZE = 3;
const MIN_HEADER_SIZE = 0x10;
const SIZE_OFFSET = 4;
const NAME_OFFSET = 0x10;

export const aldDescriptor: FormatDescriptor = {
	id: "alicesoft-ald",
	name: "AliceSoft System engine resource archive",
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
			source: "ArcFormats/AliceSoft/ArcALD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `AldOpener.TryOpen`. A trailer at the end of the file holds the engine version and the
 * record count, while the index length is the low three bytes of the first word shifted left by
 * eight. The record table that follows starts at offset 3 and holds 24-bit offsets that are shifted
 * the same way; a zero offset ends the walk.
 *
 * Each record is then read through its own header: a header size that must exceed 0x10, the stored
 * size, and the name that fills the rest of the header.
 */
async function readAldIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size <= BigInt(TRAILER_SIZE)) return undefined;
	const trailerOffset = source.size - BigInt(TRAILER_SIZE);
	const trailer = await source.readAt(trailerOffset, TRAILER_SIZE);
	if (!VERSIONS.has(trailer.readUInt32LE(0))) return undefined;
	if (trailer.readUInt32LE(4) !== TRAILER_HEADER_SIZE) return undefined;
	const count = trailer.readUInt16LE(TRAILER_COUNT_OFFSET);
	if (count === 0) return undefined;
	const indexLength = BigInt(
		((await source.readAt(0n, 4)).readUInt32LE(0) & INDEX_LENGTH_MASK) << 8,
	);
	if (indexLength > source.size) return undefined;

	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_RECORD_SIZE);
	for (let id = 0; id < count; id += 1) {
		if (position + 4n > source.size) return undefined;
		const offset = BigInt(
			((await source.readAt(position, 4)).readUInt32LE(0) &
				INDEX_LENGTH_MASK) <<
				8,
		);
		if (offset === 0n) break;
		if (offset >= source.size) return undefined;
		position += BigInt(INDEX_RECORD_SIZE);

		if (offset + BigInt(NAME_OFFSET) > source.size) return undefined;
		const header = await source.readAt(
			offset,
			Math.min(NAME_OFFSET, Number(source.size - offset)),
		);
		const headerSize = BigInt(header.readUInt32LE(0));
		if (headerSize <= BigInt(MIN_HEADER_SIZE)) return undefined;
		const size = BigInt(header.readUInt32LE(SIZE_OFFSET));
		const nameLength = Number(headerSize - BigInt(MIN_HEADER_SIZE));
		if (offset + headerSize > source.size) return undefined;
		const nameField = await source.readAt(
			offset + BigInt(NAME_OFFSET),
			nameLength,
		);
		const name = decodeCStringField(nameField, 0, nameLength);
		const dataOffset = offset + headerSize;
		if (!checkPlacement(dataOffset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const aldFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aldDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAldIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAldIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AliceSoft ALD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
