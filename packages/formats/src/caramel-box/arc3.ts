// Format reference: GARbro "ArcFormats/CaramelBox/ArcARC3.cs", classes `Arc3Opener`, `Arc3Entry`
// and `LzBitStream`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import { detectFileType } from "../shared/detect-type.js";
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("arc3", "ascii");
const VERSION_OFFSET = 4;
const CLUSTER_SIZE_OFFSET = 8;
const BASE_OFFSET_OFFSET = 0xc;
const INDEX_OFFSET_OFFSET = 0x18;
const INDEX_SIZE_OFFSET = 0x1c;
const NAME_BUFFER_SIZE = 0x10;
const NAME_FIELD_MARKER = 0xf;
/** Entry headers sit in front of the payload and describe its attributes. */
const ENTRY_HEADER_SIZE = 0x20;
const SIZE_FIELD = 8;
const FLAG_FIELD = 0x14;
const PACKED_SIGNATURE = 0x7a6c; // 'lz'
const LZE_CHUNK_MARKER = Buffer.from("ze", "ascii");
const LZE_CHUNK_HEADER_SIZE = 4;
const FULL_WIDTH_ASTERISK = "\uff0a";

/**
 * GARbro `LzBitStream`: a most significant bit first reader that fills its cache two bytes at a time,
 * so a stream can interleave bit fields with plain reads of the same input.
 */
class LzBitStream {
	readonly #input: Buffer;
	#position: number;
	#bits = 0;
	#cached = 0;

	constructor(input: Buffer, position: number) {
		this.#input = input;
		this.#position = position;
	}

	get position(): number {
		return this.#position;
	}

	/** GARbro `BitStream.Reset` drops the cache, which byte aligns the next read. */
	reset(): void {
		this.#bits = 0;
		this.#cached = 0;
	}

	getBits(count: number): number {
		while (this.#cached < count) {
			const first = this.#input[this.#position];
			if (first === undefined) return -1;
			this.#position += 1;
			this.#bits = ((this.#bits << 8) | first) >>> 0;
			this.#cached += 8;
			const second = this.#input[this.#position];
			if (second !== undefined) {
				this.#position += 1;
				this.#bits = ((this.#bits << 8) | second) >>> 0;
				this.#cached += 8;
			}
		}
		this.#cached -= count;
		return (this.#bits >>> this.#cached) & ((1 << count) - 1);
	}

	getNextBit(): number {
		return this.getBits(1);
	}
}

/** GARbro `Arc3Opener.BigEndian24`: three little endian bytes read as a big endian value. */
function bigEndian24(view: Buffer, position: number): number {
	const first = view[position] ?? 0;
	const second = view[position + 1] ?? 0;
	const third = view[position + 2] ?? 0;
	return ((first << 16) | (second << 8) | third) >>> 0;
}

interface Arc3ParsedEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	/** Offset of the entry header, before the payload adjustment. */
	headerOffset: bigint;
	flags: number;
	packed: boolean;
	encrypted: boolean;
	size: number;
	unpackedSize: number;
}

interface Arc3Index {
	entries: Arc3ParsedEntry[];
	version: number;
}

/**
 * GARbro `Arc3Opener.TryOpen`. The index is a chain of deltas: a control byte carries a name field
 * marker and a name length, the name buffer is patched in place, and the entry offset is stored as a
 * big endian 24 bit distance in front of the previous entry's offset.
 */
