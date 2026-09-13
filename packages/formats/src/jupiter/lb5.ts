// Format reference: GARBro Legacy/Jupiter/ArcLB5.cs
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

const EXTENSION = "lb5";
const COMPANION_EXTENSION = "idx";
const COUNT_OFFSET = 0;
const RECORD_SIZE = 0x18;
const NAME_OFFSET = 9;
const NAME_SIZE = 0x0f;
const SIZE_OFFSET = 4;

export const lb5Descriptor: FormatDescriptor = {
	id: "jupiter-lb5",
	name: "Jupiter resource archive",
	extensions: ["lb5"],
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
			source: "Legacy/Jupiter/ArcLB5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Lb5Opener.TryOpen`. The payload file has a companion `.idx` index: a 32-bit record count
 * and 0x18-byte records with the data offset, the size, and a 15-byte name behind +9.
 */
async function readLb5Index(
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
	if (companion.length < COUNT_OFFSET + 4) return undefined;
	const count = companion.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(COUNT_OFFSET + 4) + BigInt(indexSize) > BigInt(companion.length))
		return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = COUNT_OFFSET + 4 + id * RECORD_SIZE;
		const offset = BigInt(companion.readUInt32LE(record));
		const size = BigInt(companion.readUInt32LE(record + SIZE_OFFSET));
		const name = decodeCStringField(companion, record + NAME_OFFSET, NAME_SIZE);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const lb5Format: ArchiveFormat = defineFixedArchive({
	descriptor: lb5Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLb5Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readLb5Index(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Jupiter LB5 layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
