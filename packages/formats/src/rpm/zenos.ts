// Format reference: GARbro ArcFormats/RPM/ArcZENOS.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
} from "../shared/fixed-archive.js";
import { createRpmEntry, rpmEntryOpener } from "./arc.js";
import {
	guessRpmScheme,
	type RpmEncryptionScheme,
	type RpmIndexRecord,
	readRpmIndex,
} from "./index-reader.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x10;
const RECORD_SIZE = NAME_SIZE + 12;

export const rpmZenosDescriptor: FormatDescriptor = {
	id: "rpm-zenos",
	name: "Zenos resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/RPM/ArcZENOS.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

interface ZenosIndex {
	count: number;
	scheme: RpmEncryptionScheme;
	records: RpmIndexRecord[];
}

async function parseZenos(source: ByteSource): Promise<ZenosIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET + 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) >= source.size)
		return undefined;
	const scheme = await guessRpmScheme(source, count, INDEX_OFFSET, [NAME_SIZE]);
	if (!scheme) return undefined;
	const records = await readRpmIndex(source, count, INDEX_OFFSET, scheme);
	if (!records) return undefined;
	return { count, scheme, records };
}

export const rpmZenosFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rpmZenosDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseZenos(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await parseZenos(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Zenos archive layout");
		// GARbro constructs the Zenos index reader with compression always enabled.
		const entries: FixedEntry[] = index.records.map((record, id) =>
			createRpmEntry(record, id, true),
		);
		return {
			entries,
			metadata: {
				entryCount: index.count,
				keyword: index.scheme.keyword,
				nameLength: index.scheme.nameLength,
				compressed: true,
			},
		};
	},
	openEntry: rpmEntryOpener,
});
