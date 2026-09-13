// Format reference: GARbro ArcFormats/Lambda/ArcLAX.cs, classes `LaxOpener` and `LaxStream`,
// with the huffman tree from ArcFormats/HuffmanCompression.cs (`HuffmanDecompressor`).
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { decompressHuffman } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive opens with its own marker and keeps a trailer with the index behind it. */
const FILE_MARKER = Buffer.from("$LapH__", "latin1");
const TRAILER_SIZE = 0x28;
const TRAILER_MARKER = Buffer.from("$LapI__", "latin1");
const TRAILER_COUNT_FIELD = 8;
const TRAILER_INDEX_OFFSET_FIELD = 0xc;
const TRAILER_UNPACKED_SIZE_FIELD = 0x10;
const TRAILER_PACKED_SIZE_FIELD = 0x14;
/** Index records are fixed size and start with their own marker. */
const RECORD_SIZE = 0x128;
const RECORD_MARKER = Buffer.from("$LapF__", "latin1");
const RECORD_UNPACKED_SIZE_FIELD = 0x10;
const RECORD_SIZE_FIELD = 0x14;
const RECORD_OFFSET_FIELD = 0x18;
const RECORD_NAME_FIELD = 0x24;
const RECORD_NAME_SIZE = 0x104;
/** Payload offsets are relative to the trailer. */
const DATA_OFFSET = 8;
const IMAGE_EXTENSIONS = [".bmx", ".b32"];

/** The compressed stream is a chain of chunks. */
const CHUNK_HEADER_SIZE = 10;
const CHUNK_MARKER = Buffer.from("_AF", "latin1");
const CHUNK_METHOD_FIELD = 3;
const CHUNK_SIZE_FIELD = 4;
const CHUNK_FINAL_SIZE_FIELD = 6;
const CHUNK_UNPACKED_SIZE_FIELD = 8;
const METHOD_LZSS = 0x31;
const METHOD_HUFFMAN = 0x32;
/** The lzss frame is 0x1000 bytes wide and starts nine bytes before its end. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_INIT_POSITION = 0xfee;
const LZ_INITIAL_BITS = 2;
const LZ_CONTROL_BASE = 0x100;

/** `LaxStream.LzssUnpack`: a control bit decides between a literal and a two byte back reference. */
function unpackLaxLzss(input: Buffer, unpackedSize: number): Buffer {
	const frame = Buffer.alloc(FRAME_SIZE);
	const output = Buffer.alloc(unpackedSize);
	let framePosition = FRAME_INIT_POSITION;
	let target = 0;
	let position = 0;
	let bits = LZ_INITIAL_BITS;
	while (target < unpackedSize) {
		bits >>= 1;
		if (bits === 1) {
			if (position >= input.length) break;
			bits = (input[position++] ?? 0) | LZ_CONTROL_BASE;
		}
		if (position >= input.length) break;
		const low = input[position++] ?? 0;
		if ((bits & 1) !== 0) {
			output[target++] = low;
			frame[framePosition++ & FRAME_MASK] = low;
			continue;
		}
		if (position >= input.length) break;
		const high = input[position++] ?? 0;
		let offset = ((high & 0xf0) << 4) | low;
		let count = Math.min(3 + (high & 0x0f), unpackedSize - target);
		while (count > 0) {
			const value = frame[offset++ & FRAME_MASK] ?? 0;
			output[target++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
			count -= 1;
		}
	}
	return output.subarray(0, target);
}

/**
 * `LaxStream`: every chunk repeats a ten byte header with a method, its own size and the size it unpacks
 * to. A chunk that announces a final size is doubly compressed, which the reference refuses as well.
 */
export function inflateLaxStream(
	input: Buffer,
	expectedLength?: number,
): Buffer {
	const parts: Buffer[] = [];
	let total = 0;
	let position = 0;
	const limit = expectedLength ?? Number.POSITIVE_INFINITY;
	while (position + CHUNK_HEADER_SIZE <= input.length && total < limit) {
		const header = input.subarray(position, position + CHUNK_HEADER_SIZE);
		if (!header.subarray(0, CHUNK_MARKER.length).equals(CHUNK_MARKER))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LAX chunk marker");
		const chunkSize = header.readUInt16LE(CHUNK_SIZE_FIELD);
		const finalSize = header.readUInt16LE(CHUNK_FINAL_SIZE_FIELD);
		const unpackedSize = header.readUInt16LE(CHUNK_UNPACKED_SIZE_FIELD);
		if (finalSize !== 0)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Double compressed LAX chunks are not supported",
			);
		if (chunkSize <= CHUNK_HEADER_SIZE) break;
		const body = input.subarray(
			position + CHUNK_HEADER_SIZE,
			Math.min(position + chunkSize, input.length),
		);
		const method = header[CHUNK_METHOD_FIELD] ?? 0;
		if (method === METHOD_LZSS) {
			parts.push(unpackLaxLzss(body, unpackedSize));
		} else if (method === METHOD_HUFFMAN) {
			parts.push(decompressHuffman(body, unpackedSize));
		} else {
			parts.push(body.subarray(0, unpackedSize));
		}
		total += parts[parts.length - 1]?.length ?? 0;
		position += chunkSize;
	}
	const output = Buffer.concat(parts);
	return expectedLength === undefined
		? output
		: output.subarray(0, expectedLength);
}

