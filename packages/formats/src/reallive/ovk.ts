// Format reference: GARbro ArcFormats/RealLive/ArcOVK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 4;
const VARIANTS = {
	ovk: { entrySize: 0x10, entryExtension: "ogg" },
	nwk: { entrySize: 0x0c, entryExtension: "nwa" },
} as const;

export const ovkDescriptor: FormatDescriptor = {
	id: "reallive-ovk",
	name: "RealLive engine audio archive",
	extensions: ["ovk", "nwk"],
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
			source: "ArcFormats/RealLive/ArcOVK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `OvkOpener.TryOpen`: the extension selects the record width and the audio suffix. */
async function readOvkIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const variant =
		VARIANTS[sourceExtension(sourcePath) as keyof typeof VARIANTS];
	if (!variant) return undefined;
	if (source.size < BigInt(COUNT_OFFSET)) return undefined;
	const count = (await source.readAt(0n, COUNT_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * variant.entrySize;
	const dataOffset = BigInt(COUNT_OFFSET + indexSize);
	if (dataOffset >= source.size) return undefined;
	const index = await source.readAt(BigInt(COUNT_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * variant.entrySize;
		const size = BigInt(index.readUInt32LE(record));
		const offset = BigInt(index.readUInt32LE(record + 4));
		const audioId = index.readUInt32LE(record + 8);
		if (offset < dataOffset) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const name = `${baseName}#${String(audioId).padStart(5, "0")}.${variant.entryExtension}`;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: { audioId },
			}),
		);
	}
	return entries;
}

export const ovkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ovkDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readOvkIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readOvkIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid RealLive audio archive",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
