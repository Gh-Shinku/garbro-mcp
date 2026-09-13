// Format reference: GARBro ArcFormats/Nexas/ArcTPF.cs, class `TpfOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decompressHuffman, inflateLzssAll } from "@garbro-mcp/codecs";
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

/** `Signature` reads as `TPF ` and `AsciiEqual (4, "FILE")`. */
const SIGNATURE = Buffer.from("TPF FILE", "ascii");
const HEADER_SIZE = 0x10;
const COUNT_OFFSET = 0x0c;
const INDEX_OFFSET = 0x10;
/** A record is a 0x20-byte name, a compression byte and three size words. */
const NAME_SIZE = 0x20;
const COMPRESSION_FIELD = 0x23;
const OFFSET_FIELD = 0x24;
const INTERIM_SIZE_FIELD = 0x28;
const UNPACKED_SIZE_FIELD = 0x2c;
const RECORD_SIZE = 0x30;
/** GARbro derives each stored size from the offset word of the following record. */
const NEXT_OFFSET_FIELD = RECORD_SIZE + OFFSET_FIELD;
/** The loop reads the following record's offset word, so one trailing slot must be readable. */
const INDEX_READ_SIZE = RECORD_SIZE + OFFSET_FIELD + 4;
const LZSS = 1;
const HUFFMAN_LZSS = 2;
/** GARbro asks the Huffman decoder for as much data as the stream holds, so unbounded output is
 * capped by the fact that every decoded symbol costs at least one input bit. */
const HUFFMAN_BIT_BOUND = 8;

export const gigaTpfDescriptor: FormatDescriptor = {
	id: "giga-tpf",
	name: "Giga resource archive",
	extensions: [],
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
			source: "ArcFormats/Nexas/ArcTPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `TpfOpener.TryOpen`. The `TPF FILE` header is followed at 0x10 by 0x30-byte records holding
 * a 0x20-byte name, a compression byte at 0x23, the payload offset, an intermediate size and the
 * unpacked size. Each stored size is the difference between its own offset and the offset word of the
 * next record, so the reference reads one trailing offset beyond the last record; the port requires
 * that slot to be inside the file. Records whose unpacked size is zero are dropped from the directory
 * without a placement check, matching the reference.
 */
async function readTpfIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const readSize = (count - 1) * RECORD_SIZE + INDEX_READ_SIZE;
	if (BigInt(INDEX_OFFSET + readSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), readSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const compression = index[record + COMPRESSION_FIELD] ?? 0;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const interimSize = BigInt(index.readUInt32LE(record + INTERIM_SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		if (unpackedSize === 0n) continue;
		// GARbro evaluates the subtraction in 32 bits before checking placement.
		const nextOffset = index.readUInt32LE(record + NEXT_OFFSET_FIELD);
		const storedSize = BigInt((nextOffset - Number(offset)) >>> 0);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const compressed = compression === LZSS || compression === HUFFMAN_LZSS;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: compressed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed,
			metadata: {
				compression,
				...(interimSize === 0n ? {} : { interimSize: interimSize.toString() }),
			},
		});
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARbro `TpfOpener.OpenEntry`: LZSS, optionally behind a Huffman stream. */
const gigaTpfEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Giga TPF entry"),
	);
	const compression = entry.metadata?.compression;
	if (compression !== HUFFMAN_LZSS)
		return Readable.from([inflateLzssAll(stored)]);
	const declared = BigInt(
		(typeof entry.metadata?.interimSize === "string"
			? entry.metadata.interimSize
			: "0") ?? "0",
	);
	const bound =
		declared > 0n
			? declared
			: BigInt(stored.length) * BigInt(HUFFMAN_BIT_BOUND);
	return Readable.from([
		inflateLzssAll(
			decompressHuffman(
				stored,
				bigintToBufferLength(bound, "Giga TPF Huffman output"),
			),
		),
	]);
};

export const gigaTpfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gigaTpfDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTpfIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readTpfIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Giga TPF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: gigaTpfEntryOpener,
});
