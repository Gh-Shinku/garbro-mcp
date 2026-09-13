// Format reference: GARbro ArcFormats/Yox/ArcYOX.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
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
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** `Signature` is the three-byte `YOX` read as a 32-bit word, so the fourth byte is zero. */
const SIGNATURE = Buffer.from("YOX\0", "ascii");
const SIGNATURE_VALUE = 0x00584f59;
const INDEX_OFFSET_FIELD = 8;
const COUNT_OFFSET = 0x0c;
/** GARbro tries the narrow records first and falls back to wider ones. */
const RECORD_SIZES = [8, 0x10] as const;
const SIZE_FIELD = 4;
/** Packed payloads hide zlib data behind a 0x10-byte header. */
const PACKED_HEADER_SIZE = 0x10;
/** The packed flag GARbro tests with `0 != (2 & flags)`. */
const PACKED_FLAG = 2;

export const yoxDatDescriptor: FormatDescriptor = {
	id: "yox-dat",
	name: "YOX ADV+++ engine resource archive",
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
			source: "ArcFormats/Yox/ArcYOX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Reads one index candidate with the given stride, or returns `undefined` when a record fails. */
async function readIndexWithStride(
	source: ByteSource,
	indexOffset: number,
	count: number,
	stride: number,
): Promise<FixedEntry[] | undefined> {
	if (BigInt(indexOffset + count * stride) > source.size) return undefined;
	const index = await source.readAt(BigInt(indexOffset), count * stride);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * stride;
		const offset = BigInt(index.readUInt32LE(record));
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (storedSize === 0n) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			// GARbro names entries from their index position alone.
			path: String(id).padStart(5, "0"),
			offset,
			size: storedSize,
		});
		entries.push(entry);
	}
	return entries;
}

/** GARbro's manual stream `ReadUInt32`: past the end every missing byte reads as 0xFF. */
function readProbe(probe: Buffer, offset: number): number {
	let value = 0;
	for (let index = 0; index < 4; index += 1) {
		value |= ((probe[offset + index] ?? 0xff) & 0xff) << (8 * index);
	}
	return value >>> 0;
}

/**
 * GARbro `DatOpener.DetectFileTypes`. An entry whose own signature is `YOX` and whose following word
 * has bit 1 set hides zlib data behind a 0x10-byte header: the reference moves the entry past that
 * header and records the unpacked size. The port applies the same adjustment while reading the index
 * so listing and extraction agree. GARbro's resource-catalog type detection and the extension rename
 * it performs are not reproduced.
 */
async function probeEntries(
	source: ByteSource,
	entries: FixedEntry[],
): Promise<void> {
	for (const entry of entries) {
		if (entry.packedSize < 4n) continue;
		const probe = await source.readAt(
			entry.offset,
			Number(entry.packedSize < 0x10n ? entry.packedSize : 0x10n),
		);
		if (readProbe(probe, 0) !== SIGNATURE_VALUE) continue;
		const flags = readProbe(probe, 4);
		if ((flags & PACKED_FLAG) === 0) continue;
		if (entry.packedSize < BigInt(PACKED_HEADER_SIZE)) continue;
		const unpackedSize = BigInt(readProbe(probe, 8));
		entry.offset += BigInt(PACKED_HEADER_SIZE);
		entry.size = unpackedSize;
		entry.packedSize -= BigInt(PACKED_HEADER_SIZE);
		entry.compressed = true;
		entry.sizeKnown = false;
	}
}

/** GARbro `DatOpener.TryOpen`. The `YOX` header points at an index whose record width is either eight
 * or sixteen bytes; the reference tries the narrow stride first and retries with the wide one. */
async function readYoxIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_FIELD);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(indexOffset) >= source.size) return undefined;

	let entries: FixedEntry[] | undefined;
	for (const stride of RECORD_SIZES) {
		entries = await readIndexWithStride(source, indexOffset, count, stride);
		if (entries) break;
	}
	if (!entries) return undefined;
	await probeEntries(source, entries);
	return entries;
}

/** GARbro `DatOpener.OpenEntry`: packed payloads are zlib streams. */
const yoxEntryOpener: FixedEntryOpener = async (source, entry) => {
	const input = source.createReadStream(entry.offset, entry.packedSize);
	if (!entry.compressed) return input;
	return createZlibInflateStream(input);
};

export const yoxDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yoxDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readYoxIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readYoxIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YOX DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: yoxEntryOpener,
});
