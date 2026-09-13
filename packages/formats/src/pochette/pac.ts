// Format reference: GARbro Legacy/Pochette/ArcPAC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { readCompanionFile } from "../shared/companion.js";
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

const EXTENSION = "pac";
const COMPANION_EXTENSION = "idx";
const RECORD_SIZE = 0x10;
const NAME_SIZE = 7;
const OFFSET_OFFSET = 8;
const SIZE_OFFSET = 12;

export const pochettePacDescriptor: FormatDescriptor = {
	id: "pochette-pac",
	name: "Pochette resource archive",
	extensions: ["pac"],
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
			source: "Legacy/Pochette/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PacOpener.TryOpen`. The `.pac` file holds only payloads; a sibling `.idx` file holds
 * 0x10-byte records with a one-byte name length, the name, the data offset at +8, and the size at
 * +12. The companion index size must be a multiple of the record size.
 */
async function readPochetteIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companion = await readCompanionFile(
		sourcePath,
		`${baseName}.${COMPANION_EXTENSION}`,
	);
	if (!companion) return undefined;
	if (companion.length % RECORD_SIZE !== 0) return undefined;
	const count = companion.length / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameLength = companion[record] ?? 0;
		if (nameLength === 0 || nameLength > NAME_SIZE) return undefined;
		const name = decodeCStringField(companion, record + 1, nameLength);
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(companion.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(companion.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	return entries;
}

export const pochettePacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pochettePacDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPochetteIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPochetteIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Pochette PAC layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
