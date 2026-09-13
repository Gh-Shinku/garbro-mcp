// Format reference: GARbro ArcFormats/ShiinaRio/ArcS25.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("S25\0", "latin1");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const MAX_COUNT = 0xfffff;

export const s25Descriptor: FormatDescriptor = {
	id: "shiina-rio-s25",
	name: "ShiinaRio engine multi-image",
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
			source: "ArcFormats/ShiinaRio/ArcS25.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `S25Opener.TryOpen`. The index is a flat list of 32-bit offsets; entries outside the file
 * are skipped. Surviving entries are sorted by offset and take their size from the next offset, with
 * the last one running to the end of the file.
 */
async function readS25Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > MAX_COUNT) return undefined;
	const indexSize = count * 4;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * 4));
		if (offset === 0n || offset > source.size) continue;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}@${String(id).padStart(4, "0")}`),
				offset,
				size: 0n,
				metadata: { bpp: 32 },
			}),
		);
	}
	entries.sort((left, right) =>
		left.offset < right.offset ? -1 : left.offset > right.offset ? 1 : 0,
	);
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

export const s25Format: ArchiveFormat = defineFixedArchive({
	descriptor: s25Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readS25Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readS25Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ShiinaRio S25 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
