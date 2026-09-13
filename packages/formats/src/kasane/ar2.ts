// Format reference: GARbro Legacy/Kasane/ArcAR2.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
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

const EXTENSION = "ar2";
const COMPANION_EXTENSION = "idx";
const COUNT_OFFSET = 0;
/** Fixed part of a record: size, unpacked size, one unused word, name length, data offset. */
const RECORD_FIELDS_SIZE = 20;
const HEADER_SIZE = 0x10;
const NAME_LENGTH_OFFSET = 0x0c;
const NAME_LIMIT = 0x100;
const KEY = 0x55;
const KEY_MASK = 0x55555555;

export const kasaneAr2Descriptor: FormatDescriptor = {
	id: "kasane-ar2",
	name: "Kasane script engine resource archive",
	extensions: ["ar2"],
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
			source: "Legacy/Kasane/ArcAR2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface KasaneEntryInfo {
	offset: bigint;
	size: bigint;
	rawName: string;
}

/**
 * GARbro `Ar2Opener.TryOpen`. The `.ar2` file holds only payloads; a sibling `.idx` file holds a
 * record count followed by 0x18-byte records with the stored size, the declared unpacked size, one
 * unused word, the name length, the data offset, and the name. Name bytes are XORed with 0x55.
 */
async function readKasaneIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<KasaneEntryInfo[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companion = await readCompanionFile(
		sourcePath,
		`${baseName}.${COMPANION_EXTENSION}`,
	);
	if (!companion) return undefined;
	const count = companion.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(COUNT_OFFSET) > BigInt(companion.length)) return undefined;
	const entries: KasaneEntryInfo[] = [];
	// The count itself is consumed first, so records start behind it.
	let position = COUNT_OFFSET + 4;
	for (let id = 0; id < count; id += 1) {
		if (position + RECORD_FIELDS_SIZE > companion.length) return undefined;
		const size = companion.readUInt32LE(position);
		const nameLength = companion.readInt32LE(position + 12);
		const offset = companion.readUInt32LE(position + 16);
		position += RECORD_FIELDS_SIZE;
		if (nameLength < 0 || nameLength > NAME_LIMIT) return undefined;
		if (position + nameLength > companion.length) return undefined;
		const nameBytes = Buffer.from(
			companion.subarray(position, position + nameLength),
		);
		position += nameLength;
		for (let byte = 0; byte < nameBytes.length; byte += 1)
			nameBytes[byte] = (nameBytes[byte] ?? 0) ^ KEY;
		entries.push({
			offset: BigInt(offset),
			size: BigInt(size),
			rawName: decodeCp932(nameBytes),
		});
	}
	return entries;
}

async function readKasaneAr2(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const records = await readKasaneIndex(source, sourcePath);
	if (!records) return undefined;
	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		if (!checkPlacement(record.offset, record.size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(record.rawName),
				offset: record.offset,
				size: record.size,
				encrypted: true,
			}),
		);
	}
	return entries;
}

/**
 * GARbro `Ar2Opener.OpenEntry`: the payload sits behind a 0x10-byte header and an XOR-encrypted
 * name of its own, and is itself XORed with 0x55.
 */
const kasaneEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.offset + BigInt(HEADER_SIZE) > source.size)
		return source.createReadStream(entry.offset, 0n);
	const recordHeader = await source.readAt(entry.offset, HEADER_SIZE);
	const nameLength =
		(recordHeader.readUInt32LE(NAME_LENGTH_OFFSET) ^ KEY_MASK) >>> 0;
	const dataOffset = entry.offset + BigInt(HEADER_SIZE) + BigInt(nameLength);
	if (dataOffset > source.size)
		return source.createReadStream(entry.offset, 0n);
	const available = Number(
		entry.packedSize < source.size - dataOffset
			? entry.packedSize
			: source.size - dataOffset,
	);
	const payload = await source.readAt(dataOffset, available);
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = (payload[position] ?? 0) ^ KEY;
	return Readable.from([payload]);
};

export const kasaneAr2Format: ArchiveFormat = defineFixedArchive({
	descriptor: kasaneAr2Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readKasaneAr2(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readKasaneAr2(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Kasane AR2 layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: kasaneEntryOpener,
});
