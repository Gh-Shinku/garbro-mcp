// Format reference: GARbro Legacy/DMotion/ArcDM.cs
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

const SIGNATURE = Buffer.from("PACK", "ascii");
const FORMAT_MARKER = Buffer.from("FILE100DATA", "ascii");
const MARKER_OFFSET = 4;
const PATH_MARKER = Buffer.from(".\\\\\\", "ascii");
const PATH_MARKER_OFFSET = 0x10;
const EXTENSION_COUNT_OFFSET = 0x16;
const INDEX_OFFSET_OFFSET = 0x18;
const EXTENSION_NAME_SIZE = 4;
const EXTENSION_RECORD_SIZE = 0x10;
const ENTRY_NAME_SIZE = 8;
const ENTRY_RECORD_SIZE = 0x10;

export const dmotionPackDescriptor: FormatDescriptor = {
	id: "dmotion-pack",
	name: "D-Motion engine resource archive",
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
			source: "Legacy/DMotion/ArcDM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ExtensionDirectory {
	name: string;
	count: number;
	offset: number;
}

/**
 * GARbro `PakOpener.TryOpen`. A header identifies the engine, then a table of per-extension
 * directories follows; every directory holds entries whose 8-byte stem is completed with the
 * directory's extension.
 */
async function readDmotionIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header
			.subarray(MARKER_OFFSET, MARKER_OFFSET + FORMAT_MARKER.length)
			.equals(FORMAT_MARKER)
	)
		return undefined;
	if (
		!header
			.subarray(PATH_MARKER_OFFSET, PATH_MARKER_OFFSET + PATH_MARKER.length)
			.equals(PATH_MARKER)
	)
		return undefined;
	const extensionCount = header.readUInt16LE(EXTENSION_COUNT_OFFSET);
	let position = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	const directories: ExtensionDirectory[] = [];
	let totalCount = 0;
	for (let id = 0; id < extensionCount; id += 1) {
		if (position + BigInt(EXTENSION_RECORD_SIZE) > source.size)
			return undefined;
		const record = await source.readAt(position, EXTENSION_RECORD_SIZE);
		const directory: ExtensionDirectory = {
			name: decodeCStringField(record, 0, EXTENSION_NAME_SIZE),
			count: record.readUInt16LE(6),
			offset: record.readUInt32LE(8),
		};
		directories.push(directory);
		totalCount += directory.count;
		position += BigInt(EXTENSION_RECORD_SIZE);
	}
	if (!isSaneCount(totalCount)) return undefined;

	const entries: FixedEntry[] = [];
	for (const directory of directories) {
		let entryPosition = BigInt(directory.offset);
		for (let index = 0; index < directory.count; index += 1) {
			if (entryPosition + BigInt(ENTRY_RECORD_SIZE) > source.size)
				return undefined;
			const record = await source.readAt(entryPosition, ENTRY_RECORD_SIZE);
			const stem = decodeCStringField(record, 0, ENTRY_NAME_SIZE).trimEnd();
			const offset = BigInt(record.readUInt32LE(8));
			const size = BigInt(record.readUInt32LE(12));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(`${stem}${directory.name}`),
					offset,
					size,
				}),
			);
			entryPosition += BigInt(ENTRY_RECORD_SIZE);
		}
	}
	return entries;
}

export const dmotionPackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dmotionPackDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDmotionIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDmotionIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid D-Motion archive layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
