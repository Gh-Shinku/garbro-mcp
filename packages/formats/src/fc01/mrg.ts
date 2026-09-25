// Format reference: GARbro "ArcFormats/FC01/ArcMRG.cs", class `MrgOpener` (the `MrgOverture` variant
// lives in a separate record). The `MrgDecoder` payload codec of methods two and three stands in
// `mrg-decoder.ts`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { MrgDecoder } from "./mrg-decoder.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The header starts with the little endian spelling of `MRG\0`. */
const SIGNATURE = Buffer.from("MRG\0", "latin1");
const KEY1_INDEX_OFFSET = 4;
const KEY2_INDEX_OFFSET = 6;
const INDEX_SIZE_OFFSET = 8;
const COUNT_OFFSET = 0xc;
const HEADER_SIZE = 0x10;
/** Records are 0x20 bytes apart but reach into the next one for their end offset. */
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x0e;
const UNPACKED_SIZE_OFFSET = 0x0e;
const METHOD_OFFSET = 0x12;
const START_OFFSET_OFFSET = 0x1c;
const END_OFFSET_OFFSET = 0x3c;
/** The index ends with a big endian file size that the key guess reads back. */
const KEY_PROBE_SIZE = 4;
/** Method one stands of the plain LZSS reader alone. */
const LZSS_METHOD = 1;
/** Method two stands of the `MrgDecoder` codec and of the LZSS reader behind it. */
const DECODER_METHOD = 2;
/** Method three stands of the `MrgDecoder` codec alone. */
const MATCH_LITERAL_METHOD = 3;
/** The count of the places of the file of the head of a walk of the words of the codec. */
const DECODER_HEAD_SIZE = 0x108;
/** The LZSS frame is zero filled, starts near its end and is indexed by the low bits of the word. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT_POSITION = 0xfee;
const MATCH_COUNT_SHIFT = 12;
const MATCH_COUNT_BIAS = 3;

/** The method of a picture of the places of the file of the picture itself. */
const STORED_METHOD = 0;

interface MrgEntry {
	path: string;
	rawPath?: string;
	offset: number;
	size: number;
	method: number;
	unpackedSize: number;
}

function rotateLeft(value: number, count: number): number {
	return ((value << count) | (value >>> (8 - count))) & 0xff;
}

/**
 * GARbro `MrgOpener.Decrypt`: rotate every byte left, mask it and let the key advance by the number
 * of bytes that are still to come, so the key schedule depends on the whole length.
 */
function decrypt(
	data: Buffer,
	start: number,
	length: number,
	key: number,
): void {
	let position = start;
	let remaining = length;
	let current = key & 0xff;
	while (remaining > 0) {
		const value = data[position] ?? 0;
		data[position] = (rotateLeft(value, 1) ^ current) & 0xff;
		position += 1;
		current = (current + remaining) & 0xff;
		remaining -= 1;
	}
}

/**
 * GARbro `MrgLzssReader.Unpack`: control bits are read least significant bit first, a set bit copies
 * one literal and a clear bit reads a 16 bit word whose top nibble counts the bytes to copy from the
 * sliding frame, masked into its low twelve bits.
 */
export function unpackMrgLzss(data: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INIT_POSITION;
	let position = 0;
	let remaining = data.length;
	let destination = 0;
	while (remaining > 0) {
		const control = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		for (let bit = 1; remaining > 0 && bit !== 0x100; bit <<= 1) {
			if (destination >= output.length) return output;
			if ((control & bit) !== 0) {
				const value = data[position] ?? 0;
				position += 1;
				remaining -= 1;
				frame[framePosition & FRAME_MASK] = value;
				framePosition = (framePosition + 1) & FRAME_MASK;
				output[destination] = value;
				destination += 1;
			} else {
				if (remaining < 2) return output;
				const word = (data[position] ?? 0) | ((data[position + 1] ?? 0) << 8);
				position += 2;
				remaining -= 2;
				let count = (word >> MATCH_COUNT_SHIFT) + MATCH_COUNT_BIAS;
				let offset = word & FRAME_MASK;
				while (count !== 0) {
					count -= 1;
					if (destination >= output.length) break;
					const value = frame[offset & FRAME_MASK] ?? 0;
					offset += 1;
					frame[framePosition & FRAME_MASK] = value;
					framePosition = (framePosition + 1) & FRAME_MASK;
					output[destination] = value;
					destination += 1;
				}
			}
		}
	}
	return output;
}

/**
 * GARbro `MrgOpener.GuessKey`: the index ends with the big endian file size, masked with a key that
 * folds the record count back in. Reproducing the last offset proves the candidate key.
 */
