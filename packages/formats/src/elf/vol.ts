// Format reference: GARBro ArcFormats/elf/ArcVOL.cs, class `VolOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "vol";
const FIRST_OFFSET_FIELD = 0;
const WORD_SIZE = 4;
const INDEX_OFFSET = 4;
/** The first payload begins at or behind this offset and is aligned to sixteen bytes. */
const MINIMUM_FIRST_OFFSET = 0x10;
const ALIGNMENT_MASK = 0x0f;
const NAME_DIGITS = 4;

export const volDescriptor: FormatDescriptor = {
	id: "elf-vol",
	name: "Ancient elf resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/elf/ArcVOL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `VolOpener.TryOpen`. The file needs a `vol` extension and starts with the first payload's offset,
 * which must be at least 0x10, aligned to sixteen bytes and inside the file. Dividing it by four gives the
 * number of words the offset table may hold, so the count is an upper bound derived from the very offset it
 * describes rather than a stored value.
 *
 * The table is read from offset 4 while its words keep increasing, and the walk stops early when a word equals
 * the file length — a terminator that ends the list wherever it appears, so a table can hold fewer offsets than
 * the count allows. Every entry then spans the gap between two consecutive offsets, and the reference *skips* a
 * pair whose gap is zero instead of emitting an empty entry, which leaves a hole in the generated numbering.
 *
 * Names are built from the archive name and a four-digit index. The reference creates each entry through its
 * lazy catalog lookup, and the port records no type, since these names carry no extension to infer one from.
 */
async function readVolIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(MINIMUM_FIRST_OFFSET)) return undefined;
	const header = await source.readAt(0n, MINIMUM_FIRST_OFFSET);
	const firstOffset = BigInt(header.readUInt32LE(FIRST_OFFSET_FIELD));
	if (firstOffset < BigInt(MINIMUM_FIRST_OFFSET)) return undefined;
	if ((firstOffset & BigInt(ALIGNMENT_MASK)) !== 0n) return undefined;
	if (firstOffset >= source.size) return undefined;
	const count = Number(firstOffset / BigInt(WORD_SIZE));
	if (!isSaneCount(count)) return undefined;

	const offsets: bigint[] = [firstOffset];
	let position = INDEX_OFFSET;
	for (let id = 1; id < count; id += 1) {
		if (BigInt(position) + BigInt(WORD_SIZE) > source.size) break;
		const word = (
			await source.readAt(BigInt(position), WORD_SIZE)
		).readUInt32LE(0);
		const offset = BigInt(word);
		const previous = offsets[offsets.length - 1] ?? 0n;
		if (offset < previous || offset > source.size) return undefined;
		offsets.push(offset);
		if (offset === source.size) break;
		position += WORD_SIZE;
	}

	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id + 1 < offsets.length; id += 1) {
		const start = offsets[id] ?? 0n;
		const end = offsets[id + 1] ?? 0n;
		const size = end - start;
		// The reference skips a zero-length span rather than storing an empty entry.
		if (size === 0n) continue;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(NAME_DIGITS, "0")}`,
				),
				offset: start,
				size,
			}),
		);
	}
	return entries;
}

export const volFormat: ArchiveFormat = defineFixedArchive({
	descriptor: volDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVolIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readVolIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Ancient elf VOL layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
