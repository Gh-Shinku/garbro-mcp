// Format reference: GARbro ArcFormats/Cyberworks/ArcP8.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x1c;
const SIZE_OFFSET = 0x10;
const OFFSET_OFFSET = 0x18;

export const p8Descriptor: FormatDescriptor = {
	id: "tinkerbell-p8",
	name: "TinkerBell resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/Cyberworks/ArcP8.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<number | undefined> {
	if (sourceExtension(sourcePath) !== "pak") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(0);
	return isSaneCount(count) ? count : undefined;
}

async function readP8(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source, sourcePath);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid TinkerBell P8 layout");
	}
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"TinkerBell P8 index is truncated",
		);
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) continue;
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (
			offset <= BigInt(INDEX_OFFSET + recordOffset) ||
			!checkPlacement(offset, size, source.size)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`TinkerBell P8 entry points outside the archive: ${name}`,
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
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "TinkerBell P8 archive is empty");
	}
	return { entries, metadata: { entryCount: count } };
}

export const p8Format: ArchiveFormat = defineFixedArchive({
	descriptor: p8Descriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		const count = await parseHeader(source, sourcePath);
		return (
			count !== undefined &&
			BigInt(INDEX_OFFSET + count * RECORD_SIZE) <= source.size
		);
	},
	read: readP8,
});
