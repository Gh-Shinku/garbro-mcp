// Format reference: GARbro Legacy/Herb/ArcPAK.cs
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

const BASE_OFFSET = 0x20000;
const TAG_OFFSET = 0x40;
const TAG = Buffer.from("..\0", "binary");
const INDEX_OFFSET = 0x80;
const NAME_SIZE = 0x30;
const RECORD_SIZE = 0x40;
const OFFSET_OFFSET = 0x30;
const SIZE_OFFSET = 0x38;
const MAXIMUM_ENTRIES = 0x40000;

export const herbPakDescriptor: FormatDescriptor = {
	id: "herb-pak",
	name: "Herb Soft resource archive",
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
			source: "Legacy/Herb/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size <= BigInt(BASE_OFFSET)) return false;
	if (BigInt(TAG_OFFSET + TAG.length) > source.size) return false;
	const tag = await source.readAt(BigInt(TAG_OFFSET), TAG.length);
	return tag.equals(TAG);
}

async function readHerbPak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Herb Soft PAK layout");
	}
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	while (position < BigInt(BASE_OFFSET) && entries.length < MAXIMUM_ENTRIES) {
		const first = (await source.readAt(position, 1))[0] ?? 0;
		if (first === 0) break;
		if (position + BigInt(RECORD_SIZE) > BigInt(BASE_OFFSET)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Herb Soft PAK index is truncated",
			);
		}
		const record = await source.readAt(position, RECORD_SIZE);
		const name = decodeCStringField(record, 0, NAME_SIZE);
		const offset =
			BigInt(record.readUInt32LE(OFFSET_OFFSET)) + BigInt(BASE_OFFSET);
		const size = BigInt(record.readUInt32LE(SIZE_OFFSET));
		position += BigInt(RECORD_SIZE);
		if (size === 0n) continue;
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Herb Soft PAK entry has an empty name",
			);
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Herb Soft PAK entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Herb Soft PAK archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const herbPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: herbPakDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return parseHeader(source);
	},
	read: readHerbPak,
});
