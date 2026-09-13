// Format reference: GARBro ArcFormats/Software House Parsley/ArcUCG.cs
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x64;
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x14;
const OFFSET_OFFSET = 0x14;
/** Archives whose name contains `CG` hold images. */
const CG_MARKER = "cg";

export const ucgDescriptor: FormatDescriptor = {
	id: "parsley-ucg",
	name: "Software House Parsley CG archive",
	extensions: [""],
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
			source: "ArcFormats/Software House Parsley/ArcUCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `UcgOpener.TryOpen`. The first byte is 0x64 and a 32-bit record count follows at 4.
 * Records are 0x18 bytes with a 0x14-byte name and the data offset behind it; the offset must start
 * behind the index. Sizes come from the next offset, with the last entry running to the end of the
 * file, so records are extracted raw.
 */
async function readUcgIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if ((header[0] ?? 0) !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const firstOffset = BigInt(INDEX_OFFSET + indexSize);
	if (firstOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const isCg = basename(sourcePath).toLowerCase().includes(CG_MARKER);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		if (offset < firstOffset || offset > source.size) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: 0n,
		});
		if (isCg) entry.metadata = { image: true };
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	for (const [position, entry] of entries.entries()) {
		const next = entries[position + 1]?.offset ?? source.size;
		const size = next - entry.offset;
		if (size < 0n || !checkPlacement(entry.offset, size, source.size))
			return undefined;
		entry.size = size;
		entry.packedSize = size;
	}
	return entries;
}

export const ucgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ucgDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readUcgIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readUcgIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Software House Parsley UCG layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
