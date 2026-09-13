// Format reference: GARbro ArcFormats/YaneSDK/ArcDAT.cs
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const COUNT_XOR = 0x8080;
const INDEX_OFFSET = 2;
const NAME_SIZE = 0x22;
const RECORD_SIZE = 0x2c;
const ENCRYPTED_SIZE_OFFSET = NAME_SIZE;
const SIZE_OFFSET = NAME_SIZE + 2;
const DATA_OFFSET_OFFSET = NAME_SIZE + 6;
/** GARbro `XoredStream (input, 0x80)`: the index is XORed with a constant key. */
const INDEX_KEY = 0x80;

export const yaneDatDescriptor: FormatDescriptor = {
	id: "yane-sdk-dat",
	name: "YaneSDK engine resource archive",
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
			source: "ArcFormats/YaneSDK/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PakOpener.TryOpen`. The record count at 0 is stored XORed with 0x8080 and read back as a
 * signed 16-bit value; the whole index is then XOR-decrypted with 0x80. Records are 0x2c bytes: a
 * 0x22-byte CP932 name, the encrypted prefix size, the stored size, and the data offset.
 */
async function readYaneIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const rawCount = (await source.readAt(0n, INDEX_OFFSET)).readUInt16LE(
		COUNT_OFFSET,
	);
	const unsignedCount = rawCount ^ COUNT_XOR;
	const count =
		unsignedCount >= 0x8000 ? unsignedCount - 0x10000 : unsignedCount;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	if (dataOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ INDEX_KEY;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const encryptedSize = BigInt(
			index.readUInt16LE(record + ENCRYPTED_SIZE_OFFSET),
		);
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + DATA_OFFSET_OFFSET));
		if (offset <= dataOffset || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: encryptedSize !== 0n,
				metadata: { encryptedSize: encryptedSize.toString() },
			}),
		);
	}
	return entries;
}

/** GARbro `PakOpener.OpenEntry`: only the header prefix of an entry is XOR-obfuscated. */
const yaneEntryOpener: FixedEntryOpener = async (source, entry) => {
	const declared = entry.metadata?.encryptedSize;
	const encryptedSize = BigInt(typeof declared === "string" ? declared : "0");
	if (encryptedSize <= 0n)
		return source.createReadStream(entry.offset, entry.size);
	const header = await source.readAt(entry.offset, Number(encryptedSize));
	for (let position = 0; position < header.length; position += 1)
		header[position] = (header[position] ?? 0) ^ INDEX_KEY;
	if (encryptedSize >= entry.size) return Readable.from([header]);
	const rest = source.createReadStream(
		entry.offset + encryptedSize,
		entry.size - encryptedSize,
	);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of rest) yield chunk;
		})(),
	);
};

export const yaneDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yaneDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readYaneIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readYaneIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YaneSDK DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: yaneEntryOpener,
});
