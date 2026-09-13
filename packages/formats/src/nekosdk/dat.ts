// Format reference: GARbro ArcFormats/NekoSDK/ArcDAT.cs, class `DatOpener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Record fields are masked with a 24-bit constant. */
const XOR_KEY = 0xcacaca;
const RECORD_SIZE = 0x8c;
const NAME_SIZE = 0x80;
const UNPACKED_SIZE_FIELD = 0x80;
const SIZE_FIELD = 0x84;
const OFFSET_FIELD = 0x88;
/** The word at 0x88 doubles as the first record's payload offset. */
const FIRST_OFFSET_FIELD = 0x88;

export const nekosdkDatDescriptor: FormatDescriptor = {
	id: "nekosdk-dat",
	name: "NekoSDK engine resource archive",
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
			source: "ArcFormats/NekoSDK/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Unmasks one record field; the reference XORs the raw 32-bit word with 0xCACACA. */
function unmask(value: number): bigint {
	return BigInt((value ^ XOR_KEY) >>> 0);
}

/**
 * GARbro `DatOpener.TryOpen`. The archive has no signature and is recognized by its `.dat` extension
 * alone. The word at 0x88 is the masked payload start; dividing it by the 0x8C record size yields the
 * record count plus one, and the reference subtracts that extra record before validating the count.
 * Every record holds a 0x80-byte CP932 name and three masked words: unpacked size, stored size and
 * payload offset. A non-zero unpacked size marks the entry as LZSS-packed.
 */
async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "dat") return undefined;
	if (source.size < BigInt(RECORD_SIZE)) return undefined;
	const firstWord = await source.readAt(0n, RECORD_SIZE);
	const firstOffset = unmask(firstWord.readUInt32LE(FIRST_OFFSET_FIELD));
	if (firstOffset <= 0n || firstOffset >= source.size) return undefined;
	if (firstOffset % BigInt(RECORD_SIZE) !== 0n) return undefined;
	const count = Number(firstOffset / BigInt(RECORD_SIZE)) - 1;
	if (!isSaneCount(count)) return undefined;

	const index = await source.readAt(0n, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		if (index[record] === 0) return undefined;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const unpackedSize = unmask(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const storedSize = unmask(index.readUInt32LE(record + SIZE_FIELD));
		const offset = unmask(index.readUInt32LE(record + OFFSET_FIELD));
		if (offset < firstOffset) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const compressed = unpackedSize !== 0n;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: compressed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed,
		});
		// The reference decodes packed entries to the end of the stored stream.
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARbro `DatOpener.OpenEntry`. Packed entries are decoded with a default LZSS stream over the stored
 * extent; everything else is emitted verbatim.
 */
export const nekosdkDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nekosdkDatDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "dat") return false;
		return (await readIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NekoSDK DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source, entry) {
		if (!entry.compressed)
			return source.createReadStream(entry.offset, entry.packedSize);
		const stored = await source.readAt(
			entry.offset,
			bigintToBufferLength(entry.packedSize, "NekoSDK entry"),
		);
		return Readable.from([inflateLzssAll(stored)]);
	},
});
