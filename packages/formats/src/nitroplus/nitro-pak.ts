// Format reference: GARbro ArcFormats/NitroPlus/ArcNitro.cs, class `PakOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Both versions keep their index at this offset. */
const INDEX_OFFSET = 0x114;
/** The game name in a version three header is stored in a 0x100 byte field. */
const V3_NAME_FIELD = 0x100;
/** The game name is at most sixteen characters long. */
const V3_NAME_LIMIT = 0x10;
/** A version three header stores this value xor 0x64 at offset 0x104. */
const V3_SIZE_XOR = 0x64;
/** Only the first sixteen bytes of an uncompressed version three entry are encrypted. */
const V3_ENCRYPTED_PREFIX = 0x10;
/** Version two starts with this word, version three with the next one. */
const VERSION_2 = 2;
const VERSION_3 = 3;
/** The index of a version two file is compressed, its records hold seven fields. */
const RECORD_FIELDS = 5;

/**
 * GARbro `PakOpener.GetKey`: a small polynomial rolling over the signed bytes of a name. The reference
 * computes it in 32 bit signed arithmetic, so the port multiplies with `Math.imul` and truncates the sum.
 */
export function nitroPakKey(name: Uint8Array, length: number): number {
	let key = 0;
	for (let i = 0; i < length; i += 1) {
		key = Math.imul(key, 0x89) | 0;
		key = (key + (((name[i] ?? 0) << 24) >> 24)) | 0;
	}
	return key >>> 0;
}

/** GARbro `Binary.RotR(key, 8)`: the low byte moves to the top. */
function rotateRight(key: number): number {
	return ((key >>> 8) | (key << 24)) >>> 0;
}

interface NitroPakEntry {
	path: string;
	offset: bigint;
	size: bigint;
	packedSize: bigint;
	compressed: boolean;
	encrypted: boolean;
	key: number;
	unpackedField: bigint;
}

interface NitroPakIndex {
	entries: NitroPakEntry[];
	version: number;
}

/** Reads a little endian unsigned word from a buffer, or undefined when it leaves the buffer. */
function readUInt32(data: Buffer, cursor: number): number | undefined {
	if (cursor + 4 > data.length) return undefined;
	return data.readUInt32LE(cursor);
}

function readInt32(data: Buffer, cursor: number): number | undefined {
	if (cursor + 4 > data.length) return undefined;
	return data.readInt32LE(cursor);
}

/** Reads a length prefixed name and returns it with the cursor past it. */
function readTableName(
	data: Buffer,
	cursor: number,
	limit: number,
): { name: Buffer; cursor: number } | undefined {
	const length = readInt32(data, cursor);
	if (length === undefined || length <= 0 || length > limit) return undefined;
	const start = cursor + 4;
	if (start + length > data.length) return undefined;
	return { name: data.subarray(start, start + length), cursor: start + length };
}

/**
 * Version two index records are plain: name length, name, the offset relative to the payload area, the
 * unpacked size, the stored size, a packed flag and the packed size, which replaces the stored size when the
 * entry is packed.
 */
function readPakV2Index(
	table: Buffer,
	count: number,
	base: bigint,
): NitroPakEntry[] | undefined {
	const entries: NitroPakEntry[] = [];
	let cursor = 0;
	for (let i = 0; i < count; i += 1) {
		const named = readTableName(table, cursor, table.length);
		if (!named) return undefined;
		cursor = named.cursor;
		const values: number[] = [];
		for (let field = 0; field < RECORD_FIELDS; field += 1) {
			const value = readUInt32(table, cursor);
			if (value === undefined) return undefined;
			values.push(value);
			cursor += 4;
		}
		const relative = BigInt(values[0] ?? 0);
		const unpacked = BigInt(values[1] ?? 0);
		const stored = BigInt(values[2] ?? 0);
		const packed = (values[3] ?? 0) !== 0;
		const packedSize = BigInt(values[4] ?? 0);
		entries.push({
			path: decodeCp932(named.name),
			offset: base + relative,
			size: packed ? unpacked : stored,
			packedSize: packed ? packedSize : stored,
			compressed: packed,
			encrypted: false,
			key: 0,
			unpackedField: unpacked,
		});
	}
	return entries;
}

/**
 * Version three index records xor every numeric field with a key derived from the record name. The stored size
 * of an unpacked entry is its unpacked size, whose first sixteen bytes are encrypted.
 */
function readPakV3Index(
	table: Buffer,
	count: number,
	base: bigint,
): NitroPakEntry[] | undefined {
	const entries: NitroPakEntry[] = [];
	let cursor = 0;
	for (let i = 0; i < count; i += 1) {
		const named = readTableName(table, cursor, V3_NAME_FIELD);
		if (!named) return undefined;
		cursor = named.cursor;
		const key = nitroPakKey(named.name, named.name.length);
		const values: number[] = [];
		for (let field = 0; field < RECORD_FIELDS; field += 1) {
			const value = readUInt32(table, cursor);
			if (value === undefined) return undefined;
			values.push((value ^ key) >>> 0);
			cursor += 4;
		}
		const relative = BigInt(values[0] ?? 0);
		const unpacked = BigInt(values[1] ?? 0);
		const packed = (values[3] ?? 0) !== 0;
		const packedSize = BigInt(values[4] ?? 0);
		entries.push({
			path: decodeCp932(named.name),
			offset: base + relative,
			size: unpacked,
			packedSize: packed ? packedSize : unpacked,
			compressed: packed,
			encrypted: !packed,
			key,
			unpackedField: unpacked,
		});
	}
	return entries;
}

