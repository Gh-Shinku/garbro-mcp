// Format reference: GARBro Legacy/Rain/ArcBIN.cs, class `BinOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { writeBmp24 } from "../shared/bmp.js";
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
	const cgd = entry.path.toLowerCase().endsWith(".cgd");
	if (!entry.compressed) {
		if (!cgd) return source.createReadStream(entry.offset, entry.packedSize);
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const picture = readCgdPicture(stored);
		if (!picture) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`The picture ${entry.path} stands of no picture of this engine`,
			);
		}
		return Readable.from([picture]);
	}
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(
			entry.packedSize - BigInt(PACKED_HEADER_SIZE),
			"LZSS entry",
		),
	);
	const unpacked = inflateLzssAll(stored, {
		frameFill: LZSS_FRAME_FILL,
		frameInitPosition: LZSS_FRAME_INIT_POSITION,
	});
	if (!cgd) return Readable.from([unpacked]);
	const picture = readCgdPicture(unpacked);
	if (!picture) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of no picture of this engine`,
		);
	}
	return Readable.from([picture]);
}

/** `CgdImageDecoder`: the head of a picture of this engine, of eleven words. */
const CGD_HEADER_SIZE = 0x2c;
/** The words of the head: the count of the places of the picture and the places of its colour maps. */
const CGD_DATA_LENGTH_FIELD = 0x00;
const CGD_WIDTH_FIELD = 0x04;
const CGD_HEIGHT_FIELD = 0x08;
const CGD_BLOCKS_FIELD = 0x20;
const CGD_RGB16_FIELD = 0x24;
const CGD_RGB24_FIELD = 0x28;
/** The block a picture of this engine stands of, of eight pixels to a row. */
const CGD_BLOCK_SIZE = 8;
/** The counts of the places of a row of a block, of the word before it. */
const CGD_ROW_LENGTHS: Record<number, number> = { 0: 0, 1: 24, 2: 32, 3: 32 };

/**
 * `CgdImageDecoder.UnpackBlocks`: the blocks of a picture stand of a table of two words to a block, and the
 * places of a block stand behind the colour maps; a word of a block of no places of a colour stands of a run of
 * blocks whose places stand behind it.
 */
function unpackCgdBlocks(
	data: Buffer,
	blocks: number[],
	width: number,
	height: number,
	stride: number,
): Buffer {
	const output = Buffer.alloc(stride * height, 0x00);
	const blocksWide = Math.trunc(width / CGD_BLOCK_SIZE);
	const blocksHigh = Math.trunc(height / CGD_BLOCK_SIZE);
	let at = 0;
	let cursor = 0;
	for (let row = 0; row < blocksHigh; row += 1) {
		let dst = row * CGD_BLOCK_SIZE * stride;
		for (let x = 0; x < blocksWide; ) {
			const word = blocks[at] ?? 0;
			const count = (word >> 8) & 0xff;
			const rowLength = CGD_ROW_LENGTHS[word >> 16] ?? 0;
			if (count <= 0) break;
			for (let block = 0; block < count; block += 1) {
				if (word >> 16 !== 0) {
					at += 2;
					data.copy(output, dst, cursor, cursor + rowLength);
					cursor += rowLength;
					dst += rowLength;
				} else {
					at += 2;
				}
			}
			if (rowLength !== 0) {
				const places = 7 * count * rowLength;
				data.copy(output, dst, cursor, cursor + places);
				cursor += places;
				dst += places;
			}
			x += count;
		}
	}
	return output;
}

/**
 * `CgdImageDecoder`: the head of a picture of this engine stands at the front of the payload, of a count of the
 * places of the picture, its width and height and the places of its two colour maps. Where the head names a table
 * of blocks, the places of the picture stand of that table and the places behind the colour maps; where it names
 * none, the places stand behind the colour maps as they are. A picture of this engine stands of three places of a
 * colour to a pixel, of the rows of the file as they are, which a bitmap records the same way.
 */
function readCgdPicture(data: Buffer): Buffer | undefined {
	if (data.length < CGD_HEADER_SIZE) return undefined;
	const dataLength = data.readInt32LE(CGD_DATA_LENGTH_FIELD);
	const width = data.readUInt32LE(CGD_WIDTH_FIELD);
	const height = data.readUInt32LE(CGD_HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const blocksOffset = data.readInt32LE(CGD_BLOCKS_FIELD);
	const rgb16Offset = data.readInt32LE(CGD_RGB16_FIELD);
	const rgb24Offset = data.readInt32LE(CGD_RGB24_FIELD);
	const stride = width * 3;
	const places = stride * height;
	let pixels: Buffer;
	if (0 !== blocksOffset) {
		// The table stands of two words to a block, and the places of the picture stand behind the colour maps.
		const blocks =
			Math.trunc(width / CGD_BLOCK_SIZE) * Math.trunc(height / CGD_BLOCK_SIZE);
		if (CGD_HEADER_SIZE + blocks * 8 > data.length) return undefined;
		const table: number[] = [];
		for (let block = 0; block < blocks * 2; block += 1) {
			table.push(data.readInt32LE(CGD_HEADER_SIZE + block * 4));
		}
		const maps = Math.max(rgb24Offset - rgb16Offset, 0);
		const start = CGD_HEADER_SIZE + blocks * 8 + maps;
		pixels = unpackCgdBlocks(
			data.subarray(start),
			table,
			width,
			height,
			stride,
		);
	} else {
		// The places of the picture stand behind the colour maps, of the count the head names for them.
		const maps = Math.max(rgb24Offset - rgb16Offset, 0);
		const start = CGD_HEADER_SIZE + maps;
		const length = Math.max(Math.min(dataLength - rgb24Offset, places), 0);
		pixels = Buffer.alloc(places, 0x00);
		data.copy(pixels, 0, start, start + length);
	}
	return writeBmp24(width, height, pixels);
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
