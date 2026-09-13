// Format reference: GARBro ArcFormats/DenSDK/ArcDAF.cs, classes `Daf1Opener` and `Daf2Opener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream, inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
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

/** 'DAF1' and 'DAF2'; the second layout scrambles its words with a key byte from each of four offsets. */
const DAF1_SIGNATURE = Buffer.from("DAF1", "latin1");
const DAF2_SIGNATURE = Buffer.from("DAF2", "latin1");
const COUNT_FIELD = 8;
/** Both layouts place the same three fields at the same relative positions. */
const OFFSET_FIELD = 4;
const SIZE_FIELD = 8;
const UNPACKED_SIZE_FIELD = 0x0c;

/** DAF1: the index runs up to the payload area, and a record carries its own size. */
const DAF1_INDEX_OFFSET_FIELD = 4;
const DAF1_DATA_OFFSET_FIELD = 0x10;
const DAF1_RECORD_HEADER_SIZE = 0x18;
const DAF1_PACKED_FIELD = 0x14;

/** DAF2: the header is scrambled and the index sits behind a 0x30-byte prefix. */
const DAF2_KEY_OFFSETS = [0x20, 0x25, 0x2a, 0x2f];
const DAF2_PACKED_SIZE_FIELD = 0x10;
const DAF2_UNPACKED_SIZE_FIELD = 0x14;
const DAF2_IS_PACKED_FIELD = 0x18;
const DAF2_BASE_OFFSET_FIELD = 0x1c;
const DAF2_INDEX_START = 0x30;
const DAF2_RECORD_HEADER_SIZE = 0x30;
const DAF2_NAME_OFFSET = 0x34;
const DAF2_PACKED_FIELD = 0x30;
const DAF2_FLAG_PACKED = 1;

/** GARbro `Daf2Opener.TryOpen`'s key: one byte from each of four offsets, most significant first. */
function daf2Key(header: Buffer): number {
	const [first, second, third, fourth] = DAF2_KEY_OFFSETS;
	return (
		(((header[first ?? 0] ?? 0) << 24) |
			((header[second ?? 0] ?? 0) << 16) |
			((header[third ?? 0] ?? 0) << 8) |
			(header[fourth ?? 0] ?? 0)) >>>
		0
	);
}

/**
 * GARBro `Daf1Opener.TryOpen`. The index starts at 0x04 and ends where the payload area begins at 0x10,
 * and every record declares its own length, so records have no fixed stride. A record whose length is too
 * small, or which reaches past the reserved index area, rejects the archive.
 */
async function readDaf1Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(0x14)) return undefined;
	const header = await source.readAt(0n, 0x14);
	if (!header.subarray(0, 4).equals(DAF1_SIGNATURE)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(DAF1_INDEX_OFFSET_FIELD));
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DAF1_DATA_OFFSET_FIELD));
	if (indexOffset >= source.size) return undefined;
	if (dataOffset <= indexOffset || dataOffset > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(indexOffset, Number(dataOffset - indexOffset)),
	);

	const entries: FixedEntry[] = [];
	let cursor = 0;
	for (let id = 0; id < count; id += 1) {
		if (cursor + DAF1_RECORD_HEADER_SIZE > index.length) return undefined;
		const entrySize = index.readUInt32LE(cursor);
		if (entrySize <= DAF1_RECORD_HEADER_SIZE) return undefined;
		if (cursor + entrySize > index.length) return undefined;
		const name = decodeCStringField(
			index,
			cursor + DAF1_RECORD_HEADER_SIZE,
			entrySize - DAF1_RECORD_HEADER_SIZE,
		);
		const offset = BigInt(index.readUInt32LE(cursor + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(cursor + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(cursor + UNPACKED_SIZE_FIELD),
		);
		const compressed = index.readInt32LE(cursor + DAF1_PACKED_FIELD) !== 0;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: compressed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed,
			}),
		);
		cursor += entrySize;
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARBro `Daf2Opener.TryOpen`. The count, the index sizes and the payload base are exclusive-ored with a
 * key folded from four header bytes. The index itself is either zlib-packed at 0x30 or plain there, and
 * when it is packed the payload base becomes the end of that packed block rather than the stored field.
 * Records carry their own length and their names at +0x34.
 */