async function readArc3Index(
	source: ByteSource,
): Promise<Arc3Index | undefined> {
	if (source.size < BigInt(0x20)) return undefined;
	const head = Buffer.from(await source.readAt(0n, 0x20));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const version = head.readUInt32BE(VERSION_OFFSET);
	const clusterSize = head.readUInt32BE(CLUSTER_SIZE_OFFSET);
	const baseOffset = head.readUInt32BE(BASE_OFFSET_OFFSET);
	const indexOffset = head.readUInt32BE(INDEX_OFFSET_OFFSET);
	const indexSize = head.readUInt32BE(INDEX_SIZE_OFFSET);
	if (indexSize === 0 || clusterSize === 0) return undefined;
	const start = BigInt(indexOffset) * BigInt(clusterSize);
	const end = start + BigInt(indexSize);
	if (end > source.size) return undefined;
	const index = Buffer.from(await source.readAt(start, indexSize));

	let position = 0;
	let nameLength = 0;
	let lastNameLength = 0;
	let lastOffset = 0x7fffffff;
	let hasPrevious = false;
	let freshName = false;
	let buffer = Buffer.alloc(NAME_BUFFER_SIZE);
	const entries: Arc3ParsedEntry[] = [];
	while (position < index.length) {
		const control = index[position] ?? 0;
		position += 1;
		const nameOffset = control >> 4;
		nameLength = control & 0xf;
		if (nameOffset !== NAME_FIELD_MARKER) {
			if (position + nameLength > index.length) return undefined;
			index.copy(buffer, nameOffset, position, position + nameLength);
			position += nameLength;
			lastNameLength = nameOffset + nameLength;
		} else if (nameLength === NAME_FIELD_MARKER) {
			const last = lastNameLength - 1;
			buffer[last] = ((buffer[last] ?? 0) + 1) & 0xff;
		} else if (nameLength !== 0) {
			if (position + nameLength > index.length) return undefined;
			if (nameLength > buffer.length) buffer = Buffer.alloc(nameLength);
			index.copy(buffer, 0, position, position + nameLength);
			position += nameLength;
			lastNameLength = nameLength;
			freshName = true;
		} else {
			if (position + 3 > index.length) return undefined;
			const distance = bigEndian24(index, position);
			const resolved = Math.abs(distance - indexOffset);
			if (resolved < lastOffset) lastOffset = resolved;
			if (hasPrevious) {
				const previous = entries[entries.length - 1];
				if (previous)
					previous.offset = BigInt((lastOffset + baseOffset) * clusterSize);
			}
		}
		if (position + 3 > index.length) return undefined;
		lastOffset = bigEndian24(index, position);
		position += 3;
		if (freshName) {
			position += 3;
			freshName = false;
		}
		const name = buildName(buffer, lastNameLength);
		const offset = (lastOffset + baseOffset) * clusterSize;
		if (BigInt(offset) >= source.size) return undefined;
		const normalized = normalizeEntryPath(name);
		const entry: Arc3ParsedEntry = {
			...normalized,
			offset: BigInt(offset),
			headerOffset: BigInt(offset),
			flags: 0,
			packed: false,
			encrypted: false,
			size: 0,
			unpackedSize: 0,
		};
		entries.push(entry);
		hasPrevious = true;
	}
	if (entries.length === 0) return undefined;
	return { entries, version };
}

/** GARbro builds the name from a three character extension and the remaining characters. */
function buildName(buffer: Buffer, length: number): string {
	if (length <= 3) return decodeCp932(Buffer.from(buffer.subarray(0, length)));
	const extension = decodeCp932(Buffer.from(buffer.subarray(0, 3)));
	const stem = decodeCp932(Buffer.from(buffer.subarray(3, length)));
	return `${stem}.${extension}`;
}

/** GARbro's attributes pass: flags, the packed signature and the unpacked size. */
async function readArc3Attributes(
	source: ByteSource,
	parsed: Arc3Index,
): Promise<FixedEntry[] | undefined> {
	const entries: FixedEntry[] = [];
	for (const [index, entry] of parsed.entries.entries()) {
		const headerOffset = entry.headerOffset;
		if (headerOffset + BigInt(ENTRY_HEADER_SIZE) > source.size)
			return undefined;
		const header = Buffer.from(
			await source.readAt(headerOffset, ENTRY_HEADER_SIZE),
		);
		const size = header.readUInt32BE(SIZE_FIELD);
		entry.flags = header.readUInt32BE(FLAG_FIELD);
		entry.encrypted = entry.flags === 2;
		entry.size = size;
		entry.unpackedSize = size;
		let offset = headerOffset + BigInt(ENTRY_HEADER_SIZE);
		// The reference reads through a clamped view, so a payload that is shorter than the six byte
		// prefix is read as far as the file goes and the missing bytes count as zero.
		const available = source.size - offset;
		const prefixLength =
			available < 6n ? Number(available < 0n ? 0n : available) : 6;
		const payloadHeader = Buffer.alloc(6);
		if (prefixLength > 0)
			Buffer.from(await source.readAt(offset, prefixLength)).copy(
				payloadHeader,
			);
		let signature = payloadHeader.readUInt32LE(0);
		if (entry.encrypted) signature = ~signature >>> 0;
		entry.packed = (signature & 0xffff) === PACKED_SIGNATURE;
		if (entry.packed) {
			let unpacked = payloadHeader.readUInt32BE(2);
			if (entry.encrypted) unpacked = (unpacked ^ 0xffffffff) >>> 0;
			entry.unpackedSize = unpacked;
			offset += 6n;
			entry.size = size - 6;
		}
		entry.offset = offset;
		if (!checkPlacement(offset, BigInt(entry.size), source.size))
			return undefined;
		const size2 = entry.packed ? entry.unpackedSize : entry.size;
		const created = createFixedEntry({
			id: index,
			path: entry.path.replaceAll("*", FULL_WIDTH_ASTERISK),
			...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
			offset,
			size: BigInt(size2),
			packedSize: BigInt(entry.size),
			compressed: entry.packed,
			encrypted: entry.encrypted,
			metadata: {
				flags: entry.flags,
				...(entry.packed ? {} : detectedTypeMetadata(signature)),
			} as Record<string, unknown>,
		});
		entries.push(entry.packed ? { ...created, sizeKnown: false } : created);
	}
	return entries;
}

