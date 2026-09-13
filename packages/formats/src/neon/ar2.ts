// Format reference: GARbro Legacy/Neon/ArcAR2.cs
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
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const KEY = 0x55;
/** The repeated key word that GARbro expects at offset 8. */
const KEY_MASK = 0x55555555;
const HEADER_SIZE = 0x10;
const SIZE_OFFSET = 0;
const NAME_LENGTH_OFFSET = 0x0c;
const NAME_LIMIT = 0x100;

export const neonAr2Descriptor: FormatDescriptor = {
	id: "neon-ar2",
	name: "Neon resource archive",
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
			source: "Legacy/Neon/ArcAR2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Ar2Opener.TryOpen`. The whole archive is XORed with 0x55. Records are a 0x10-byte header
 * with the size and the name length, followed by the name and the payload. A record whose size and
 * name length are both zero is skipped.
 */
async function readNeonIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.readUInt32LE(8) !== KEY_MASK) return undefined;
	if (header.readUInt32LE(0) !== header.readUInt32LE(4)) return undefined;
	if ((header.readUInt32LE(0x0c) ^ KEY_MASK) >>> 0 > NAME_LIMIT)
		return undefined;
	const entries: FixedEntry[] = [];
	let position = 0n;
	while (position + BigInt(HEADER_SIZE) <= source.size) {
		const record = Buffer.from(await source.readAt(position, HEADER_SIZE));
		for (let byte = 0; byte < record.length; byte += 1)
			record[byte] = (record[byte] ?? 0) ^ KEY;
		const size = BigInt(record.readUInt32LE(SIZE_OFFSET));
		const nameLength = record.readInt32LE(NAME_LENGTH_OFFSET);
		position += BigInt(HEADER_SIZE);
		if (size === 0n && nameLength === 0) continue;
		if (nameLength <= 0 || nameLength > NAME_LIMIT) return undefined;
		if (position + BigInt(nameLength) > source.size) return undefined;
		const nameBytes = Buffer.from(await source.readAt(position, nameLength));
		for (let byte = 0; byte < nameBytes.length; byte += 1)
			nameBytes[byte] = (nameBytes[byte] ?? 0) ^ KEY;
		const name = decodeCp932(nameBytes);
		position += BigInt(nameLength);
		if (!checkPlacement(position, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset: position,
				size,
				encrypted: true,
			}),
		);
		position += size;
	}
	return entries;
}

/** GARbro `Ar2Opener.OpenEntry`: payloads are XORed with the archive key. */
const neonEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = (payload[position] ?? 0) ^ KEY;
	return Readable.from([payload]);
};

export const neonAr2Format: ArchiveFormat = defineFixedArchive({
	descriptor: neonAr2Descriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readNeonIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readNeonIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Neon AR2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: neonEntryOpener,
});
