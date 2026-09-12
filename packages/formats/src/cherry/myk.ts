// Format reference: GARbro ArcFormats/Cherry/ArcMyk.cs
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [Buffer.from("MYK0", "ascii"), Buffer.from("CHE0", "ascii")];
const VERSION_MARKER_OFFSET = 4;
const VERSION_MARKER = 0x1a30;
const COUNT_OFFSET = 8;
const INDEX_POINTER_OFFSET = 0x0a;
const NAME_SIZE = 0x0c;
const RECORD_SIZE = 0x10;
const SIZE_OFFSET = 0x0c;
const DATA_OFFSET = 0x10;

export const mykDescriptor: FormatDescriptor = {
	id: "cherry-myk",
	name: "Cherry Soft resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Cherry/ArcMyk.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface MykHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<MykHeader | undefined> {
	if (source.size < BigInt(INDEX_POINTER_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_POINTER_OFFSET + 4);
	if (!SIGNATURES.some((signature) => header.subarray(0, 4).equals(signature)))
		return undefined;
	if (header.readUInt16LE(VERSION_MARKER_OFFSET) !== VERSION_MARKER)
		return undefined;
	const count = header.readUInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset };
}

async function readMyk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Cherry MYK layout");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	let offset = BigInt(DATA_OFFSET);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cherry MYK entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Cherry MYK entry points outside the archive: ${name}`,
			);
		}
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
	return { entries, metadata: { entryCount: count } };
}

export const mykFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mykDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readMyk,
});