async function readDaf2Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DAF2_INDEX_START)) return undefined;
	const header = await source.readAt(0n, DAF2_INDEX_START);
	if (!header.subarray(0, 4).equals(DAF2_SIGNATURE)) return undefined;
	const key = daf2Key(header);
	const count = (header.readInt32LE(COUNT_FIELD) ^ key) | 0;
	if (!isSaneCount(count)) return undefined;
	const packedSize = (header.readUInt32LE(DAF2_PACKED_SIZE_FIELD) ^ key) >>> 0;
	const unpackedSize =
		(header.readUInt32LE(DAF2_UNPACKED_SIZE_FIELD) ^ key) >>> 0;
	const isPacked =
		header.readInt32LE(DAF2_IS_PACKED_FIELD) === DAF2_FLAG_PACKED;
	let baseOffset = BigInt(
		(header.readUInt32LE(DAF2_BASE_OFFSET_FIELD) ^ key) >>> 0,
	);

	let index: Buffer;
	if (isPacked) {
		if (BigInt(DAF2_INDEX_START + packedSize) > source.size) return undefined;
		index = Buffer.alloc(unpackedSize);
		const packed = await source.readAt(BigInt(DAF2_INDEX_START), packedSize);
		const unpacked = await inflateZlibBuffer(packed);
		unpacked.copy(index, 0, 0, Math.min(unpacked.length, index.length));
		baseOffset = BigInt(DAF2_INDEX_START + packedSize);
	} else {
		if (BigInt(DAF2_INDEX_START + unpackedSize) > source.size) return undefined;
		index = Buffer.from(
			await source.readAt(BigInt(DAF2_INDEX_START), unpackedSize),
		);
	}

	const entries: FixedEntry[] = [];
	let cursor = 0;
	for (let id = 0; id < count; id += 1) {
		if (cursor + DAF2_RECORD_HEADER_SIZE > index.length) return undefined;
		const entrySize = (index.readInt32LE(cursor) ^ key) | 0;
		if (entrySize < DAF2_RECORD_HEADER_SIZE) return undefined;
		if (entrySize > index.length - cursor) return undefined;
		const name = decodeCStringField(
			index,
			cursor + DAF2_NAME_OFFSET,
			Math.max(0, entrySize - DAF2_NAME_OFFSET),
		);
		// Offsets are relative to the payload base and wrap like the reference's 32-bit addition.
		const offset = BigInt.asUintN(
			32,
			baseOffset +
				BigInt((index.readUInt32LE(cursor + OFFSET_FIELD) ^ key) >>> 0),
		);
		const storedSize = BigInt(
			(index.readUInt32LE(cursor + SIZE_FIELD) ^ key) >>> 0,
		);
		const unpackedEntrySize = BigInt(
			(index.readUInt32LE(cursor + UNPACKED_SIZE_FIELD) ^ key) >>> 0,
		);
		const compressed = index.readInt32LE(cursor + DAF2_PACKED_FIELD) !== 0;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: compressed ? unpackedEntrySize : storedSize,
				packedSize: storedSize,
				compressed,
			}),
		);
		cursor += entrySize;
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARBro `Daf1Opener.OpenEntry`, which both layouts share: packed payloads are zlib streams. */
const dafEntryOpener: FixedEntryOpener = (source, entry) => {
	const stream = source.createReadStream(entry.offset, entry.packedSize);
	return Promise.resolve(
		entry.compressed ? createZlibInflateStream(stream) : stream,
	);
};

export const densdkDaf1Descriptor: FormatDescriptor = {
	id: "densdk-daf1",
	name: "DenSDK resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/DenSDK/ArcDAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const densdkDaf1Format: ArchiveFormat = defineFixedArchive({
	descriptor: densdkDaf1Descriptor,
	detection: { signatures: [{ bytes: DAF1_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDaf1Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDaf1Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DenSDK DAF1 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: dafEntryOpener,
});

export const densdkDaf2Descriptor: FormatDescriptor = {
	id: "densdk-daf2",
	name: "DenSDK resource archive",
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
			source: "ArcFormats/DenSDK/ArcDAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const densdkDaf2Format: ArchiveFormat = defineFixedArchive({
	descriptor: densdkDaf2Descriptor,
	detection: { signatures: [{ bytes: DAF2_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDaf2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDaf2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DenSDK DAF2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: dafEntryOpener,
});
