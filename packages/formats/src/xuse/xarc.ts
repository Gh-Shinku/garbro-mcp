// Format reference: GARbro ArcFormats/Xuse/ArcXARC.cs
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

const SIGNATURE = Buffer.from("XARC", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
/** The data area starts two bytes behind the end of the offset table. */
const FIRST_OFFSET_BIAS = 10;
const DATA_MARKER = Buffer.from("DATA", "ascii");
const NAME_LENGTH_OFFSET = 0x18;
const SIZE_OFFSET = 0x1c;
const NAME_OFFSET = 0x20;
/** GARbro advances the data offset past the name field plus a two-byte gap. */
const DATA_PREFIX = 0x22;

export const xarcDescriptor: FormatDescriptor = {
	id: "xuse-xarc",
	name: "Xuse resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Xuse/ArcXARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `XarcOpener.DecryptName`: every name byte is rotated left by four bits. */
function decryptName(bytes: Buffer): string {
	const name = Buffer.from(bytes);
	for (let position = 0; position < name.length; position += 1) {
		const value = name[position] ?? 0;
		name[position] = ((value << 4) | (value >> 4)) & 0xff;
	}
	return decodeCp932(name);
}

/**
 * GARbro `XarcOpener.TryOpen`. The index holds one 32-bit offset per record and must start exactly
 * `count * 4 + 10` bytes into the file. Every record begins with a `DATA` marker, followed by the
 * encrypted name length, the size, and the nibble-rotated name.
 */
async function readXarcIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * 4;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const firstOffset = BigInt(index.readUInt32LE(0));
	if (BigInt(indexSize + FIRST_OFFSET_BIAS) !== firstOffset) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = BigInt(index.readUInt32LE(id * 4));
		if (recordOffset + BigInt(NAME_OFFSET) > source.size) return undefined;
		const marker = await source.readAt(recordOffset, DATA_MARKER.length);
		if (!marker.equals(DATA_MARKER)) return undefined;
		const recordHeader = await source.readAt(
			recordOffset + BigInt(NAME_LENGTH_OFFSET),
			8,
		);
		const nameLength = recordHeader.readUInt16LE(0);
		const size = BigInt(recordHeader.readUInt32LE(4));
		if (recordOffset + BigInt(NAME_OFFSET + nameLength) > source.size)
			return undefined;
		const nameBytes = await source.readAt(
			recordOffset + BigInt(NAME_OFFSET),
			nameLength,
		);
		const offset = recordOffset + BigInt(DATA_PREFIX) + BigInt(nameLength);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(decryptName(nameBytes)),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const xarcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xarcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readXarcIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readXarcIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse XARC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
