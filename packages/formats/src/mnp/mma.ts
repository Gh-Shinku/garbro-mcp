// Format reference: GARbro "ArcFormats/Mnp/ArcMMA.cs", class `MmaOpener` (listing, name list and
// payload unpacking; the `MmeImageDecoder` and `MmeMaskDecoder` image decoders are out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive starts with the little endian spelling of `ARC!`. */
const SIGNATURE = Buffer.from("ARC!", "latin1");
const INDEX_OFFSET_OFFSET = 4;
const VERSION_OFFSET = 0xc;
const VERSION = 1;
const COUNT_OFFSET = 0x10;
const RECORD_SIZE = 0x14;
/** The payload stream is masked with this repeating key. */
const DEFAULT_KEY = Buffer.from([
	0x77, 0x2c, 0x6f, 0x7a, 0x71, 0x4f, 0x25, 0x74, 0x6c, 0x28, 0x7a, 0x81, 0x4c,
	0x31, 0x81, 0x5b, 0x77, 0x81, 0x4d, 0x79, 0x29, 0x69, 0x45, 0x6b, 0x79, 0x7a,
	0x68, 0x2d, 0x69, 0x66, 0x29, 0x39,
]);
/** The two low flags decide how a payload is stored. */
const STORAGE_MASK = 6;
const STORAGE_LZ = 6;
const STORAGE_HEADER = 4;
/** The first entry can hold a packed list of names. */
const NAME_LIST_FLAGS = 0x2f;
/** Type hints from the upper flag bits. */
const TYPE_MASK = 0x38;
const IMAGE_FLAGS = [8, 0x10, 0x18, 0x38];
const AUDIO_FLAGS = 0x2d;
/** The LZ stream starts with this marker: stored, compressed, or masked. */
const LZ_MARKER = 0xc0;
const LZ_STORED = 0;
/** Literals are rotated the other way round, matches use the low bits for the count. */
const LITERAL_ROTATE = 5;
const MATCH_ROTATE = 3;
const MATCH_COUNT_MASK = 0x1f;
const MATCH_COUNT_BIAS = 3;
const MATCH_OFFSET_BIAS = 1;
const BIT_MSB = 0x80;

interface MmaEntry {
	path: string;
	offset: bigint;
	size: bigint;
	unpackedSize: number;
	headerSize: number;
	flags: number;
	type?: string;
}

function rotateRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

function rotateLeft(value: number, count: number): number {
	return ((value << count) | (value >>> (8 - count))) & 0xff;
}

/** GARbro `MmaOpener.Decrypt`: mask every byte then rotate it right. */
function decrypt(data: Buffer, offset: number, length: number): void {
	for (let i = 0; i < length; i += 1) {
		const position = offset + i;
		const value =
			(data[position] ?? 0) ^ (DEFAULT_KEY[i & (DEFAULT_KEY.length - 1)] ?? 0);
		data[position] = rotateRight(value, MATCH_ROTATE);
	}
}

/**
 * GARbro `MmaOpener.UnpackLz`: a marker byte selects a stored payload, a plain LZ stream, or a
 * masked one; the stream itself is read most significant bit first.
 */
function unpackLz(input: Buffer, outputLength: number): Buffer | undefined {
	if (input.length === 0) return undefined;
	const marker = input[0] ?? 0;
	let data = input;
	let position = 1;
	if (marker !== LZ_MARKER) {
		if ((marker ^ (DEFAULT_KEY[0] ?? 0)) === LZ_MARKER) {
			// The whole stream, marker included, is masked with the key.
			data = Buffer.from(input);
			for (let i = 0; i < data.length; i += 1)
				data[i] =
					(data[i] ?? 0) ^ (DEFAULT_KEY[i & (DEFAULT_KEY.length - 1)] ?? 0);
		} else if (marker !== LZ_STORED) {
			return undefined;
		} else {
			const output = Buffer.alloc(outputLength);
			Buffer.from(data.subarray(1, 1 + outputLength)).copy(output, 0);
			return output;
		}
	}
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	let mask = 0;
	let control = 0;
	while (destination < outputLength) {
		if (mask === 0) {
			if (position >= data.length) break;
			control = data[position] ?? 0;
			position += 1;
			mask = BIT_MSB;
		}
		if ((control & mask) !== 0) {
			if (position + 2 > data.length) break;
			let word = ((data[position] ?? 0) << 8) | (data[position + 1] ?? 0);
			position += 2;
			const count = (word & MATCH_COUNT_MASK) + MATCH_COUNT_BIAS;
			word = (word >> 5) + MATCH_OFFSET_BIAS;
			for (let i = 0; i < count && destination < outputLength; i += 1) {
				output[destination] = output[destination - word] ?? 0;
				destination += 1;
			}
		} else {
			if (position >= data.length) break;
			output[destination] = rotateLeft(data[position] ?? 0, LITERAL_ROTATE);
			destination += 1;
			position += 1;
		}
		mask >>= 1;
	}
	return output;
}