function guessKey(fileSize: bigint, index: Buffer): number | undefined {
	if (index.length < KEY_PROBE_SIZE + 1) return undefined;
	const actualOffset = Number(fileSize & 0xffffffffn) >>> 0;
	let v = rotateLeft(index[index.length - 1] ?? 0, 1);
	let key = (v ^ (actualOffset >>> 24)) & 0xff;
	let remaining = 1;
	let lastOffset = (v ^ key) & 0xff;
	for (let i = index.length - 2; i >= index.length - KEY_PROBE_SIZE; i -= 1) {
		remaining += 1;
		key = (key - (remaining & 0xff)) & 0xff;
		v = rotateLeft(index[i] ?? 0, 1);
		lastOffset = ((lastOffset << 8) | (v ^ key)) >>> 0;
	}
	if (lastOffset !== actualOffset) return undefined;
	while (remaining < index.length) {
		remaining += 1;
		key = (key - (remaining & 0xff)) & 0xff;
	}
	return key;
}

/** GARbro `MrgOpener.TryOpen`, including the key guess and the index decryption. */
async function readMrgLayout(
	source: ByteSource,
): Promise<MrgEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE) + 0x40n) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const key1Index = header.readUInt16LE(KEY1_INDEX_OFFSET);
	const key2Index = header.readUInt16LE(KEY2_INDEX_OFFSET);
	if (key2Index !== 0 && key1Index === 0) return undefined;
	const indexSize =
		(header.readUInt32LE(INDEX_SIZE_OFFSET) - HEADER_SIZE) >>> 0;
	if (indexSize < 0x40 || BigInt(indexSize) >= source.size) return undefined;
	if (key2Index >= 2) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(BigInt(HEADER_SIZE), indexSize));
	} catch {
		return undefined;
	}
	if (index.length !== indexSize) return undefined;
	const key = guessKey(source.size, index);
	if (key === undefined) return undefined;
	decrypt(index, 0, index.length, key);
	// The last record's end offset sits inside the index, so the table needs one field beyond it.
	if (index.length < (count - 1) * RECORD_SIZE + END_OFFSET_OFFSET + 4)
		return undefined;
	const entries: MrgEntry[] = [];
	let nextOffset = index.readUInt32LE(START_OFFSET_OFFSET) >>> 0;
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const rawName = decodeCStringField(index, position, NAME_SIZE);
		const entry: MrgEntry = {
			...normalizeEntryPath(rawName),
			offset: nextOffset,
			size: 0,
			method: index[position + METHOD_OFFSET] ?? 0,
			unpackedSize: index.readUInt32LE(position + UNPACKED_SIZE_OFFSET) >>> 0,
		};
		nextOffset = index.readUInt32LE(position + END_OFFSET_OFFSET) >>> 0;
		entry.size = (nextOffset - entry.offset) >>> 0;
		if (
			entry.offset < indexSize ||
			!checkPlacement(BigInt(entry.offset), BigInt(entry.size), source.size)
		)
			return undefined;
		entries.push(entry);
	}
	return entries.length > 0 ? entries : undefined;
}

export const mrgDescriptor: FormatDescriptor = {
	id: "fc01-mrg",
	name: "F&C Co. engine resource archive",
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
			source: "ArcFormats/FC01/ArcMRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mrgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mrgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMrgLayout(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const layout = await readMrgLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C MRG layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				compressed: entry.method !== 0,
				metadata: {
					method: entry.method,
					unpackedSize: entry.unpackedSize,
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { method?: number; unpackedSize?: number }
			| undefined;
		const method = metadata?.method ?? 0;
		const unpackedSize = metadata?.unpackedSize ?? Number(entry.size);
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (method > MATCH_LITERAL_METHOD) return Readable.from([data]);
		if (method === STORED_METHOD) return Readable.from([data]);
		// Methods two and three stand of the `MrgDecoder` codec, of the count of the places of the walk
		// of the picture of the head of the places of the file of it.
		let payload: Buffer = data;
		if (method >= DECODER_METHOD) {
			if (data.length < DECODER_HEAD_SIZE) return Readable.from([data]);
			const decoder = MrgDecoder.fromHeader(data);
			decoder.unpack();
			payload = decoder.data;
		}
		if (LZSS_METHOD === method || DECODER_METHOD === method) {
			if (unpackedSize === 0)
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					"F&C MRG payload has no unpacked size",
				);
			return Readable.from([unpackMrgLzss(payload, unpackedSize)]);
		}
		return Readable.from([payload]);
	},
});
