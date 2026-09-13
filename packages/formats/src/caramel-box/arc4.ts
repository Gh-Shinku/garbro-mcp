// Format reference: GARbro "ArcFormats/CaramelBox/ArcARC4.cs", classes `Arc4Opener`, `Arc4Entry`,
// `TzCompression` and `Arc4Stream`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
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
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ARC4", "ascii");
const VERSION = 0x010000;
const VERSION_OFFSET = 4;
const INDEX_LENGTH_OFFSET = 8;
const ALIGNMENT_OFFSET = 0xc;
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET_OFFSET = 0x14;
const NAMES_OFFSET_OFFSET = 0x1c;
const SEGMENT_TABLE_OFFSET = 0x24;
const BASE_OFFSET_OFFSET = 0x2c;
/** Compressed indexes start with a leading signature that is read and discarded. */
const INDEX_MARKER = Buffer.from("tZ", "ascii");
/** A record holds a name position, a name length, a chunk count and a segment offset. */
const RECORD_SIZE = 8;
const NAME_POSITION_FIELD = 0;
const NAME_LENGTH_FIELD = 3;
const CHUNK_COUNT_FIELD = 4;
const OFFSET_FIELD = 5;
const SEGMENT_ENTRY_SIZE = 3;
/** Segment headers are sixteen bytes long and hold the big endian stored size at four. */
const SEGMENT_HEADER_SIZE = 0x10;
const SEGMENT_SIZE_FIELD = 4;
/** TzCompression markers, read as little endian 16 bit values. */
const TZ_STORED = 0x7453; // 'St'
const TZ_PACKED = 0x745a; // 'Zt'
const TZ_HEADER_SIZE = 6;
const TZ_BLOCK_HEADER_SIZE = 8;
const TZ_KEY_FACTOR = 0x1465d9;
const TZ_KEY_ADDEND = 0x0fb5;
const TZ_BUFFER_SIZE = 0x10000;

/** GARbro `TzCompression.DecryptBlock`: a running key subtracts from every little endian word. */
function decryptTzBlock(
	data: Buffer,
	offset: number,
	count: number,
	initialKey: number,
): void {
	let key = initialKey >>> 0;
	for (let index = 0; index + 2 <= count; index += 2) {
		key = (key * TZ_KEY_FACTOR + TZ_KEY_ADDEND) >>> 0;
		const position = offset + index;
		const word = data.readUInt16LE(position);
		data.writeUInt16LE((word - (key >>> 16)) & 0xffff, position);
	}
}

/** GARbro `TzCompression.UnpackBlock`: literals and three widths of back reference. */
function unpackTzBlock(
	input: Buffer,
	source: number,
	inputSize: number,
	output: Buffer,
	destination: number,
	outputSize: number,
): void {
	const sourceEnd = Math.min(source + inputSize, input.length);
	const outputEnd = Math.min(destination + outputSize, output.length);
	let src = source;
	let dst = destination;
	while (src < sourceEnd && dst < outputEnd) {
		let control = input[src] ?? 0;
		src += 1;
		if (control === 0) break;
		if ((control & 0x80) !== 0) {
			let count: number;
			let offset: number;
			if ((control & 0x40) !== 0) {
				if ((control & 0x20) !== 0) {
					control =
						(((control << 8) | (input[src] ?? 0)) << 8) | (input[src + 1] ?? 0);
					src += 2;
					count = (control & 0x3f) + 4;
					offset = (control >> 6) & 0x7fff;
				} else {
					control = (control << 8) | (input[src] ?? 0);
					src += 1;
					count = (control & 7) + 3;
					offset = (control >> 3) & 0x3ff;
				}
			} else {
				count = (control & 3) + 2;
				offset = (control >> 2) & 0xf;
			}
			offset += 1;
			for (let i = 0; i < count && dst < outputEnd; i += 1) {
				output[dst] = output[dst - offset] ?? 0;
				dst += 1;
			}
		} else {
			const length = Math.min(control, outputEnd - dst, sourceEnd - src);
			input.copy(output, dst, src, src + length);
			src += length;
			dst += length;
		}
	}
}

