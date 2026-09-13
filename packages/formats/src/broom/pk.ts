// Format reference: GARBro Legacy/BRoom/ArcPK.cs, classes `PkOpener` and `EncryptedPkOpener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSIONS = ["pk", "cpc"];
const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
/** Records hold a word before the size, then the size and a fixed name field. */
const RECORD_SIZE = 0x18;
const SIZE_FIELD = 4;
const NAME_FIELD = 8;
const NAME_SIZE = 0x10;
/** The encrypted variant hides its count behind this mask. */
const COUNT_MASK = 0xff559977;
const ENCRYPTED_NAME_BYTES = 14;
const ENCRYPTED_NAME_KEY = Buffer.from([
	0xf5, 0xb2, 0xa4, 0x45, 0x59, 0x0f, 0x15, 0x22, 0x43, 0x0b, 0x99, 0x3c, 0xdd,
	0xe2,
]);
/** Name checksum fold: one byte per position within each group of four. */
const CHECKSUM_MASK = 0x3ff;
const OFFSET_MASK = 0x35846;
const SIZE_MASK = 0x57982525;
/** Names with none of these extensions are rewritten to a `.Erp` one. */
const REPLACED_EXTENSIONS = new Set(["", "e", "er"]);
const REPLACEMENT_EXTENSION = "Erp";

export const broomPkDescriptor: FormatDescriptor = {
	id: "broom-pk",
	name: "Studio B-Room resource archive",
	extensions: EXTENSIONS,
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
			source: "Legacy/BRoom/ArcPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const broomEncryptedPkDescriptor: FormatDescriptor = {
	id: "broom-pk-encrypted",
	name: "Studio B-Room encrypted resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: broomPkDescriptor.attribution,
};

/**
 * GARBro `PkOpener.TryOpen`. The count sits at 0 and records are 0x18 bytes: a word the reference skips,
 * the stored size, and a 0x10-byte name field. Payloads begin behind the whole index and follow each other
 * in index order, so offsets accumulate rather than being stored.
 *
 * The reference then requires the accumulated end to equal the file length exactly, which the port keeps:
 * an archive with trailing bytes is rejected. The format has no signature, so the extensions and that
 * exact-coverage check together are the detection.
 */
async function readBroomIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (
		sourceExtension(sourcePath) !== "pk" &&
		sourceExtension(sourcePath) !== "cpc"
	)
		return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	let dataOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (dataOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const field = index.subarray(
			record + NAME_FIELD,
			record + NAME_FIELD + NAME_SIZE,
		);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.trim().length === 0) return undefined;
		if (!checkPlacement(dataOffset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		dataOffset += size;
	}
	if (dataOffset !== source.size) return undefined;
	return entries;
}

/**
 * GARBro `EncryptedPkOpener.TryOpen`. The entry count is the word at 0 exclusive-ored with a fixed mask,
 * and records keep the 0x18-byte stride of the plain variant but only use fourteen name bytes, which are
 * exclusive-ored with a fixed key. The decrypted name bytes up to the terminator fold into a ten-bit
 * checksum — each byte shifted by eight times its position within a group of four — and that checksum
 * masks both the offset and the size of the entry.
 *
 * A name with no extension, or with an `.e` or `.er` one, has its extension replaced by `.Erp`. Unlike the
 * plain variant the reference never requires the payloads to cover the file exactly, so neither does the
 * port; it only requires the index to end inside the file. Payloads are extracted verbatim.
 */
async function readEncryptedBroomIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count =
		(await source.readAt(0n, INDEX_OFFSET)).readUInt32LE(COUNT_OFFSET) ^
		COUNT_MASK;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	if (dataOffset >= source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const rawOffset = index.readUInt32LE(record);
		const rawSize = index.readUInt32LE(record + SIZE_FIELD);
		const nameBytes: number[] = [];
		let checksum = 0;
		for (let position = 0; position < ENCRYPTED_NAME_BYTES; position += 1) {
			const value =
				(index.readUInt8(record + NAME_FIELD + position) ^
					(ENCRYPTED_NAME_KEY[position] ?? 0)) &
				0xff;
			if (value === 0) break;
			nameBytes.push(value);
			checksum += (value << ((position & 3) * 8)) >>> 0;
		}
		const foldedChecksum = checksum & CHECKSUM_MASK;
		const decodedName = decodeCp932(Buffer.from(nameBytes));
		if (decodedName.trim().length === 0) return undefined;
		const extension = sourceExtension(decodedName);
		const name = REPLACED_EXTENSIONS.has(extension)
			? `${decodedName.replace(/\.[^.]*$/, "")}.${REPLACEMENT_EXTENSION}`
			: decodedName;
		const offset = BigInt((rawOffset ^ foldedChecksum ^ OFFSET_MASK) >>> 0);
		const size = BigInt((rawSize ^ foldedChecksum ^ SIZE_MASK) >>> 0);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
				metadata: { checksum: foldedChecksum },
			}),
		);
	}
	return entries;
}

export const broomPkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: broomPkDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBroomIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readBroomIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio B-Room PK layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const broomEncryptedPkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: broomEncryptedPkDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		// The names are decrypted to decide this format, so the plain variant is checked first.
		if (
			sourceExtension(sourcePath) === "pk" ||
			sourceExtension(sourcePath) === "cpc"
		)
			return false;
		return (await readEncryptedBroomIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readEncryptedBroomIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio B-Room encrypted PK layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
