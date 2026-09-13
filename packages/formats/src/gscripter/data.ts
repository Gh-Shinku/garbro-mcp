// Format reference: GARbro ArcFormats/GScripter/ArcDATA.cs
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
import { readCompanionFile } from "../shared/companion.js";
import { basename } from "node:path";

const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const OFFSET_OFFSET = 0x20;
const SIZE_OFFSET = 0x24;

export const gscripterDataDescriptor: FormatDescriptor = {
	id: "gscripter-data",
	name: "GScripter engine resource archive",
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
			source: "ArcFormats/GScripter/ArcDATA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function entryType(fileName: string): string | undefined {
	if (fileName.startsWith("CG")) return "image";
	if (fileName.startsWith("SOUND")) return "audio";
	return undefined;
}

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const info = await readCompanionFile(sourcePath, `${sourcePath}.info`);
	if (!info) return undefined;
	if (info.length === 0 || info.length % RECORD_SIZE !== 0) return undefined;
	const count = info.length / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const arcName = basename(sourcePath);
	const type = entryType(arcName);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = info.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		const offset = BigInt(info.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(info.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`GScripter entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: type ? { type } : {},
			}),
		);
	}
	return entries;
}

export const gscripterDataFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gscripterDataDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GScripter index");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