/** GARbro `TzCompression.Unpack`: a size header followed by stored and packed blocks. */
function unpackTz(data: Buffer): Buffer {
	if (data.length < TZ_HEADER_SIZE) return Buffer.alloc(0);
	const unpackedSize = data.readUInt32LE(2);
	const output = Buffer.alloc(unpackedSize);
	let position = TZ_HEADER_SIZE;
	let destination = 0;
	const block = Buffer.alloc(TZ_BUFFER_SIZE);
	while (destination < output.length) {
		if (position + TZ_BLOCK_HEADER_SIZE > data.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated compressed block");
		const signature = data.readUInt16LE(position);
		const blockSize = data.readUInt16LE(position + 2);
		const unpackedBlockSize = data.readUInt16LE(position + 4);
		const key = data.readUInt16LE(position + 6);
		position += TZ_BLOCK_HEADER_SIZE;
		if (unpackedBlockSize === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid compressed block");
		if (position + blockSize > data.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated compressed block");
		data.copy(block, 0, position, position + blockSize);
		position += blockSize;
		decryptTzBlock(block, 0, blockSize, key);
		if (signature === TZ_STORED) {
			block.copy(output, destination, 0, unpackedBlockSize);
		} else if (signature === TZ_PACKED) {
			unpackTzBlock(
				block,
				0,
				blockSize,
				output,
				destination,
				unpackedBlockSize,
			);
		} else {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid compressed block marker",
			);
		}
		destination += unpackedBlockSize;
	}
	return output;
}

/** GARbro `Arc4Opener.ReadInt24`: a big endian 24 bit value. */
function readInt24(data: Buffer, position: number): number {
	return (
		(((data[position] ?? 0) << 16) |
			((data[position + 1] ?? 0) << 8) |
			(data[position + 2] ?? 0)) >>>
		0
	);
}

interface Arc4Segment {
	offset: bigint;
	size: number;
}

interface Arc4ParsedEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: number;
	packed: boolean;
	unpackedSize: number;
	segments: Arc4Segment[];
}

/** GARbro `Arc4Opener.TryOpen`: a compressed index names entries and their segment tables. */
async function readArc4Index(
	source: ByteSource,
): Promise<Arc4ParsedEntry[] | undefined> {
	if (source.size < BigInt(0x30)) return undefined;
	const head = Buffer.from(await source.readAt(0n, 0x30));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (head.readUInt32LE(VERSION_OFFSET) !== VERSION) return undefined;
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexLength = head.readUInt32LE(INDEX_LENGTH_OFFSET);
	const alignment = head.readUInt32LE(ALIGNMENT_OFFSET);
	const indexOffset = head.readInt32LE(INDEX_OFFSET_OFFSET);
	const namesOffset = head.readInt32LE(NAMES_OFFSET_OFFSET) - indexOffset;
	const segmentTable = head.readInt32LE(SEGMENT_TABLE_OFFSET) - indexOffset;
	const baseOffset = head.readUInt32LE(BASE_OFFSET_OFFSET);
	if (
		alignment === 0 ||
		indexOffset <= 0 ||
		namesOffset <= 0 ||
		segmentTable <= 0
	)
		return undefined;
	if (BigInt(indexOffset) + BigInt(indexLength) > source.size) return undefined;
	const compressed = Buffer.from(
		await source.readAt(BigInt(indexOffset), indexLength),
	);
	if (!compressed.subarray(0, 2).equals(INDEX_MARKER)) return undefined;
	const index = unpackTz(compressed);
	const entries: Arc4ParsedEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		if (position + RECORD_SIZE > index.length) return undefined;
		const namePosition = readInt24(index, position + NAME_POSITION_FIELD) * 2;
		const nameLength = index[position + NAME_LENGTH_FIELD] ?? 0;
		const chunkCount = index[position + CHUNK_COUNT_FIELD] ?? 0;
		const offset = readInt24(index, position + OFFSET_FIELD);
		const name = decodeCStringField(
			index,
			namesOffset + namePosition,
			nameLength,
		);
		const segments: Arc4Segment[] = [];
		if (chunkCount > 1) {
			let segmentPosition = segmentTable + SEGMENT_ENTRY_SIZE * offset;
			for (let j = 0; j < chunkCount; j += 1) {
				if (segmentPosition + SEGMENT_ENTRY_SIZE > index.length)
					return undefined;
				const start =
					(BigInt(readInt24(index, segmentPosition)) + BigInt(baseOffset)) *
					BigInt(alignment);
				segments.push({ offset: start, size: 0 });
				segmentPosition += SEGMENT_ENTRY_SIZE;
			}
		} else {
			segments.push({
				offset: (BigInt(offset) + BigInt(baseOffset)) * BigInt(alignment),
				size: 0,
			});
		}
		if (segments.length === 0) return undefined;
		entries.push({
			...normalizeEntryPath(name),
			offset: segments[0]?.offset ?? 0n,
			size: 0,
			packed: false,
			unpackedSize: 0,
			segments,
		});
	}
	for (const entry of entries) {
		let total = 0;
		for (const segment of entry.segments) {
			if (segment.offset + BigInt(SEGMENT_HEADER_SIZE) > source.size)
				return undefined;
			const header = Buffer.from(
				await source.readAt(segment.offset, SEGMENT_HEADER_SIZE),
			);
			segment.size = header.readUInt32BE(SEGMENT_SIZE_FIELD);
			total += segment.size;
		}
		const first = entry.segments[0];
		if (!first) return undefined;
		const payload = first.offset + BigInt(SEGMENT_HEADER_SIZE);
		const packed = await isTzPacked(source, payload);
		entry.offset = payload;
		entry.size = total;
		entry.packed = packed;
		if (packed) {
			if (payload + 6n > source.size) return undefined;
			const header = Buffer.from(await source.readAt(payload, 6));
			entry.unpackedSize = header.readUInt32LE(2);
		} else {
			entry.unpackedSize = total;
		}
		if (!checkPlacement(payload, BigInt(total), source.size)) return undefined;
	}
	return entries;
}