/** GARbro `AutoEntry.DetectFileType` names the type of unpacked payloads. */
function detectedTypeMetadata(signature: number): Record<string, unknown> {
	const detected = detectFileType(signature);
	return detected ? { type: detected.type } : {};
}

/** GARbro `Arc3Opener.UnpackLze`: a sequence of `ze` chunks, each with its own bit stream. */
function unpackLze(data: Buffer, unpackedSize: number): Buffer {
	const output = Buffer.alloc(unpackedSize);
	let position = 0;
	let destination = 0;
	while (destination < output.length) {
		if (position + LZE_CHUNK_HEADER_SIZE > data.length) break;
		if (!data.subarray(position, position + 2).equals(LZE_CHUNK_MARKER))
			throw new GarbroError("INVALID_ARCHIVE", "Malformed compressed stream");
		const chunkLength = data.readUInt16BE(position + 2);
		position += LZE_CHUNK_HEADER_SIZE;
		const bits = new LzBitStream(data, position);
		unpackZeChunk(bits, output, destination, chunkLength);
		destination += chunkLength;
		// The reference discards the bit cache after every chunk, so the next chunk starts at the
		// reader's position.
		position = bits.position;
	}
	return output;
}

/** GARbro `Arc3Opener.UnpackZeChunk`: run lengths of literals and back references. */
function unpackZeChunk(
	bits: LzBitStream,
	output: Buffer,
	destination: number,
	chunkLength: number,
): void {
	const end = destination + chunkLength;
	let at = destination;
	while (at < end) {
		let count = lzeGetInteger(bits);
		if (count === -1) break;
		let aborted = false;
		while (count - 1 > 0) {
			count -= 1;
			const value = bits.getBits(8);
			if (value === -1) {
				aborted = true;
				break;
			}
			if (at < end) output[at++] = value;
		}
		if (aborted || at >= end) break;
		const offset = lzeGetInteger(bits);
		if (offset === -1) break;
		const repeat = lzeGetInteger(bits);
		if (repeat === -1) break;
		for (let i = 0; i < repeat && at < output.length; i += 1) {
			output[at] = output[at - offset] ?? 0;
			at += 1;
		}
	}
	if (at < end)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Premature end of compressed stream",
		);
}

/** GARbro `Arc3Opener.LzeGetInteger`: a unary prefix followed by the remaining bits. */
function lzeGetInteger(bits: LzBitStream): number {
	let length = 0;
	for (let i = 0; i < 16; i += 1) {
		if (bits.getNextBit() !== 0) break;
		length += 1;
	}
	let value = 1 << length;
	if (length > 0) {
		const extra = bits.getBits(length);
		if (extra === -1) return -1;
		value |= extra;
	}
	return value;
}

export const caramelBoxArc3Descriptor: FormatDescriptor = {
	id: "caramel-box-arc3",
	name: "Caramel BOX resource archive",
	extensions: ["bin", "ar3", "ac3"],
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
			source: "ArcFormats/CaramelBox/ArcARC3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const caramelBoxArc3Format: ArchiveFormat = defineFixedArchive({
	descriptor: caramelBoxArc3Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const parsed = await readArc3Index(source);
		if (!parsed) return false;
		return (await readArc3Attributes(source, parsed)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readArc3Index(source);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Caramel BOX layout");
		const entries = await readArc3Attributes(source, parsed);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Caramel BOX layout");
		return {
			entries,
			metadata: { entryCount: entries.length, version: parsed.version },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as { flags?: number };
		const offset = entry.offset ?? 0n;
		const storedSize = Number(entry.packedSize ?? entry.size);
		if (storedSize === 0) return Readable.from([]);
		let data = Buffer.from(await source.readAt(offset, storedSize));
		if (metadata.flags === 2)
			data = Buffer.from(data.map((byte) => ~byte & 0xff));
		if (!entry.compressed) return Readable.from([data]);
		return Readable.from([unpackLze(data, Number(entry.size))]);
	},
});
