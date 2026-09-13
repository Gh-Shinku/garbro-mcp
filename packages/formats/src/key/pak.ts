// Format reference: GARBro ArcFormats/Key/ArcPAK.cs, class `PakOpener`.
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 4;
const DATA_OFFSET_FIELD = 0;
const MINIMUM_DATA_OFFSET = 0x24;
const FLAGS_OFFSET = 0x21;
const BLOCK_SIZE_FIELD = 0x0c;
/** An index record is a block number and a size. */
const RECORD_SIZE = 8;
const BLOCK_OFFSET_FIELD = 0;
const SIZE_FIELD = 4;
/** Flag bit two announces a names pool behind the index. */
const NAMES_FLAG = 2;
const INDEX_SCAN_START = 0x24;
const INDEX_SCAN_STEP = 4;
const NAME_POINTER_TAIL = 4;
/** Names fall back to a five-digit number when the archive stores none. */
const GENERATED_NAME_DIGITS = 5;

export const keyPakDescriptor: FormatDescriptor = {
	id: "key-pak",
	name: "Key resource archive",
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
			source: "ArcFormats/Key/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Reads consecutive null-terminated names, which GARbro decodes as UTF-8 for this format. */
function readNames(
	data: Buffer,
	offset: number,
	count: number,
): string[] | undefined {
	const names: string[] = [];
	let position = offset;
	for (let id = 0; id < count; id += 1) {
		if (position < 0 || position >= data.length) return undefined;
		const terminator = data.indexOf(0, position);
		const end = terminator === -1 ? data.length : terminator;
		const name = data.toString("utf8", position, end);
		if (name.length === 0) return undefined;
		names.push(name);
		position = end + 1;
	}
	return names;
}

/**
 * GARBro `PakOpener.TryOpen`. The entry count sits at 4, the payload start at 0 and a block size at 0xC. The
 * start must lie behind the header, inside the file, and be an exact multiple of the block size, because every
 * record stores its offset as a *block number* rather than a byte offset.
 *
 * The index position is not stored either: the reference scans the words from 0x24 up to the payload start
 * looking for the first one that equals `data_offset / block_size`, and the word immediately before it is the
 * names pointer. Flag bit two says a names pool exists there, holding the entries' names as consecutive
 * null-terminated UTF-8 strings; without it the reference numbers the entries with five digits. Records then
 * hold the block number and the size, and payloads are stored verbatim.
 *
 * GARbro also classifies each entry by reading its first four bytes and matching them against its catalog; the
 * port leaves that out, since the names already carry their extensions.
 */
async function readKeyIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(MINIMUM_DATA_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, MINIMUM_DATA_OFFSET + 4);
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	if (dataOffset <= BigInt(MINIMUM_DATA_OFFSET) || dataOffset >= source.size)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const blockSize = BigInt(header.readUInt32LE(BLOCK_SIZE_FIELD));
	if (blockSize === 0n) return undefined;
	const firstBlock = dataOffset / blockSize;
	if (firstBlock * blockSize !== dataOffset) return undefined;
	const flags = header.readUInt8(FLAGS_OFFSET);

	const scan = await source.readAt(
		BigInt(INDEX_SCAN_START),
		Number(dataOffset - BigInt(INDEX_SCAN_START)),
	);
	let indexOffset = -1;
	for (
		let position = 0;
		position + INDEX_SCAN_STEP <= scan.length;
		position += INDEX_SCAN_STEP
	) {
		if (BigInt(scan.readUInt32LE(position)) === firstBlock) {
			indexOffset = position;
			break;
		}
	}
	if (indexOffset < 0) return undefined;
	if (indexOffset < NAME_POINTER_TAIL) return undefined;
	const recordArea = scan.subarray(indexOffset);
	if (recordArea.length < count * RECORD_SIZE) return undefined;

	let names: string[];
	if ((flags & NAMES_FLAG) !== 0) {
		const namesOffset = BigInt(
			scan.readUInt32LE(indexOffset - NAME_POINTER_TAIL),
		);
		if (namesOffset >= source.size) return undefined;
		const pool = await source.readAt(
			namesOffset,
			Number(source.size - namesOffset),
		);
		const read = readNames(pool, 0, count);
		if (read === undefined) return undefined;
		names = read;
	} else {
		names = Array.from({ length: count }, (_unused, id) =>
			String(id).padStart(GENERATED_NAME_DIGITS, "0"),
		);
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset =
			BigInt(recordArea.readUInt32LE(record + BLOCK_OFFSET_FIELD)) * blockSize;
		const size = BigInt(recordArea.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(names[id] ?? String(id)),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const keyPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keyPakDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readKeyIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readKeyIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Key PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
