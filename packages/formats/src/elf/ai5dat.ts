// Format reference: GARbro ArcFormats/elf/ArcAi5DAT.cs (index reader in ArcAi5Win.cs)
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_XOR_OFFSET = 0;
const KEY_OFFSET = 4;
const NAME_KEY_OFFSET = 0x23;
const INDEX_OFFSET = 8;
/** The name field width GARbro uses for this variant. */
const NAME_SIZE = 0x14;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;
const MIN_NAME_BYTE = 0x20;

export const ai5DatDescriptor: FormatDescriptor = {
	id: "elf-ai5dat",
	name: "AI5WIN engine resource archive",
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
			source: "ArcFormats/elf/ArcAi5DAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/elf/ArcAi5Win.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Ai5DatIndexReader.DecryptName`: name bytes are XORed with the name key, the name ends at
 * the first zero byte, and control bytes are rejected. The name must terminate within one byte of
 * the field width.
 */
function decryptName(field: Buffer, nameKey: number): string | undefined {
	const name = Buffer.alloc(field.length);
	for (let position = 0; position < field.length; position += 1) {
		const value = (field[position] ?? 0) ^ nameKey;
		name[position] = value;
		if (value === 0)
			return position === 0
				? undefined
				: decodeCp932(name.subarray(0, position));
		if (value < MIN_NAME_BYTE) return undefined;
	}
	// A name that never terminates inside the field is rejected, as in the reference reader.
	return undefined;
}

/**
 * GARbro `DatAI5Opener.TryOpen`. The record count at 0 is XORed with the 32-bit key at 4, which also
 * decrypts the per-record size and offset. The name key comes from the last byte of the first name
 * field at 0x23, so the index describes its own encryption.
 */
async function readAi5DatIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(NAME_KEY_OFFSET + 1)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const key = header.readUInt32LE(KEY_OFFSET);
	const count = (header.readUInt32LE(COUNT_XOR_OFFSET) ^ key) >>> 0;
	if (!isSaneCount(count)) return undefined;
	const nameKey = (await source.readAt(BigInt(NAME_KEY_OFFSET), 1))[0] ?? 0;
	const indexSize = count * (NAME_SIZE + 8);
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * (NAME_SIZE + 8);
		const size = BigInt((index.readUInt32LE(record + SIZE_OFFSET) ^ key) >>> 0);
		const offset = BigInt(
			(index.readUInt32LE(record + OFFSET_OFFSET) ^ key) >>> 0,
		);
		// GARbro requires every payload to start behind the index.
		if (offset < BigInt(indexSize + INDEX_OFFSET)) return undefined;
		const name = decryptName(
			index.subarray(record + 8, record + 8 + NAME_SIZE),
			nameKey,
		);
		if (name === undefined) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
			}),
		);
	}
	return entries;
}

export const ai5DatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5DatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAi5DatIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAi5DatIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AI5WIN DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
