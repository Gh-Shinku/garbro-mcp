// Format reference: GARbro Legacy/AlphaSystem/ArcPAK.cs
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

const HEADER_SIZE = 0x34;
const COUNT_OFFSET = 0;
const FIRST_OFFSET_OFFSET = 0x30;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x30;
const SIZE_OFFSET = 0x24;
const OFFSET_OFFSET = 0x2c;

export const alphaSystemPakDescriptor: FormatDescriptor = {
	id: "alpha-system-pak",
	name: "Alpha System resource archive",
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
			source: "Legacy/AlphaSystem/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (header.readInt32LE(FIRST_OFFSET_OFFSET) !== count * RECORD_SIZE + 4)
		return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readAlphaSystemPak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Alpha System PAK layout");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Alpha System PAK entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Alpha System PAK entry points outside the archive: ${name}`,
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
	}
	return { entries, metadata: { entryCount: count } };
}

export const alphaSystemPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alphaSystemPakDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAlphaSystemPak,
});
