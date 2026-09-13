// Format reference: GARBro ArcFormats/HCSystem/ArcPAK.cs, class `PakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
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

const SIGNATURE = Buffer.from("PACK", "ascii");
const COUNT_FIELD = 4;
/** The byte at 0x08 marks an index whose bytes are nibble-rotated. */
const ENCRYPTED_FIELD = 8;
const ENCRYPTED_VALUE = 1;
const INDEX_OFFSET = 0xc;
/** An ASCII record is a 0x20-byte name and three words; a Unicode one uses 0x40 name bytes. */
const NAME_SIZE_ASCII = 0x20;
const NAME_SIZE_UNICODE = 0x40;
const ENTRY_SIZE_ASCII = NAME_SIZE_ASCII + 0xc;
const ENTRY_SIZE_UNICODE = NAME_SIZE_UNICODE + 0xc;
const OFFSET_SIZE = 4;
const UNPACKED_SIZE_SIZE = 4;
const SIZE_SIZE = 4;
const LOW_NIBBLES = 0x0f0f0f0f;
const HIGH_NIBBLES = 0xf0f0f0f0;

export const hcsystemPakDescriptor: FormatDescriptor = {
	id: "hcsystem-pak",
	name: "hcsystem engine resource archive",
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
			source: "ArcFormats/HCSystem/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `Binary.RotByteL (b, 4)` swaps the two nibbles of every index byte. */
function rotateNibbles(byte: number): number {
	return ((byte >>> 4) | (byte << 4)) & 0xff;
}

/** The same rotation applied to a whole word, as the reference does for the first offset. */
function rotateWordNibbles(value: number): number {
	return (((value >>> 4) & LOW_NIBBLES) | ((value << 4) & HIGH_NIBBLES)) >>> 0;
}

/** Reads a UTF-16LE name up to a zero pair, bounded by the record's 0x40-byte name field. */
function decodeUnicodeName(index: Buffer, offset: number): string {
	let length = 0;
	while (length < NAME_SIZE_UNICODE) {
		if (index[offset + length] === 0 && index[offset + length + 1] === 0) break;
		length += 2;
	}
	return index.subarray(offset, offset + length).toString("utf16le");
}

interface HcsystemIndex {
	entries: FixedEntry[];
	encrypted: boolean;
	unicode: boolean;
}

/**
 * GARBro `PakOpener.TryOpen`. The `PACK` header holds the record count and a byte at 0x08 marking an
 * index whose bytes are nibble-rotated. The reference tries a 0x2C record size first and falls back
 * to a 0x4C Unicode variant, accepting a candidate only when the first record's offset equals the end
 * of the index. Records hold the unpacked size, the stored size and the payload offset behind the
 * name, and a non-zero stored size marks the entry as LZSS-packed.
 */
async function readHcsystemIndex(
	source: ByteSource,
): Promise<HcsystemIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const encrypted = (header[ENCRYPTED_FIELD] ?? 0) === ENCRYPTED_VALUE;

	let entrySize: number | undefined;
	let unicode = false;
	for (const candidate of [ENTRY_SIZE_ASCII, ENTRY_SIZE_UNICODE]) {
		const dataOffset = INDEX_OFFSET + candidate * count;
		// A file too small for the candidate cannot match it; the reference's bounds-checked view
		// would throw here, which fails the whole attempt.
		const probeOffset = INDEX_OFFSET + candidate - OFFSET_SIZE;
		if (BigInt(probeOffset + OFFSET_SIZE) > source.size) continue;
		const firstOffset = await source.readAt(BigInt(probeOffset), OFFSET_SIZE);
		const raw = firstOffset.readUInt32LE(0);
		const value = encrypted ? rotateWordNibbles(raw) : raw;
		if (value === dataOffset) {
			entrySize = candidate;
			unicode = candidate === ENTRY_SIZE_UNICODE;
			break;
		}
	}
	if (entrySize === undefined) return undefined;
	const indexLength = entrySize * count;
	if (BigInt(INDEX_OFFSET + indexLength) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexLength);
	if (encrypted) {
		for (let position = 0; position < index.length; position += 1)
			index[position] = rotateNibbles(index[position] ?? 0);
	}
	const nameSize = unicode ? NAME_SIZE_UNICODE : NAME_SIZE_ASCII;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * entrySize;
		const name = unicode
			? decodeUnicodeName(index, record)
			: decodeCStringField(index, record, nameSize);
		const unpackedSize = BigInt(index.readUInt32LE(record + nameSize));
		const sizeWord = BigInt(index.readUInt32LE(record + nameSize + 4));
		const offset = BigInt(index.readUInt32LE(record + nameSize + 8));
		const compressed = sizeWord !== 0n;
		const storedSize = compressed ? sizeWord : unpackedSize;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: unpackedSize,
			packedSize: storedSize,
			compressed,
		});
		// Packed entries are decoded to the end of the LZSS stream.
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return { entries, encrypted, unicode };
}

/**
 * GARBro `PakOpener.OpenEntry`. Packed entries are decoded with a default LZSS stream over the stored
 * extent; everything else is emitted verbatim.
 */
const hcsystemEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "hcsystem entry"),
	);
	return Readable.from([inflateLzssAll(stored)]);
};

export const hcsystemPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hcsystemPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHcsystemIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readHcsystemIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid hcsystem PAK layout");
		return {
			entries: index.entries,
			metadata: {
				entryCount: index.entries.length,
				encrypted: index.encrypted,
				unicode: index.unicode,
			},
		};
	},
	openEntry: hcsystemEntryOpener,
});
