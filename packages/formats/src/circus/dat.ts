// Format reference: GARBro ArcFormats/Circus/ArcCircus.cs, class `DatOpener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
const COUNT_OFFSET = 0;
const MIN_COUNT = 1;
const COUNT_LIMIT = 0xfffff;
const INDEX_OFFSET = 4;
const OFFSET_FIELD_TAIL = 4;
/** Candidate name field widths, narrowest first. */
const NAME_LENGTHS = [0x24, 0x30, 0x3c] as const;
/** The last four bytes of the first name field are read as a size for a rejection heuristic. */
const FIRST_SIZE_TAIL = 4;

export const circusDatDescriptor: FormatDescriptor = {
	id: "circus-dat",
	name: "Circus resource archive",
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
			source: "ArcFormats/Circus/ArcCircus.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `DatOpener.ReadIndex`. Records are a fixed-width name field followed by one offset word, and
 * sizes are derived rather than stored: each entry spans from its own offset to the next record's, with
 * the last one running to the end of the file. Because the final record only contributes an offset, the
 * reference decrements the announced count and returns one fewer entry than that word suggests.
 *
 * Three name widths are tried in turn, and a candidate is rejected when the last four bytes of the first
 * name field happen to equal the distance between the first two offsets — a heuristic that separates this
 * layout from a sibling format. Every offset must sit at or behind the index size, which the reference
 * compares against the index alone rather than the four header bytes in front of it, and each entry is
 * checked against the file. Payloads are stored verbatim.
 */
function readLayout(
	data: Buffer,
	count: number,
	nameLength: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const indexSize = (nameLength + OFFSET_FIELD_TAIL) * count;
	if (BigInt(INDEX_OFFSET + indexSize) > BigInt(data.length)) return undefined;
	let next = BigInt(data.readUInt32LE(INDEX_OFFSET + nameLength));
	if (next < BigInt(INDEX_OFFSET + indexSize)) return undefined;
	const firstSize = data.readUInt32LE(
		INDEX_OFFSET + nameLength - FIRST_SIZE_TAIL,
	);
	const second = BigInt(
		data.readUInt32LE(INDEX_OFFSET + nameLength * 2 + OFFSET_FIELD_TAIL),
	);
	if (second - next === BigInt(firstSize)) return undefined;

	const entries: FixedEntry[] = [];
	const entryCount = count - 1;
	let position = INDEX_OFFSET;
	for (let id = 0; id < entryCount; id += 1) {
		const field = data.subarray(position, position + nameLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		position += nameLength;
		const offset = next;
		next =
			id + 1 === entryCount
				? archiveSize
				: BigInt(data.readUInt32LE(position + OFFSET_FIELD_TAIL + nameLength));
		if (next < offset) return undefined;
		const size = next - offset;
		if (offset < BigInt(indexSize)) return undefined;
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		position += OFFSET_FIELD_TAIL;
	}
	return entries;
}

/**
 * GARBro `DatOpener.TryOpen`. The entry count sits at 0 and must exceed one because the last record only
 * carries an offset. Each candidate name width is tried in order and the first that reads cleanly wins,
 * so a file whose names merely fit a narrower field is still read the way the reference would read it.
 */
async function readCircusIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + OFFSET_FIELD_TAIL)) return undefined;
	const data = await source.readAt(0n, Number(source.size));
	const count = data.readInt32LE(COUNT_OFFSET);
	if (count <= MIN_COUNT || count > COUNT_LIMIT) return undefined;
	for (const nameLength of NAME_LENGTHS) {
		const entries = readLayout(data, count, nameLength, source.size);
		if (entries) return entries;
	}
	return undefined;
}

export const circusDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: circusDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readCircusIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCircusIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Circus DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
