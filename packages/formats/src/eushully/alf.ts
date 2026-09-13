// Format reference: GARBro ArcFormats/Eushully/ArcALF.cs, class `AlfOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";

/** The index candidates, in the order the reference tries them. */
const SYS4_INDEX_NAME = "sys4ini.bin";
const SYS3_INDEX_NAME = "sys3ini.bin";
/** The `S4AC` layout keeps its packed index further into the file than the other two magic words. */
const APPEND_MAGIC = Buffer.from("S4AC", "latin1");
const PACKED_MAGIC_S4 = Buffer.from("S4IC", "latin1");
const PACKED_MAGIC_S3 = Buffer.from("S3IC", "latin1");
const PLAIN_MAGIC = Buffer.from("S3IN", "latin1");
const APPEND_OFFSET = 0x114;
const PACKED_OFFSET = 0x134;
const PLAIN_OFFSET = 0x12c;
/** Archive names are 0x100 bytes and file names 0x40. */
const ARCHIVE_NAME_SIZE = 0x100;
const FILE_NAME_SIZE = 0x40;
/** Placeholder names are skipped rather than listed. */
const PLACEHOLDER_NAME = "@";

/** A packed index block is a 32-bit size and an LZSS stream that runs to the end of the block. */
async function readPackedIndex(
	ini: Buffer,
	offset: number,
): Promise<Buffer | undefined> {
	if (offset + 4 > ini.length) return undefined;
	const packedSize = ini.readUInt32LE(offset);
	if (offset + 4 + packedSize > ini.length) return undefined;
	return inflateLzssAll(ini.subarray(offset + 4, offset + 4 + packedSize));
}

/**
 * GARBro `AlfOpener.ReadSysIni`. The index opens with an archive count and a 0x100-byte name block per
 * archive, then a file count and 0x40-byte name blocks followed by the archive id, an unused file number
 * and the payload offset and size. Entries named `@` are placeholders and are skipped, and an archive id
 * outside the archive list rejects the whole index.
 */
function readSysIni(index: Buffer): Map<string, FixedEntry[]> | undefined {
	if (index.length < 4) return undefined;
	const archiveCount = index.readInt32LE(0);
	if (!isSaneCount(archiveCount)) return undefined;
	const table = new Map<string, FixedEntry[]>();
	const names: string[] = [];
	let cursor = 4;
	for (let id = 0; id < archiveCount; id += 1) {
		if (cursor + ARCHIVE_NAME_SIZE > index.length) return undefined;
		const archiveName = decodeCStringField(index, cursor, ARCHIVE_NAME_SIZE);
		// The reference's table rejects a duplicate name by throwing, which declines the index.
		if (table.has(archiveName.toLowerCase())) return undefined;
		names.push(archiveName);
		table.set(archiveName.toLowerCase(), []);
		cursor += ARCHIVE_NAME_SIZE;
	}
	if (cursor + 4 > index.length) return undefined;
	const fileCount = index.readInt32LE(cursor);
	if (!isSaneCount(fileCount)) return undefined;
	cursor += 4;
	for (let i = 0; i < fileCount; i += 1) {
		if (cursor + FILE_NAME_SIZE + 16 > index.length) return undefined;
		const name = decodeCStringField(index, cursor, FILE_NAME_SIZE);
		const archiveId = index.readInt32LE(cursor + FILE_NAME_SIZE);
		if (archiveId < 0 || archiveId >= archiveCount) return undefined;
		const offset = BigInt(index.readUInt32LE(cursor + FILE_NAME_SIZE + 8));
		const storedSize = BigInt(index.readUInt32LE(cursor + FILE_NAME_SIZE + 12));
		cursor += FILE_NAME_SIZE + 16;
		if (name === PLACEHOLDER_NAME) continue;
		const entries = table.get(names[archiveId]?.toLowerCase() ?? "");
		entries?.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	return table;
}

/** Reads the first index candidate that exists and parses, and returns this archive's entry list. */
async function readAlfIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const fileName = basename(sourcePath);
	const candidates = [
		SYS4_INDEX_NAME,
		SYS3_INDEX_NAME,
		basename(changeExtension(sourcePath, "AAI")),
	];
	for (const candidate of candidates) {
		const ini = await readCompanionFile(sourcePath, candidate);
		if (!ini || ini.length < 4) continue;
		let index: Buffer | undefined;
		if (ini.subarray(0, 4).equals(APPEND_MAGIC))
			index = await readPackedIndex(ini, APPEND_OFFSET);
		else if (
			ini.subarray(0, 4).equals(PACKED_MAGIC_S4) ||
			ini.subarray(0, 4).equals(PACKED_MAGIC_S3)
		)
			index = await readPackedIndex(ini, PACKED_OFFSET);
		else if (ini.subarray(0, 4).equals(PLAIN_MAGIC)) {
			if (PLAIN_OFFSET > ini.length) continue;
			index = ini.subarray(PLAIN_OFFSET);
		} else continue;
		if (!index) continue;
		const table = readSysIni(index);
		if (!table) continue;
		const entries = table.get(fileName.toLowerCase());
		// The reference only reports an archive that its index actually lists, and validates placement.
		if (!entries || entries.length === 0) continue;
		for (const entry of entries)
			if (!checkPlacement(entry.offset, entry.packedSize, source.size))
				return undefined;
		return entries;
	}
	return undefined;
}

export const eushullyAlfDescriptor: FormatDescriptor = {
	id: "eushully-alf",
	name: "Eushully resource archive",
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
			source: "ArcFormats/Eushully/ArcALF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eushullyAlfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eushullyAlfDescriptor,
	// The archive is a bare payload blob, so the index decides whether the format applies.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAlfIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAlfIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eushully ALF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
