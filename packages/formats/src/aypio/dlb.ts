// Format reference: GARBro Legacy/AyPio/ArcDLB.cs, classes `DlbOpener` and `Dlb0Opener`.
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

/** The first version identifies itself with this 22-byte header, which also holds its entry count. */
const SIGNATURE = Buffer.from("<< dlb file Ver1.00>>\0", "latin1");
const COUNT_OFFSET = 0x16;
const INDEX_OFFSET = 0x18;
/** The zero version keeps its count at 0 and its index at 2. */
const V0_COUNT_OFFSET = 0;
const V0_INDEX_OFFSET = 2;
const V0_FIRST_OFFSET = 0x0f;
const V0_EXTENSION = "dlb";
/** A record is a fixed name field followed by the data offset and the size. */
const NAME_SIZE = 0x0d;
const WORD_SIZE = 4;
const RECORD_SIZE = NAME_SIZE + WORD_SIZE * 2;

export const dlbDescriptor: FormatDescriptor = {
	id: "aypio-dlb",
	name: "UK2 engine resource archive",
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
			source: "Legacy/AyPio/ArcDLB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dlbV0Descriptor: FormatDescriptor = {
	id: "aypio-dlb-v0",
	name: "UK2 engine resource archive, version 0",
	extensions: [V0_EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: dlbDescriptor.attribution,
};

/**
 * GARBro `DlbOpener.ReadIndex`, shared by both versions. A record holds a fixed 0xD-byte name field —
 * GARbro's `ReadCString` always advances by the requested length, whether or not the string ends
 * earlier — followed by the data offset and the size. Payloads are stored verbatim.
 */
async function readDlbRecords(
	source: ByteSource,
	indexOffset: number,
	count: number,
): Promise<FixedEntry[] | undefined> {
	const indexSize = count * RECORD_SIZE;
	if (BigInt(indexOffset + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(indexOffset), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const field = index.subarray(record, record + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + WORD_SIZE));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	return entries;
}

/**
 * GARBro `DlbOpener.TryOpen`. The header spells out `<< dlb file Ver1.00>>` and ends with a null, and
 * the entry count follows it at 0x16 before the index starts at 0x18.
 */
async function readDlbIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	return readDlbRecords(source, INDEX_OFFSET, count);
}

/**
 * GARBro `Dlb0Opener.TryOpen`. This variant has no signature: it identifies itself only by the `.DLB`
 * extension, keeps the count at 0, and requires the first record's data offset — the word at 0xF,
 * behind the header and the name field — to equal the end of the index, which pins the record width.
 */
async function readDlbV0Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== V0_EXTENSION) return undefined;
	if (source.size < BigInt(V0_INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, V0_INDEX_OFFSET)).readInt16LE(
		V0_COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const firstOffset =
		BigInt(count) * BigInt(RECORD_SIZE) + BigInt(V0_INDEX_OFFSET);
	if (firstOffset > source.size) return undefined;
	if (BigInt(V0_FIRST_OFFSET + WORD_SIZE) > source.size) return undefined;
	const stored = (
		await source.readAt(BigInt(V0_FIRST_OFFSET), WORD_SIZE)
	).readUInt32LE(0);
	if (BigInt(stored) !== firstOffset) return undefined;
	return readDlbRecords(source, V0_INDEX_OFFSET, count);
}

export const dlbFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dlbDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE.subarray(0, 4) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDlbIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDlbIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DLB archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const dlbV0Format: ArchiveFormat = defineFixedArchive({
	descriptor: dlbV0Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDlbV0Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDlbV0Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DLB version 0 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
