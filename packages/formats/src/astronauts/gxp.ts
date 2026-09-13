// Format reference: GARBro ArcFormats/Astronauts/ArcGXP.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GXP", "ascii");
const COUNT_OFFSET = 0x18;
const BASE_OFFSET_OFFSET = 0x28;
const INDEX_OFFSET = 0x30;
const NAME_LENGTH_OFFSET = 0x0c;
const DATA_OFFSET_OFFSET = 0x18;
const SIZE_OFFSET = 4;
const NAME_OFFSET = 0x20;
const MIN_RECORD_SIZE = 0x20;
const MAX_RECORD_SIZE = 0x1000;
/** Shipped key that obfuscates records and payloads. */
const KEY = Buffer.from([
	0x40, 0x21, 0x28, 0x38, 0xa6, 0x6e, 0x43, 0xa5, 0x40, 0x21, 0x28, 0x38, 0xa6,
	0x43, 0xa5, 0x64, 0x3e, 0x65, 0x24, 0x20, 0x46, 0x6e, 0x74,
]);
/** Key word that decrypts each record length. */
const LENGTH_KEY =
	((KEY[0] ?? 0) |
		((1 ^ (KEY[1] ?? 0)) << 8) |
		((2 ^ (KEY[2] ?? 0)) << 16) |
		((3 ^ (KEY[3] ?? 0)) << 24)) >>>
	0;

export const gxpDescriptor: FormatDescriptor = {
	id: "astronauts-gxp",
	name: "Astronauts resource archive",
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
			source: "ArcFormats/Astronauts/ArcGXP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `PakOpener.Decrypt`: XOR each byte with its index and the repeating key. */
function decrypt(data: Buffer): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(data[position] ?? 0) ^
			(position ^ ((KEY[position % KEY.length] ?? 0) & 0xff));
	}
}

/**
 * GARBro `PakOpener.TryOpen`. Records start at 0x30 with a length that is obfuscated by a key word;
 * the record itself is decrypted, then read as a 16-bit name length at +0x0c (in characters), a
 * 64-bit data offset at +0x18, and a UTF-16LE name at +0x20. Data offsets are relative to the base
 * offset stored at 0x28.
 */
async function readGxpIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = header.readBigInt64LE(BASE_OFFSET_OFFSET);
	if (baseOffset < 0n) return undefined;

	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position + 4n > source.size) return undefined;
		const recordSize =
			((await source.readAt(position, 4)).readUInt32LE(0) ^ LENGTH_KEY) >>> 0;
		if (recordSize < MIN_RECORD_SIZE || recordSize > MAX_RECORD_SIZE)
			return undefined;
		if (position + BigInt(recordSize) > source.size) return undefined;
		const record = await source.readAt(position, recordSize);
		decrypt(record);
		const nameLength = record.readInt32LE(NAME_LENGTH_OFFSET) * 2;
		if (nameLength < 0 || nameLength >= recordSize) return undefined;
		if (NAME_OFFSET + nameLength > recordSize) return undefined;
		const name = record
			.subarray(NAME_OFFSET, NAME_OFFSET + nameLength)
			.toString("utf16le");
		const offset = baseOffset + record.readBigInt64LE(DATA_OFFSET_OFFSET);
		const size = BigInt(record.readUInt32LE(SIZE_OFFSET));
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
		position += BigInt(recordSize);
	}
	return entries;
}

/** GARbro `PakOpener.OpenEntry`: payloads use the same decryption as the records. */
const gxpEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	decrypt(payload);
	return Readable.from([payload]);
};

export const gxpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gxpDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGxpIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readGxpIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Astronauts GXP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: gxpEntryOpener,
});
