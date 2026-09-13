// Format reference: GARbro "ArcFormats/FC01/ArcMRG.cs", class `Mrg2Opener` (the Overture variant; the
// `MrgDecoder` codec of methods two and three is out of scope).
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
import { unpackMrgLzss } from "./mrg.js";

/** The header starts with the little endian spelling of `MRG\0`. */
const SIGNATURE = Buffer.from("MRG\0", "latin1");
const VERSION_OFFSET = 6;
const MIN_VERSION = 2;
const INDEX_SIZE_OFFSET = 8;
const COUNT_OFFSET = 0xc;
const HEADER_SIZE = 0x10;
/** Records are 0x57 bytes apart and the end offset reaches into the next record. */
const RECORD_SIZE = 0x57;
const NAME_SIZE = 0x40;
const UNPACKED_SIZE_OFFSET = 0x41;
const METHOD_OFFSET = 0x45;
const START_OFFSET_OFFSET = 0x4f;
const END_OFFSET_OFFSET = 0xa6;
/** The index is masked with a table built from the archive name and this constant. */
const INDEX_KEY = 0x285ee76f;
const TABLE_SIZE = 0x100;
const STORED_METHOD = 0;
const LZSS_METHOD = 1;
const MATCH_LITERAL_METHOD = 3;
/** Rotating the checksum left by sixteen bits is the same as swapping its halves. */
const CHECKSUM_ROTATION = 16;

interface Mrg2Entry {
	path: string;
	rawPath?: string;
	offset: number;
	size: number;
	method: number;
	unpackedSize: number;
	key: number;
	arcKey: number;
}

/**
 * GARbro `Mrg2Opener.GetNameChecksum`: the case folded characters are accumulated with a left shift,
 * the first character seeds the value and dots are skipped.
 */
function getNameChecksum(name: string): number {
	if (name.length === 0) return 0;
	const upper = name.toUpperCase();
	let checksum = upper.charCodeAt(0) >>> 0;
	for (let i = 0; i < upper.length; i += 1) {
		const code = upper.charCodeAt(i);
		if (code === 0x2e) continue;
		checksum = (checksum + code + (checksum << 6)) >>> 0;
	}
	return checksum;
}

/** GARbro `Mrg2Opener.Decrypt`: a 256 byte table generated from the two keys masks the payload. */
function decrypt(
	data: Buffer,
	start: number,
	length: number,
	checksum: number,
	key: number,
): void {
	const table = Buffer.alloc(TABLE_SIZE);
	let currentKey = key >>> 0;
	let currentChecksum = checksum >>> 0;
	for (let i = 0; i < TABLE_SIZE; i += 1) {
		const rotated =
			((currentChecksum << CHECKSUM_ROTATION) |
				(currentChecksum >>> CHECKSUM_ROTATION)) >>>
			0;
		const n = (currentKey + rotated) >>> 0;
		currentKey = currentChecksum;
		currentChecksum = (currentChecksum + n) >>> 0;
		table[i] = currentChecksum & 0xff;
	}
	for (let i = 0; i < length; i += 1) {
		const position = start + i;
		data[position] = (data[position] ?? 0) ^ (table[i & 0xff] ?? 0);
	}
}

/** GARbro `Mrg2Opener.TryOpen`. */
async function readMrg2Layout(
	source: ByteSource,
	sourcePath: string,
): Promise<Mrg2Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE) + 0x40n) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (header.readUInt16LE(VERSION_OFFSET) < MIN_VERSION) return undefined;
	const indexSize =
		(header.readUInt32LE(INDEX_SIZE_OFFSET) - HEADER_SIZE) >>> 0;
	if (indexSize < 0x40 || BigInt(indexSize) >= source.size) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(BigInt(HEADER_SIZE), indexSize));
	} catch {
		return undefined;
	}
	if (index.length !== indexSize) return undefined;
	const arcKey = getNameChecksum(sourcePath.replace(/^.*[/\\]/, ""));
	decrypt(index, 0, index.length, arcKey, INDEX_KEY);
	// The last record's end offset sits inside the index, so the table needs one field beyond it.
	if (index.length < (count - 1) * RECORD_SIZE + END_OFFSET_OFFSET + 4)
		return undefined;
	const entries: Mrg2Entry[] = [];
	let nextOffset = index.readUInt32LE(START_OFFSET_OFFSET) >>> 0;
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const rawName = decodeCStringField(index, position, NAME_SIZE);
		const entry: Mrg2Entry = {
			...normalizeEntryPath(rawName),
			offset: nextOffset,
			size: 0,
			method: index.readUInt16LE(position + METHOD_OFFSET),
			unpackedSize: index.readUInt32LE(position + UNPACKED_SIZE_OFFSET) >>> 0,
			key: 0,
			arcKey,
		};
		nextOffset = index.readUInt32LE(position + END_OFFSET_OFFSET) >>> 0;
		entry.size = (nextOffset - entry.offset) >>> 0;
		if (!checkPlacement(BigInt(entry.offset), BigInt(entry.size), source.size))
			return undefined;
		if (entry.method === STORED_METHOD) entry.key = getNameChecksum(rawName);
		entries.push(entry);
	}
	return entries.length > 0 ? entries : undefined;
}

export const mrg2Descriptor: FormatDescriptor = {
	id: "fc01-mrg2",
	name: "Overture engine resource archive",
	extensions: ["mrg"],
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

export const mrg2Format: ArchiveFormat = defineFixedArchive({
	descriptor: mrg2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMrg2Layout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readMrg2Layout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Overture MRG layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				compressed: entry.method !== STORED_METHOD,
				encrypted: entry.method === STORED_METHOD,
				metadata: {
					method: entry.method,
					unpackedSize: entry.unpackedSize,
					key: entry.key,
					arcKey: entry.arcKey,
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| {
					method?: number;
					unpackedSize?: number;
					key?: number;
					arcKey?: number;
			  }
			| undefined;
		const method = metadata?.method ?? 0;
		const unpackedSize = metadata?.unpackedSize ?? Number(entry.size);
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (method > MATCH_LITERAL_METHOD) return Readable.from([data]);
		if (method === STORED_METHOD) {
			// The reference passes the entry name checksum as the table seed and the archive name
			// checksum as the key, the other way round than the index decryption does.
			decrypt(data, 0, data.length, metadata?.key ?? 0, metadata?.arcKey ?? 0);
			return Readable.from([data]);
		}
		if (method !== LZSS_METHOD) {
			// Methods two and three need the `MrgDecoder` codec, which is out of scope, so their
			// payloads are passed through as they are stored.
			return Readable.from([data]);
		}
		if (unpackedSize === 0)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Overture MRG payload has no unpacked size",
			);
		return Readable.from([unpackMrgLzss(data, unpackedSize)]);
	},
});
