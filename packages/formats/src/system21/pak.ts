// Format reference: GARBro Legacy/System21/ArcPAK.cs, class `PakOpener`.
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

/** The old signature, whose name fields are the widest. */
const OLD_SIGNATURE = 0x978fad8f;
/** The new signature also starts the variant search at the narrowest name field. */
const NEW_SIGNATURE = 0x798af589;
const SIGNATURES = [
	Buffer.from([0x8f, 0xad, 0x8f, 0x97]),
	Buffer.from([0x89, 0xf5, 0x8a, 0x79]),
];
/** The new signature is the only one that may use the two narrower name fields. */
const NEW_SIGNATURE_OFFSET = 0;
const DATA_OFFSET_FIELD = 4;
const INDEX_OFFSET = 12;
const HEADER_SIZE = 12;
const SIZE_FIELD_TAIL = 4;
/** Candidate name field widths, narrowest first. */
const NAME_SIZES = [0x14, 0x34, 0x64] as const;
/** The old signature only ever uses the widest candidate. */
const OLD_SIGNATURE_NAME_INDEX = 2;

export const system21PakDescriptor: FormatDescriptor = {
	id: "system21-pak",
	name: "System21 engine resource archive",
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
			source: "Legacy/System21/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PakOpener.ReadIndex`. Records begin at 12 and are a fixed-width name field followed by the
 * stored size, and the data offset the reference passes in accumulates as it walks, so payloads follow
 * each other in index order from behind the index rather than being addressed individually. A record
 * with an empty name rejects the candidate width, and the caller then tries the next one.
 */
function readVariant(
	index: Buffer,
	count: number,
	dataOffset: bigint,
	nameSize: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const stride = nameSize + SIZE_FIELD_TAIL;
	const entries: FixedEntry[] = [];
	let offset = dataOffset;
	for (let id = 0; id < count; id += 1) {
		const record = id * stride;
		const field = index.subarray(record, record + nameSize);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const size = BigInt(index.readUInt32LE(record + nameSize));
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		offset += size;
	}
	return entries;
}

/**
 * GARBro `PakOpener.TryOpen`. Two signatures share the layout: the new one may store names in any of
 * three fixed widths, narrowest first, while the old one only ever uses the widest, which is why the
 * variant search starts at a different index for each. The word at 4 is the data offset and therefore
 * also fixes the index size, and a candidate width is only considered when it divides that size exactly.
 *
 * Each candidate then has to read cleanly, and the port mirrors the ordering so that a file whose names
 * merely happen to fit a narrower width is still read the way the reference would read it. Payloads are
 * stored verbatim; the reference installs no entry decoder for this format.
 */
async function readSystem21Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const signature = header.readUInt32LE(0);
	if (signature !== OLD_SIGNATURE && signature !== NEW_SIGNATURE)
		return undefined;
	const newVersion = signature === NEW_SIGNATURE;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	if (dataOffset < BigInt(HEADER_SIZE) || dataOffset > source.size)
		return undefined;
	const indexSize = dataOffset - BigInt(HEADER_SIZE);
	if (indexSize === 0n) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), Number(indexSize));

	const start = newVersion ? 0 : OLD_SIGNATURE_NAME_INDEX;
	for (let candidate = start; candidate < NAME_SIZES.length; candidate += 1) {
		const nameSize = NAME_SIZES[candidate] ?? NAME_SIZES[0];
		const stride = BigInt(nameSize + SIZE_FIELD_TAIL);
		if (indexSize % stride !== 0n) continue;
		const count = Number(indexSize / stride);
		if (!isSaneCount(count)) continue;
		const entries = readVariant(
			index,
			count,
			dataOffset,
			nameSize,
			source.size,
		);
		if (entries) return entries;
	}
	return undefined;
}

export const system21PakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: system21PakDescriptor,
	detection: {
		signatures: SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSystem21Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSystem21Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System21 PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