/** GARbro checks the first segment for the `tZ` marker of a compressed entry. */
async function isTzPacked(
	source: ByteSource,
	offset: bigint,
): Promise<boolean> {
	if (offset + 2n > source.size) return false;
	const marker = Buffer.from(await source.readAt(offset, 2));
	return marker.equals(INDEX_MARKER);
}

export const caramelBoxArc4Descriptor: FormatDescriptor = {
	id: "caramel-box-arc4",
	name: "Caramel BOX resource archive",
	extensions: ["bin", "dat"],
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
			source: "ArcFormats/CaramelBox/ArcARC4.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const caramelBoxArc4Format: ArchiveFormat = defineFixedArchive({
	descriptor: caramelBoxArc4Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArc4Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readArc4Index(source);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Caramel BOX layout");
		const entries: FixedEntry[] = parsed.map((entry, index) => {
			const stored = entry.segments.reduce(
				(sum, segment) => sum + segment.size,
				0,
			);
			const created = createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: entry.offset,
				size: BigInt(entry.unpackedSize),
				packedSize: BigInt(stored),
				compressed: entry.packed,
				metadata: {
					packed: entry.packed,
					segments: entry.segments.map((segment) => ({
						offset: segment.offset.toString(),
						size: segment.size,
					})),
				} as Record<string, unknown>,
			});
			return entry.packed ? { ...created, sizeKnown: false } : created;
		});
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as {
			packed?: boolean;
			segments?: { offset: string; size: number }[];
		};
		const segments = metadata.segments ?? [];
		const chunks: Buffer[] = [];
		for (const segment of segments) {
			const offset = BigInt(segment.offset) + BigInt(SEGMENT_HEADER_SIZE);
			if (segment.size === 0) continue;
			chunks.push(Buffer.from(await source.readAt(offset, segment.size)));
		}
		const data = Buffer.concat(chunks);
		if (!metadata.packed) return Readable.from([data]);
		return Readable.from([unpackTz(data)]);
	},
});
