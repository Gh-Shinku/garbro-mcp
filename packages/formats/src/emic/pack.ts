// Format reference: GARBro ArcFormats/Emic/ArcPACK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PACK", "ascii");
const EXTENSION = "pac";
const INDEX_OFFSET = 0x2c;
const KEY_SIZE = 0x20;
const NAME_LIMIT = 0x108;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;

interface EmicHeader {
	count: number;
	encrypted: boolean;
	key: Buffer;
}

export const emicDescriptor: FormatDescriptor = {
	id: "emic-pack",
	name: "Emic engine resource archive",
	extensions: ["pac"],
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
			source: "ArcFormats/Emic/ArcPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `ByteStringEncryptedStream`: XOR each byte with the key cycled from the given position. */
function xorWithKey(data: Buffer, key: Buffer, startPosition: number): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(data[position] ?? 0) ^
			(key[(startPosition + position) % key.length] ?? 0);
	}
}

/**
 * GARbro `PacOpener.TryOpen` reads two header layouts. The first stores the record count at 0x28 and
 * the encryption flag at 4 with a key at 8; when those are not plausible the second layout stores the
 * count at 4 and the flag at 8 with a key at 0xC. In both cases the key is 0x20 bytes masked with a
 * constant and the index begins at 0x2C.
 */
function parseHeader(header: Buffer): EmicHeader | undefined {
	let count = header.readInt32LE(0x28);
	let encryptedFlag = header.readUInt32LE(4);
	let keyOffset = 8;
	let keyMask = 0xaa;
	if (!isSaneCount(count) || encryptedFlag > 1) {
		count = header.readInt32LE(4);
		encryptedFlag = header.readUInt32LE(8);
		if (!isSaneCount(count) || encryptedFlag > 1) return undefined;
		keyOffset = 0x0c;
		keyMask = 0xab;
	}
	const key = Buffer.from(header.subarray(keyOffset, keyOffset + KEY_SIZE));
	for (let position = 0; position < key.length; position += 1)
		key[position] = (key[position] ?? 0) ^ keyMask;
	return { count, encrypted: encryptedFlag === 1, key };
}

/**
 * GARBro `PacOpener.TryOpen` index records: a 32-bit name length between 1 and 0x108, that many name
 * bytes, then the stored size and the data offset. When the archive is encrypted the whole stream is
 * XORed with the key starting at position zero, and payloads use the same key starting at their own
 * file offset.
 */
async function readEmicIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; header: EmicHeader } | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const headerBytes = await source.readAt(0n, INDEX_OFFSET);
	if (!headerBytes.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const header = parseHeader(headerBytes);
	if (!header) return undefined;

	const indexSize = Number(source.size - BigInt(INDEX_OFFSET));
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	if (header.encrypted) xorWithKey(index, header.key, INDEX_OFFSET);
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < header.count; id += 1) {
		if (position + 4 > index.length) return undefined;
		const nameLength = index.readInt32LE(position);
		position += 4;
		if (nameLength <= 0 || nameLength > NAME_LIMIT) return undefined;
		if (position + nameLength + 8 > index.length) return undefined;
		const name = decodeCp932(index.subarray(position, position + nameLength));
		position += nameLength;
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(position + OFFSET_OFFSET));
		position += 8;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: header.encrypted,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return { entries, header };
}

/** GARbro `PacOpener.OpenEntry`: encrypted payloads cycle the key from their own offset. */
const emicEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.encrypted !== true)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	const key = entry.metadata?.key;
	if (typeof key === "string")
		xorWithKey(payload, Buffer.from(key, "latin1"), Number(entry.offset));
	return Readable.from([payload]);
};

export const emicFormat: ArchiveFormat = defineFixedArchive({
	descriptor: emicDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEmicIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readEmicIndex(source, sourcePath);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Emic PACK layout");
		const key = index.header.key.toString("latin1");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { key },
		}));
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: emicEntryOpener,
});