interface LaxEntry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
}

/**
 * GARbro `LaxOpener.TryOpen`. The trailer behind the file names the compressed index, which is itself a LAX
 * stream. Every index record describes one payload: its unpacked size, its stored size, its offset and its
 * name.
 */
async function readLaxIndex(
	source: ByteSource,
): Promise<LaxEntry[] | undefined> {
	const marker = Buffer.from(await source.readAt(0n, FILE_MARKER.length));
	if (!marker.equals(FILE_MARKER)) return undefined;
	if (source.size < BigInt(TRAILER_SIZE)) return undefined;
	const trailerOffset = source.size - BigInt(TRAILER_SIZE);
	const trailer = Buffer.from(await source.readAt(trailerOffset, TRAILER_SIZE));
	if (!trailer.subarray(0, TRAILER_MARKER.length).equals(TRAILER_MARKER))
		return undefined;
	const count = trailer.readInt32LE(TRAILER_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(trailer.readUInt32LE(TRAILER_INDEX_OFFSET_FIELD));
	const unpackedSize = BigInt(
		trailer.readUInt32LE(TRAILER_UNPACKED_SIZE_FIELD),
	);
	const packedSize = BigInt(trailer.readUInt32LE(TRAILER_PACKED_SIZE_FIELD));
	if (unpackedSize > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
	if (!checkPlacement(indexOffset, packedSize, source.size)) return undefined;
	const packed = Buffer.from(
		await source.readAt(indexOffset, Number(packedSize)),
	);
	let index: Buffer;
	try {
		index = inflateLaxStream(packed, Number(unpackedSize));
	} catch {
		return undefined;
	}
	const entries: LaxEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * RECORD_SIZE;
		if (position + RECORD_SIZE > index.length) return undefined;
		if (
			!index
				.subarray(position, position + RECORD_MARKER.length)
				.equals(RECORD_MARKER)
		)
			return undefined;
		const nameField = index.subarray(
			position + RECORD_NAME_FIELD,
			position + RECORD_NAME_FIELD + RECORD_NAME_SIZE,
		);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		const offset =
			BigInt(index.readUInt32LE(position + RECORD_OFFSET_FIELD)) +
			BigInt(DATA_OFFSET);
		const size = BigInt(index.readUInt32LE(position + RECORD_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			name,
			offset,
			size,
			unpackedSize: BigInt(
				index.readUInt32LE(position + RECORD_UNPACKED_SIZE_FIELD),
			),
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly LaxEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const lower = entry.name.toLowerCase();
		const fixed = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.unpackedSize,
			packedSize: entry.size,
			compressed: true,
			metadata: {
				type: IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
					? "image"
					: "data",
			},
		});
		// A record without an unpacked size leaves the length to the stream.
		return entry.unpackedSize === 0n ? { ...fixed, sizeKnown: false } : fixed;
	});
}

export const laxDescriptor: FormatDescriptor = {
	id: "lambda-lax",
	name: "Lambda engine resource archive",
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
			source: "ArcFormats/Lambda/ArcLAX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const laxFormat = defineFixedArchive({
	descriptor: laxDescriptor,
	detection: { signatures: [{ bytes: FILE_MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLaxIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLaxIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lambda LAX layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	/** `LaxOpener.OpenEntry`: every payload is a LAX stream that decodes to the end of its input. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		try {
			return Readable.from([inflateLaxStream(stored)]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LAX payload stream");
		}
	},
});