/** GARbro `MmaOpener.UnpackEntry`: the flags select stored, header offset or LZ payloads. */
function unpackEntry(data: Buffer, entry: MmaEntry): Buffer | undefined {
	const storage = entry.flags & STORAGE_MASK;
	if (storage === STORAGE_LZ && entry.headerSize === 0)
		return unpackLz(data, entry.unpackedSize);
	if (storage === STORAGE_HEADER) {
		const start = entry.headerSize;
		const output = Buffer.alloc(entry.unpackedSize);
		Buffer.from(data.subarray(start, start + entry.unpackedSize)).copy(
			output,
			0,
		);
		decrypt(output, 0, output.length);
		return output;
	}
	return Buffer.from(data);
}

function typeOf(flags: number): string | undefined {
	if (IMAGE_FLAGS.includes(flags & TYPE_MASK)) return "image";
	if (flags === AUDIO_FLAGS) return "audio";
	return undefined;
}

/** GARbro `MmaOpener.TryOpen` and `ReadMmaList`. */
async function readMmaLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<MmaEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET) + 4n) return undefined;
	const head = Buffer.from(await source.readAt(0n, COUNT_OFFSET + 4));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (head.readInt32LE(VERSION_OFFSET) !== VERSION) return undefined;
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(head.readUInt32LE(INDEX_OFFSET_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(RECORD_SIZE * count) > source.size) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(indexOffset, RECORD_SIZE * count));
	} catch {
		return undefined;
	}
	const base = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
	const entries: MmaEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const entry: MmaEntry = {
			path: `${base}#${String(i).padStart(5, "0")}`,
			offset: BigInt(index.readUInt32LE(position)),
			unpackedSize: index.readUInt32LE(position + 4),
			size: BigInt(index.readUInt32LE(position + 8)),
			headerSize: index.readUInt32LE(position + 0x0c),
			flags: index.readUInt32LE(position + 0x10),
		};
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
		const type = typeOf(entry.flags);
		if (type !== undefined) entry.type = type;
		entries.push(entry);
	}
	const first = entries[0];
	if (first && first.flags === NAME_LIST_FLAGS) {
		const packed = Buffer.from(
			await source.readAt(first.offset, Number(first.size)),
		);
		const unpacked = unpackEntry(packed, first);
		if (!unpacked) return undefined;
		const names = decodeCp932(unpacked).split(/\r\n|\n|\r/);
		for (let i = 0; i < entries.length; i += 1) {
			const line = names[i];
			if (line === undefined) break;
			const entry = entries[i];
			if (entry) entry.path = line.replace(/^.*[/\\]/, "");
		}
	}
	return entries.length > 0 ? entries : undefined;
}

export const mmaDescriptor: FormatDescriptor = {
	id: "mnp-mma",
	name: "MNP engine resource archive",
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
			source: "ArcFormats/Mnp/ArcMMA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mmaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mmaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMmaLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readMmaLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MNP MMA layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				compressed: (entry.flags & STORAGE_MASK) !== 0,
				encrypted: (entry.flags & STORAGE_MASK) === STORAGE_HEADER,
				metadata: {
					unpackedSize: entry.unpackedSize,
					headerSize: entry.headerSize,
					flags: entry.flags,
					...(entry.type !== undefined ? { type: entry.type } : {}),
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { unpackedSize?: number; headerSize?: number; flags?: number }
			| undefined;
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const output = unpackEntry(data, {
			path: entry.path,
			offset: entry.offset,
			size: entry.size,
			unpackedSize: metadata?.unpackedSize ?? Number(entry.size),
			headerSize: metadata?.headerSize ?? 0,
			flags: metadata?.flags ?? 0,
		});
		if (!output)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MNP MMA payload");
		// The stored and header branches yield exactly the declared unpacked size.
		return Readable.from([Buffer.from(output)]);
	},
});
