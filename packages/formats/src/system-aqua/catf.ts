// Format reference: GARbro Legacy/SystemAqua/ArcDAT.cs, class `DatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { detectFileType } from "../shared/detect-type.js";

/** 'CATF', the format signature. */
const SIGNATURE = 0x46544143;
/** The entry count lives here and the index offset four bytes before it. */
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET_FIELD = 8;
/** Index records hold a stored size and an offset. */
const RECORD_SIZE = 8;
/** The compressed payload starts with a 0x40 byte header. */
const PACKED_HEADER_SIZE = 0x40;
/** 'LZe4' marks a payload that uses the engine's own compression. */
const PACKED_MARKER = 0x34655a4c;
/** Only payloads longer than the header itself are treated as packed. */
const PACKED_MIN_SIZE = 0x40;
/** The unpacked size sits at this offset inside the packed header, then three type bytes. */
const UNPACKED_SIZE_FIELD = 8;
const TYPE_FIELD = 0xc;
/** The decoder keeps a sixteen kilobyte window that starts at position one. */
const WINDOW_SIZE = 0x4000;
const WINDOW_MASK = 0x3fff;
const WINDOW_START = 1;
/** A copy stores a fourteen bit window offset and a four bit length biased by three. */
const LZ_OFFSET_BITS = 14;
const LZ_COUNT_BITS = 4;
const LZ_MIN_COUNT = 3;
/** A packed bitmap gets a fifty-four byte header rebuilt ahead of its pixels. */
const BMP_HEADER_SIZE = 54;
const BMP_SIGNATURE = "BM";
const BMP_TYPE = "BMP";
const WAV_TYPE = "WAV";
const MID_TYPE = "MID";
const PLAIN_TYPE = "000";

/** GARbro `Binary.RotByteL (value, 4)`: the two nibbles of a byte swap. */
function rotateByteLeft(value: number): number {
	return (((value << 4) | (value >> 4)) & 0xff) >>> 0;
}

/** GARbro `Binary.RotL (value, 16)`: a thirty-two bit rotation. */
function rotateWordLeft(value: number): number {
	return ((value << 16) | (value >>> 16)) >>> 0;
}

interface CatfEntry {
	name: string;
	offset: bigint;
	stored: bigint;
	size: bigint;
	compressed: boolean;
	kind?: string;
	extension?: string;
}

/** GARbro `DatOpener.DecryptType`: the three stored type bytes are complemented and nibble swapped. */
function decryptType(raw: Buffer): string {
	const bytes = Buffer.alloc(3);
	for (let i = 0; i < 3; i += 1)
		bytes[i] = rotateByteLeft(~(raw[TYPE_FIELD + i] ?? 0) & 0xff);
	return bytes.toString("latin1");
}

/** Reads a word, or undefined when the read would leave the buffer. */
function readUInt32(data: Buffer, cursor: number): number | undefined {
	if (cursor + 4 > data.length) return undefined;
	return data.readUInt32LE(cursor);
}

async function readCatf(
	source: ByteSource,
	sourcePath: string,
): Promise<CatfEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = Buffer.from(await source.readAt(0n, COUNT_OFFSET + 4));
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(indexOffset, count * RECORD_SIZE),
	);
	const base = basename(sourcePath, extname(sourcePath));
	const entries: CatfEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const stored = BigInt(index.readUInt32LE(i * RECORD_SIZE));
		const offset = BigInt(index.readUInt32LE(i * RECORD_SIZE + 4));
		if (!checkPlacement(offset, stored, source.size)) return undefined;
		entries.push({
			name: `${base}#${String(i).padStart(4, "0")}`,
			offset,
			stored,
			size: stored,
			compressed: false,
		});
	}
	// The reference probes the first signature word of every payload to type it, and reads the type out of
	// the packed header of a payload that uses the engine's compression.
	for (const entry of entries) {
		const signature = Buffer.from(
			await source.readAt(entry.offset, Math.min(4, Number(entry.stored))),
		);
		const value =
			signature.length === 4 ? signature.readUInt32LE(0) : undefined;
		if (value !== PACKED_MARKER || entry.stored <= BigInt(PACKED_MIN_SIZE)) {
			const detected = value === undefined ? undefined : detectFileType(value);
			if (detected === undefined) {
				entry.kind = "data";
			} else {
				entry.kind = detected.type;
				entry.extension = detected.extension;
			}
			continue;
		}
		const unpacked = readUInt32(
			Buffer.from(await source.readAt(entry.offset, PACKED_HEADER_SIZE)),
			UNPACKED_SIZE_FIELD,
		);
		if (unpacked === undefined) return undefined;
		const kind = decryptType(
			Buffer.from(await source.readAt(entry.offset, PACKED_HEADER_SIZE)),
		);
		entry.compressed = true;
		entry.size = BigInt(unpacked);
		if (kind === PLAIN_TYPE) {
			entry.kind = "audio";
			continue;
		}
		if (kind === BMP_TYPE) {
			entry.kind = "image";
			entry.extension = "bmp";
		} else if (kind === WAV_TYPE) {
			entry.kind = "audio";
			entry.extension = "wav";
		} else if (kind === MID_TYPE) {
			entry.kind = "data";
			entry.extension = "mid";
		} else {
			entry.kind = "data";
		}
	}
	return entries;
}

