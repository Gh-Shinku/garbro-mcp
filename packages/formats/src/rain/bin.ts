// Format reference: GARBro Legacy/Rain/ArcBIN.cs, class `BinOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** GARbro only opens files whose name is `pack` followed by three letters, as the entry extension. */
const PACK_NAME = /^pack(.{3})\.bin$/i;
const COUNT_OFFSET = 0;
/** The high bit of the count is read as a compression flag, and the rest is the entry count. */
const COUNT_FLAG = 0x80000000;
const INDEX_OFFSET = 4;
const RECORD_SIZE = 12;
/** Entry numbers are five digits and may not exceed this value. */
const MAX_NUMBER = 0xffffff;
const NUMBER_DIGITS = 5;
/** Compressed payloads start with this marker, followed by twelve bytes before the LZSS stream. */
const PACKED_MARKER = Buffer.from("SZDD", "ascii");
const PACKED_HEADER_SIZE = 12;
/** GARbro overrides both the ring fill and the initial ring position for this format. */
const LZSS_FRAME_FILL = 0x20;
const LZSS_FRAME_INIT_POSITION = 0xff0;

export const rainBinDescriptor: FormatDescriptor = {
	id: "rain-bin",
	name: "Rain Software resource archive",
	extensions: ["bin"],
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
			source: "Legacy/Rain/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `BinOpener.TryOpen`. Detection depends on the file name as much as on the contents: only
 * `pack<xxx>.bin` matches, and the three captured characters become the extension of every entry name,
 * which is built as a five-digit number plus that extension. The count at 0 carries a compression flag
 * in its high bit which the index reader masks off — GARbro computes that flag but never consults it,
 * because compression is decided per entry from the payload's `SZDD` marker instead.
 *
 * Records are twelve bytes wide: the entry number, which must be unique and at most 0xFFFFFF, then the
 * data offset, which must land behind the index, and the size.
 *
 * `BinOpener.OpenEntry` decodes `SZDD` payloads as LZSS streams, skipping twelve bytes, with a ring
 * fill of 0x20 and an initial position of 0xFF0 rather than the defaults. The port passes both
 * overrides to the shared decoder and marks those entries as having an inexact size.
 */
async function readRainIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const match = PACK_NAME.exec(basename(sourcePath));
	if (!match) return undefined;
	const extension = match[1] ?? "";
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const countField = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	const count = countField & ~COUNT_FLAG;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	if (dataOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	const seen = new Set<number>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const number = index.readUInt32LE(record);
		if (number > MAX_NUMBER || seen.has(number)) return undefined;
		seen.add(number);
		const offset = BigInt(index.readUInt32LE(record + 4));
		const storedSize = BigInt(index.readUInt32LE(record + 8));
		if (offset < dataOffset) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		let packed = false;
		let unpackedSize = storedSize;
		if (storedSize > BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				packed = true;
				// A SZDD stream stores its unpacked length at +8, which GARbro does not read.
				unpackedSize = BigInt(probe.readUInt32LE(8));
			}
		}
		const name = `${String(number).padStart(NUMBER_DIGITS, "0")}.${extension}`;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARBro `BinOpener.OpenEntry`: `SZDD` payloads use LZSS with an overridden fill and ring position. */
async function openRainEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(
			entry.packedSize - BigInt(PACKED_HEADER_SIZE),
			"LZSS entry",
		),
	);
	return Readable.from([
		inflateLzssAll(stored, {
			frameFill: LZSS_FRAME_FILL,
			frameInitPosition: LZSS_FRAME_INIT_POSITION,
		}),
	]);
}

export const rainBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rainBinDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readRainIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readRainIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Rain BIN archive layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openRainEntry,
});
