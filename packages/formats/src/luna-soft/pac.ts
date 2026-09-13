// Format reference: GARBro ArcFormats/LunaSoft/ArcPAC.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature is the two-byte shift-jis word ぱく. */
const SIGNATURE = Buffer.from([0x82, 0xcf, 0x82, 0xad]);
const COUNT_OFFSET = 4;
const BASE_OFFSET = 8;
const INDEX_OFFSET = 0x10;
/** Name length sits behind the size word, so it is what distinguishes the two layouts. */
const NAME_LENGTH_TAIL = 4;
const MAX_NAME_LENGTH = 0x100;
const OFFSET_FIELD = 0x100;
/** Offset widths and size positions of the two layouts GARbro tries in turn. */
const LAYOUTS = [
	{ offsetSize: 4, sizePosition: 0x104 },
	{ offsetSize: 8, sizePosition: 0x108 },
] as const;

export const lunaPacDescriptor: FormatDescriptor = {
	id: "luna-pac",
	name: "LunaSoft resource archive",
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
			source: "ArcFormats/LunaSoft/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Layout {
	offsetSize: number;
	sizePosition: number;
}

/**
 * GARBro `PacOpener.ReadIndex`. A record holds the name at its start, the data offset at 0x100, and —
 * on top of that — a size word followed by the name length, which is what distinguishes the two
 * layouts: 32-bit offsets put the size at 0x104, 64-bit offsets at 0x108. The name length must be
 * non-zero and at most 0x100. Offsets are relative to the base offset stored at 8.
 */
async function readLunaIndex(
	source: ByteSource,
	baseOffset: bigint,
	count: number,
	layout: Layout,
): Promise<FixedEntry[] | undefined> {
	const recordLength = layout.sizePosition + 8;
	const recordsSize = recordLength * count;
	if (BigInt(INDEX_OFFSET + recordsSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), recordsSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * recordLength;
		const nameLength = index.readUInt32LE(
			record + layout.sizePosition + NAME_LENGTH_TAIL,
		);
		if (nameLength === 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		const name = decodeCp932(index.subarray(record, record + nameLength));
		if (name.length === 0) return undefined;
		const rawOffset =
			layout.offsetSize === 8
				? index.readBigInt64LE(record + OFFSET_FIELD)
				: BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const offset = baseOffset + rawOffset;
		const size = BigInt(index.readUInt32LE(record + layout.sizePosition));
		if (offset < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

async function readLunaPac(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(header.readUInt32LE(BASE_OFFSET));
	for (const layout of LAYOUTS) {
		const entries = await readLunaIndex(source, baseOffset, count, layout);
		if (entries) return entries;
	}
	return undefined;
}

export const lunaPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lunaPacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLunaPac(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLunaPac(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LunaSoft PAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
