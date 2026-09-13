// Format reference: GARbro ArcFormats/BlackCyc/ArcGPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "gpk";
const COMPANION_EXTENSION = "gtb";
const COUNT_OFFSET = 0;
const NAME_INDEX_OFFSET = 4;
/** GARbro appends this container extension to every name stored in the companion index. */
const ENTRY_EXTENSION = ".dwq";

export const gpkDescriptor: FormatDescriptor = {
	id: "black-cyc-gpk",
	name: "Black Cyc engine images archive",
	extensions: ["gpk"],
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
			source: "ArcFormats/BlackCyc/ArcGPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `GpkOpener.TryOpen`. The archive itself stores only payload bytes; a sibling `.gtb` file
 * holds the record count, a table of name-field offsets, a table of data offsets, and the name blob.
 * Entry sizes are derived from consecutive data offsets, and the last entry runs to the end of the
 * archive.
 */
async function readGpkIndex(
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
	if (companion.length < NAME_INDEX_OFFSET) return undefined;
	const count = companion.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const offsetsIndex = NAME_INDEX_OFFSET + count * 4;
	const nameBase = offsetsIndex + count * 4;
	if (nameBase >= companion.length) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const nameIndex = NAME_INDEX_OFFSET + id * 4;
		const nameOffset = nameBase + companion.readInt32LE(nameIndex);
		if (nameOffset < nameBase || nameOffset >= companion.length)
			return undefined;
		const terminator = companion.indexOf(0, nameOffset);
		const rawName = decodeCp932(
			companion.subarray(
				nameOffset,
				terminator === -1 ? companion.length : terminator,
			),
		);
		const offset = BigInt(companion.readUInt32LE(offsetsIndex + id * 4));
		const next =
			id + 1 === count
				? source.size
				: BigInt(companion.readUInt32LE(offsetsIndex + (id + 1) * 4));
		const size = next - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${rawName}${ENTRY_EXTENSION}`),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const gpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gpkDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGpkIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGpkIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Black Cyc GPK layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