/**
 * GARbro `DatOpener.PrepareBmpHeader`: the packed header stores the complement of three words of a bitmap
 * header, which the reference rebuilds in front of the decoded pixels. Returns the stream position the pixel
 * decoder continues from.
 */
function prepareBmpHeader(raw: Buffer, output: Buffer): void {
	const h1 = ~(readUInt32(raw, PACKED_HEADER_SIZE + 4) ?? 0) >>> 0;
	const h2 = ~(readUInt32(raw, PACKED_HEADER_SIZE + 8) ?? 0) >>> 0;
	const h3 = ~(readUInt32(raw, PACKED_HEADER_SIZE + 0xc) ?? 0) >>> 0;
	output[0] = BMP_SIGNATURE.charCodeAt(0);
	output[1] = BMP_SIGNATURE.charCodeAt(1);
	output.writeUInt32LE(output.length, 2);
	output[10] = BMP_HEADER_SIZE;
	output[14] = 40;
	const width = (((h1 & 0xffff) >>> 8) | ((h1 & 0xff) << 8)) >>> 0;
	const height = (((h1 >>> 16) >>> 8) | (((h1 >>> 16) & 0xff) << 8)) >>> 0;
	output.writeUInt32LE(width, 18);
	output.writeUInt32LE(height, 22);
	output[26] = 1;
	output[28] = rotateByteLeft(h2 & 0xff);
	output.writeUInt32LE(rotateWordLeft(h3), 34);
	output.writeUInt32LE(0xb12, 38);
	output.writeUInt32LE(0xb12, 42);
	output.writeUInt32LE(rotateByteLeft((h2 >>> 16) & 0xff), 46);
	output.writeUInt32LE(rotateByteLeft((h2 >>> 24) & 0xff), 50);
}

/**
 * GARbro `DatOpener.LzUnpack`: most significant bit first, a set control bit stores one literal byte and a
 * clear one copies a run from a sixteen kilobyte window, which starts at position one and is filled with
 * zeroes before the first copy. The reference lets a copy run past the end of the output, so the port raises
 * `INVALID_ARCHIVE` for that case, while a stream that ends early returns the buffer as far as it got.
 */
function unpackWindowLz(
	raw: Buffer,
	byteOffset: number,
	output: Buffer,
	start: number,
): void {
	const window = Buffer.alloc(WINDOW_SIZE);
	let windowPosition = WINDOW_START;
	const bits = new MsbBitReader(raw, byteOffset);
	let target = start;
	while (target < output.length) {
		const control = bits.tryReadBits(1);
		if (control === -1) break;
		if (control !== 0) {
			const value = bits.tryReadBits(8);
			if (value === -1) break;
			output[target] = value;
			window[windowPosition & WINDOW_MASK] = value;
			target += 1;
			windowPosition += 1;
			continue;
		}
		const offset = bits.tryReadBits(LZ_OFFSET_BITS);
		const count = bits.tryReadBits(LZ_COUNT_BITS);
		if (offset === -1 || count === -1) break;
		let from = offset;
		let length = count + LZ_MIN_COUNT;
		if (target + length > output.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"SystemAQUA copy leaves the unpacked payload",
			);
		while (length > 0) {
			const value = window[from & WINDOW_MASK] ?? 0;
			from += 1;
			output[target] = value;
			window[windowPosition & WINDOW_MASK] = value;
			target += 1;
			windowPosition += 1;
			length -= 1;
		}
	}
}

function toFixedEntries(entries: readonly CatfEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			path:
				entry.extension === undefined
					? entry.name
					: `${entry.name}.${entry.extension}`,
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.stored,
			compressed: entry.compressed,
			metadata: { type: entry.kind ?? "data" },
		}),
	);
}

async function openCatfEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.packedSize))),
		]);
	const raw = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	const output = Buffer.alloc(Number(entry.size));
	let cursor = PACKED_HEADER_SIZE;
	let start = 0;
	if (decryptType(raw) === BMP_TYPE) {
		prepareBmpHeader(raw, output);
		cursor = PACKED_HEADER_SIZE + 0x10;
		start = BMP_HEADER_SIZE;
	}
	unpackWindowLz(raw, cursor, output, start);
	return Readable.from([output]);
}

export const systemAquaCatfDescriptor: FormatDescriptor = {
	id: "system-aqua-catf",
	name: "SystemAQUA engine resource archive",
	extensions: ["dat", "cat"],
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
			source: "Legacy/SystemAqua/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const systemAquaCatfFormat = defineFixedArchive({
	descriptor: systemAquaCatfDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("CATF", "latin1") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readCatf(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCatf(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SystemAQUA layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openCatfEntry,
});
