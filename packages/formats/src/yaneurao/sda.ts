// Format reference: GARBro Legacy/Yaneurao/ArcSDA.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("SQDARC", "ascii");
const DIR_COUNT_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const DIR_RECORD_SIZE = 0x18;
const FILE_RECORD_SIZE = 0x30;
const NAME_SIZE = 0x28;
const DIR_NAME_SIZE = 10;
const EXT_SIZE = 4;
const SIZE_OFFSET = 0x28;
const OFFSET_OFFSET = 0x2c;

export const yaneSdaDescriptor: FormatDescriptor = {
	id: "yaneurao-sda",
	name: "YaneSDK2 resource archive",
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
			source: "Legacy/Yaneurao/ArcSDA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Mirrors `Path.Combine` for the directory and file name GARbro joins. */
function combinePaths(directory: string, name: string): string {
	if (name.startsWith("/") || name.startsWith("\\")) return name;
	if (directory.length === 0) return name;
	return `${directory}/${name}`;
}

/**
 * GARBro `SdaOpener.TryOpen`. The `SQDARC` signature is followed by a directory count at 0x10 and
 * 0x18-byte directory records at 0x14: the first file record's offset, the file count, a ten-byte
 * directory name, and a four-byte extension. File records are 0x30 bytes with a 0x28-byte name and
 * the data offset and size behind it.
 *
 * GARbro joins every file name with its directory and replaces the extension with the one stored in
 * the directory record.
 */
async function readSdaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dirCount = header.readInt32LE(DIR_COUNT_OFFSET);
	if (!isSaneCount(dirCount)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_OFFSET);
	for (let directory = 0; directory < dirCount; directory += 1) {
		if (indexOffset + BigInt(DIR_RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(indexOffset, DIR_RECORD_SIZE);
		let fileOffset = BigInt(record.readUInt32LE(0));
		const fileCount = record.readInt32LE(4);
		const dirName = decodeCStringField(record, 8, DIR_NAME_SIZE);
		const extension = decodeCStringField(record, 8 + DIR_NAME_SIZE, EXT_SIZE);
		if (fileCount < 0) return undefined;
		for (let file = 0; file < fileCount; file += 1) {
			if (fileOffset + BigInt(FILE_RECORD_SIZE) > source.size) return undefined;
			const fileRecord = await source.readAt(fileOffset, FILE_RECORD_SIZE);
			const name = decodeCStringField(fileRecord, 0, NAME_SIZE);
			const offset = BigInt(fileRecord.readUInt32LE(OFFSET_OFFSET));
			const size = BigInt(fileRecord.readUInt32LE(SIZE_OFFSET));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(
						changeExtension(combinePaths(dirName, name), extension),
					),
					offset,
					size,
				}),
			);
			fileOffset += BigInt(FILE_RECORD_SIZE);
		}
		indexOffset += BigInt(DIR_RECORD_SIZE);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const yaneSdaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yaneSdaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSdaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSdaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YaneSDK2 SDA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
