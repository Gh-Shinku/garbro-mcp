// Format reference: GARBro ArcFormats/ExHibit/ArcGRP.cs, class `GrpOpener`.
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Only archives whose name matches this pattern are handled. */
const NAME_PATTERN = /res(\d+)\.grp$/i;
/** A file beginning with this marker is a table of contents, not an archive. */
const TOC_MARKER = Buffer.from("AiFS", "ascii");
const TOC_RES_COUNT_OFFSET = 0x0c;
/** Blocks begin here and each is a header followed by eight-byte records. */
const FIRST_BLOCK_OFFSET = 0x10;
const BLOCK_HEADER_SIZE = 0x10;
/** A block whose first word is this one carries its reference number in the next word. */
const BLOCK_MARKER = 0x01000000;
const BLOCK_START_INDEX_FIELD = 4;
const BLOCK_COUNT_FIELD = 0x0c;
const BLOCK_ENTRY_COUNT_FIELD = 0x0c;
/** A record is a data offset and a size. */
const RECORD_SIZE = 8;
const RECORD_OFFSET_FIELD = 0;
const RECORD_SIZE_FIELD = 4;
/** The table of contents is looked for by rewriting the digits of the archive's own name. */
const TOC_NAME_DIGITS = 4;
/** Entries are named from a starting index with this many digits. */
const ENTRY_DIGITS = 5;
const AUDIO_EXTENSION = "ogg";

export const exhGRPDescriptor: FormatDescriptor = {
	id: "exhibit-grp",
	name: "ExHIBIT engine audio resource archive",
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
			source: "ArcFormats/ExHibit/ArcGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro's table-of-contents search. An archive named `res<digits>.grp` is described by a *sibling* file whose
 * digits count down from one less than its own, and the first such sibling that exists and begins with `AiFS` is
 * the table. A sibling that does not exist ends the search immediately rather than being skipped, so the numbered
 * files between the archive and its table must form a contiguous run; the reference number by which this archive
 * is addressed inside the table rises by one for every step of that walk.
 */
async function findTable(
	sourcePath: string,
	digits: string,
	startNumber: number,
): Promise<{ table: Buffer; reference: number } | undefined> {
	const stem = basename(sourcePath);
	for (
		let number = startNumber, reference = 1;
		number >= 0;
		number -= 1, reference += 1
	) {
		const name = stem.replace(
			digits,
			String(number).padStart(TOC_NAME_DIGITS, "0"),
		);
		const table = await readCompanionFile(sourcePath, name);
		if (!table) return undefined;
		if (table.subarray(0, TOC_MARKER.length).equals(TOC_MARKER)) {
			return { table, reference };
		}
	}
	return undefined;
}

/**
 * GARBro `GrpOpener.TryOpen`. The table of contents holds a resource count at 0x0C and then one block per
 * archive, each an 0x10-byte header followed by eight-byte records. A block is this archive's when its first
 * word equals the reference number the search produced — or, when that word is exactly 0x01000000, when the word
 * behind it does. Blocks that are not this archive's are skipped by their own record count, which is why the
 * walk has to read each one's header.
 *
 * The matching block then holds a starting index at 4 and a record count at 0x0C. Its records give a data offset
 * and a size, and a record with a zero size is skipped entirely rather than producing an empty entry. Entries are
 * named from the starting index with five digits and an `.ogg` extension, are classified as audio, and are
 * checked against the *archive's* length rather than the table's, since that is the file their offsets address.
 * Payloads are stored verbatim.
 */
async function readExhibitIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const match = NAME_PATTERN.exec(basename(sourcePath));
	if (!match) return undefined;
	if (source.size < BigInt(TOC_MARKER.length)) return undefined;
	if ((await source.readAt(0n, TOC_MARKER.length)).equals(TOC_MARKER))
		return undefined;
	const digits = match[1] ?? "";
	const archiveNumber = Number.parseInt(digits, 10);
	if (!Number.isSafeInteger(archiveNumber)) return undefined;
	const found = await findTable(sourcePath, digits, archiveNumber - 1);
	if (!found) return undefined;
	const { table, reference } = found;
	if (table.length < FIRST_BLOCK_OFFSET) return undefined;
	const resourceCount = table.readInt32LE(TOC_RES_COUNT_OFFSET);
	if (resourceCount < reference) return undefined;

	let position = FIRST_BLOCK_OFFSET;
	let matched = false;
	for (let id = 0; id < resourceCount && position < table.length; id += 1) {
		let number = table.readInt32LE(position);
		if (number === BLOCK_MARKER) {
			position += 4;
			if (position + 4 > table.length) return undefined;
			number = table.readInt32LE(position);
		}
		if (number === reference) {
			matched = true;
			break;
		}
		if (position + BLOCK_HEADER_SIZE > table.length) return undefined;
		const entries = table.readUInt32LE(position + BLOCK_ENTRY_COUNT_FIELD);
		position += BLOCK_HEADER_SIZE + entries * RECORD_SIZE;
	}
	if (!matched) return undefined;
	if (position + BLOCK_HEADER_SIZE > table.length) return undefined;
	const count = table.readInt32LE(position + BLOCK_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const startIndex = table.readInt32LE(position + BLOCK_START_INDEX_FIELD);
	position += BLOCK_HEADER_SIZE;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + RECORD_SIZE > table.length) return undefined;
		const offset = BigInt(table.readUInt32LE(position + RECORD_OFFSET_FIELD));
		const size = BigInt(table.readUInt32LE(position + RECORD_SIZE_FIELD));
		position += RECORD_SIZE;
		// A record with no size holds no entry at all.
		if (size === 0n) continue;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					`${String(startIndex + id).padStart(ENTRY_DIGITS, "0")}.${AUDIO_EXTENSION}`,
				),
				offset,
				size,
				metadata: { inferredType: "audio" },
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const exhGRPFormat: ArchiveFormat = defineFixedArchive({
	descriptor: exhGRPDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readExhibitIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readExhibitIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ExHIBIT GRP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