async function readNitroPak(
	source: ByteSource,
): Promise<NitroPakIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, INDEX_OFFSET));
	const version = head.readUInt32LE(0);
	if (version === VERSION_2) {
		const count = head.readInt32LE(4);
		if (!isSaneCount(count)) return undefined;
		const packedSize = head.readUInt32LE(0xc);
		if (packedSize === 0) return undefined;
		if (BigInt(INDEX_OFFSET) + BigInt(packedSize) > source.size)
			return undefined;
		const compressed = Buffer.from(
			await source.readAt(BigInt(INDEX_OFFSET), packedSize),
		);
		let table: Buffer;
		try {
			table = await inflateZlibBuffer(compressed);
		} catch {
			return undefined;
		}
		const entries = readPakV2Index(
			table,
			count,
			BigInt(INDEX_OFFSET) + BigInt(packedSize),
		);
		if (!entries) return undefined;
		const placed = entries.filter((entry) =>
			checkPlacement(entry.offset, entry.packedSize, source.size),
		);
		if (placed.length !== entries.length) return undefined;
		return { entries, version };
	}
	if (version !== VERSION_3) return undefined;
	const header = head.subarray(4, INDEX_OFFSET);
	let nameLength = 0;
	while (nameLength < V3_NAME_FIELD && header[nameLength] !== 0) {
		const byte = header[nameLength] ?? 0;
		if (byte >= 0x80 || byte < 0x20) return undefined;
		nameLength += 1;
	}
	if (nameLength === 0 || nameLength > V3_NAME_LIMIT) return undefined;
	const sizeXor = header.readUInt32LE(0x100);
	if (sizeXor !== V3_SIZE_XOR) return undefined;
	const key = nitroPakKey(header.subarray(0, nameLength), nameLength);
	const count = (header.readUInt32LE(0x108) ^ key) >>> 0;
	if (!isSaneCount(count)) return undefined;
	const headerSize = (header.readUInt32LE(0x10c) ^ sizeXor) >>> 0;
	if (BigInt(INDEX_OFFSET) + BigInt(headerSize) > source.size) return undefined;
	const compressed = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), headerSize),
	);
	let table: Buffer;
	try {
		table = await inflateZlibBuffer(compressed);
	} catch {
		return undefined;
	}
	const entries = readPakV3Index(
		table,
		count,
		BigInt(INDEX_OFFSET) + BigInt(headerSize),
	);
	if (!entries) return undefined;
	const placed = entries.filter((entry) =>
		checkPlacement(entry.offset, entry.packedSize, source.size),
	);
	if (placed.length !== entries.length) return undefined;
	return { entries, version };
}

function toFixedEntries(index: NitroPakIndex): FixedEntry[] {
	return index.entries.map((entry, id) => {
		const normalized = normalizeEntryPath(entry.path);
		return createFixedEntry({
			id,
			path: normalized.path,
			...(normalized.rawPath === undefined
				? {}
				: { rawPath: normalized.rawPath }),
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.packedSize,
			compressed: entry.compressed,
			encrypted: entry.encrypted,
			metadata: {
				type: "data",
				version: index.version,
				key: entry.key,
				unpackedField: entry.unpackedField.toString(),
			},
		});
	});
}

/** GARbro `PakOpener.OpenV3Entry`: the leading bytes are xored with the key, rotated by one byte per step. */
async function openV3Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const key = Number(entry.metadata?.key ?? 0) >>> 0;
	const size = Number(entry.size);
	const prefixSize = Math.min(size, V3_ENCRYPTED_PREFIX);
	const parts: Buffer[] = [];
	if (prefixSize > 0) {
		const remaining =
			source.size > entry.offset ? source.size - entry.offset : 0n;
		const available = Number(
			remaining < BigInt(prefixSize) ? remaining : BigInt(prefixSize),
		);
		const prefix = Buffer.from(await source.readAt(entry.offset, available));
		let rotated = key;
		for (let i = 0; i < prefix.length; i += 1) {
			prefix[i] = (prefix[i] ?? 0) ^ (rotated & 0xff);
			rotated = rotateRight(rotated);
		}
		parts.push(prefix);
	}
	const restSize = size - prefixSize;
	if (restSize > 0)
		parts.push(
			Buffer.from(
				await source.readAt(entry.offset + BigInt(prefixSize), restSize),
			),
		);
	return Readable.from(parts);
}

async function openNitroPakEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const version = Number(entry.metadata?.version ?? 0);
	if (version === VERSION_3 && !entry.compressed)
		return openV3Entry(source, entry);
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	if (!entry.compressed) return Readable.from([stored]);
	try {
		return Readable.from([await inflateZlibBuffer(stored, Number(entry.size))]);
	} catch {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Nitro+ packed payload");
	}
}

export const nitroplusNitroPakDescriptor: FormatDescriptor = {
	id: "nitroplus-nitro-pak",
	name: "Nitro+ resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/NitroPlus/ArcNitro.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nitroplusNitroPakFormat = defineFixedArchive({
	descriptor: nitroplusNitroPakDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([VERSION_2, 0, 0, 0]) },
			{ bytes: Buffer.from([VERSION_3, 0, 0, 0]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readNitroPak(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const index = await readNitroPak(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Nitro+ layout");
		return {
			entries: toFixedEntries(index),
			metadata: { version: index.version, entryCount: index.entries.length },
		};
	},
	openEntry: openNitroPakEntry,
});
