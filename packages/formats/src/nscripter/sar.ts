// Format reference: GARBro ArcFormats/NScripter/ArcSAR.cs, class `SarOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Every length in this format is big-endian. */
const COUNT_OFFSET = 0;
const BASE_OFFSET_FIELD = 2;
const INDEX_OFFSET = 6;
/** The smallest a record can be: one terminating byte plus two words. */
const MINIMUM_RECORD_SIZE = 9;
/** The reference rejects a file whose data region could not hold one ten-byte record per entry. */
const MINIMUM_PER_ENTRY = 10;
const WORD_SIZE = 4;
const OFFSET_FIELD = 0;
const SIZE_FIELD = 4;
const MAXIMUM_NAME_SIZE = 0x1000;

export const nscripterSarDescriptor: FormatDescriptor = {
	id: "nscripter-sar",
	name: "NScripter resource archive",
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
			source: "ArcFormats/NScripter/ArcSAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `SarOpener.TryOpen` with its `ReadName` helper. The file begins with a big-endian entry count and
 * the big-endian offset where the payloads start; the latter must lie inside the file and be large enough for
 * ten bytes per entry, which is the reference's only bound on the count.
 *
 * Names follow the header as plain null-terminated bytes, so this format's index is not encrypted, and each
 * record then holds a big-endian data offset relative to the payload start and a big-endian size. The
 * reference checks before each field that the index region has room for it, so a truncated index is rejected
 * rather than read past, and the port keeps those checks along with the placement check on every entry.
 *
 * The format carries no signature and GARbro registers no extension for it, so the structural checks are the
 * detection. Payloads are stored verbatim; the reference also implements archive creation, which is outside
 * the scope of this read-only port.
 */
async function readSarIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt16BE(COUNT_OFFSET);
	if (count <= 0) return undefined;
	const baseOffset = BigInt(header.readUInt32BE(BASE_OFFSET_FIELD));
	if (baseOffset >= source.size) return undefined;
	if (baseOffset < BigInt(MINIMUM_PER_ENTRY) * BigInt(count)) return undefined;

	const index = await source.readAt(0n, Number(baseOffset));
	const entries: FixedEntry[] = [];
	let cursor = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (baseOffset - cursor < BigInt(MINIMUM_RECORD_SIZE)) return undefined;
		const limit = Number(baseOffset - cursor);
		const nameField = index.subarray(Number(cursor), Number(cursor) + limit);
		const terminator = nameField.indexOf(0);
		if (terminator <= 0) return undefined;
		if (limit === terminator) return undefined;
		const name = decodeCp932(nameField.subarray(0, terminator));
		if (name.length === 0 || name.length > MAXIMUM_NAME_SIZE) return undefined;
		cursor += BigInt(terminator + 1);
		if (baseOffset - cursor < BigInt(WORD_SIZE * 2)) return undefined;
		const record = Number(cursor);
		const offset =
			BigInt(index.readUInt32BE(record + OFFSET_FIELD)) + baseOffset;
		const size = BigInt(index.readUInt32BE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		cursor += BigInt(WORD_SIZE * 2);
	}
	return entries;
}

export const nscripterSarFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nscripterSarDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSarIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSarIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NScripter SAR layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
