// Format reference: GARBro ArcFormats/Crowd/ArcPCK.cs, class `PckOpener`.
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const ENTRY_COUNT_LIMIT = 0xfffff;
const INDEX_OFFSET = 4;
/** Entries are offset, size, and one word the reference skips. */
const RECORD_SIZE = 0xc;
const WORD_SIZE = 4;
const OFFSET_FIELD = 4;
const SIZE_FIELD = 8;
/** Name fields are read as null-terminated strings bounded by this length. */
const MAX_NAME_LENGTH = 260;

export const crowdPckDescriptor: FormatDescriptor = {
	id: "crowd-pck",
	name: "Crowd engine resource archive",
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
			source: "ArcFormats/Crowd/ArcPCK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PckOpener.TryOpen`. The entry count sits at 0 and is bounded at 0xFFFFF; the index from 4
 * holds 0xC-byte records whose first word the reference ignores, followed by the data offset and the
 * size. GARbro only requires an offset to exceed the index size itself, not the four header bytes in
 * front of it, and the port keeps that comparison.
 *
 * The names follow the whole index as null-terminated CP932 strings, and each one must terminate
 * inside a 260-byte window, so a missing terminator rejects the archive. Payloads are stored verbatim.
 */
async function readCrowdPckIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (count <= 0 || count > ENTRY_COUNT_LIMIT) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const records: { offset: bigint; size: bigint }[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (offset < BigInt(indexSize)) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		records.push({ offset, size });
	}

	// Names trail the index, one null-terminated string per entry.
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET + indexSize);
	for (const [id, record] of records.entries()) {
		const available = source.size - position;
		if (available <= 0n) return undefined;
		const window = Number(
			available < BigInt(MAX_NAME_LENGTH) ? available : BigInt(MAX_NAME_LENGTH),
		);
		const field = await source.readAt(position, window);
		const terminator = field.indexOf(0);
		if (terminator <= 0) return undefined;
		const name = decodeCp932(field.subarray(0, terminator));
		if (name.length === 0) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), ...record }),
		);
		position += BigInt(terminator + 1);
	}
	return entries;
}

export const crowdPckFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdPckDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCrowdPckIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCrowdPckIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd PCK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
