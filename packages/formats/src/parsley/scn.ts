// Format reference: GARbro ArcFormats/Software House Parsley/ArcScn.cs
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
import { basename } from "node:path";

const BASE_OFFSET = 0x1400;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;

export const parsleyScnDescriptor: FormatDescriptor = {
	id: "parsley-scn",
	name: "Software House Parsley scenario archive",
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
			source: "ArcFormats/Software House Parsley/ArcScn.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (basename(sourcePath).toLowerCase() !== "scn.dat") return false;
	if (source.size < BigInt(BASE_OFFSET)) return false;
	const first = (await source.readAt(0n, 1))[0] ?? 0;
	return first !== 0;
}

async function readParsleyScn(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley SCN layout");
	}
	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < BASE_OFFSET) {
		const terminator = (await source.readAt(BigInt(position), 1))[0] ?? 0;
		if (terminator === 0) break;
		if (position + RECORD_SIZE > BASE_OFFSET) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Parsley SCN index is truncated",
			);
		}
		const record = await source.readAt(BigInt(position), RECORD_SIZE);
		const name = decodeCStringField(record, 0, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Parsley SCN entry has an empty name",
			);
		}
		const offset = BigInt(record.readUInt32LE(NAME_SIZE)) + BigInt(BASE_OFFSET);
		const size = BigInt(record.readUInt32LE(NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Parsley SCN entry points outside the archive: ${name}`,
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
		position += RECORD_SIZE;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Parsley SCN archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const parsleyScnFormat: ArchiveFormat = defineFixedArchive({
	descriptor: parsleyScnDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readParsleyScn,
});
