// Format reference: GARbro ArcFormats/Nexas/ArcPAC.cs, classes `PacOpener` and `IndexReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	decompressHuffman,
	inflateLzss,
	inflateZlibBuffer,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive starts with `PAC` but a `K` behind it belongs to the older `PACK` format. */
const SIGNATURE = "PAC";
const EXCLUDED_BYTE = 0x4b;
const COUNT_FIELD = 4;
const METHOD_FIELD = 8;
/** The old index sits right behind the header and stores fixed length names. */
const OLD_INDEX_OFFSET = 0xc;
const OLD_NAME_LENGTHS: readonly number[] = [0x20, 0x40];
/** The new index is a complemented, huffman coded block at the end of the file. */
const NEW_NAME_LENGTH = 0x40;
const NEW_RECORD_SIZE = 0x4c;
const INDEX_SIZE_FIELD = 4;

/** GARbro `Compression`. */
const METHOD_NONE = 0;
const METHOD_LZSS = 1;
const METHOD_HUFFMAN = 2;
const METHOD_DEFLATE_OR_NONE = 4;

interface NexasEntry {
	name: string;
	offset: bigint;
	unpackedSize: bigint;
	storedSize: bigint;
	packed: boolean;
}

interface NexasIndex {
	entries: NexasEntry[];
	method: number;
}

/** Reads one fixed length name, cut at its first NUL, from a buffer. */
function readFixedName(data: Buffer, cursor: number, length: number): string {
	const field = data.subarray(cursor, cursor + length);
	const end = field.indexOf(0);
	return decodeCp932(end === -1 ? field : field.subarray(0, end));
}

/**
 * GARbro `IndexReader.ReadFromStream`: the records of both index layouts. A blank name or a record that leaves
 * the file fails the whole attempt, which is what makes the reader try the next layout.
 */
function readRecords(
	data: Buffer,
	count: number,
	nameLength: number,
	maxOffset: bigint,
): NexasEntry[] | undefined {
	const entries: NexasEntry[] = [];
	let cursor = 0;
	for (let i = 0; i < count; i += 1) {
		const recordSize = nameLength + 12;
		if (cursor + recordSize > data.length) return undefined;
		const name = readFixedName(data, cursor, nameLength);
		cursor += nameLength;
		if (name.trim() === "") return undefined;
		const offset = BigInt(data.readUInt32LE(cursor));
		const unpackedSize = BigInt(data.readUInt32LE(cursor + 4));
		const storedSize = BigInt(data.readUInt32LE(cursor + 8));
		cursor += 12;
		if (!checkPlacement(offset, storedSize, maxOffset)) return undefined;
		entries.push({
			name,
			offset,
			unpackedSize,
			storedSize,
			packed: false,
		});
	}
	return entries;
}

/** GARbro `IndexReader.ReadNew`: the complemented huffman block that ends with its own size word. */
async function readNewIndex(
	source: ByteSource,
	count: number,
): Promise<NexasEntry[] | undefined> {
	if (source.size < BigInt(INDEX_SIZE_FIELD)) return undefined;
	const trailer = Buffer.from(
		await source.readAt(
			source.size - BigInt(INDEX_SIZE_FIELD),
			INDEX_SIZE_FIELD,
		),
	);
	const indexSize = Number(trailer.readUInt32LE(0));
	const unpackedSize = count * NEW_RECORD_SIZE;
	if (BigInt(indexSize) >= source.size || indexSize > unpackedSize * 2)
		return undefined;
	const start = source.size - BigInt(INDEX_SIZE_FIELD) - BigInt(indexSize);
	if (start < 0n) return undefined;
	const packed = Buffer.from(await source.readAt(start, indexSize));
	for (let i = 0; i < packed.length; i += 1)
		packed[i] = ~(packed[i] ?? 0) & 0xff;
	let index: Buffer;
	try {
		index = decompressHuffman(packed, unpackedSize);
	} catch {
		return undefined;
	}
	return readRecords(index, count, NEW_NAME_LENGTH, source.size);
}

async function readNexas(source: ByteSource): Promise<NexasIndex | undefined> {
	if (source.size < BigInt(OLD_INDEX_OFFSET)) return undefined;
	const head = Buffer.from(
		await source.readAt(0n, Math.min(Number(source.size), OLD_INDEX_OFFSET)),
	);
	if (head.subarray(0, SIGNATURE.length).toString("latin1") !== SIGNATURE)
		return undefined;
	if (head[3] === EXCLUDED_BYTE) return undefined;
	const count = head.readInt32LE(COUNT_FIELD);
	const method = head.readInt32LE(METHOD_FIELD);
	if (!isSaneCount(count)) return undefined;
	// The old layout is tried first, with thirty-two byte names and then with sixty-four byte names.
	for (const nameLength of OLD_NAME_LENGTHS) {
		const size = BigInt(OLD_INDEX_OFFSET + count * (nameLength + 12));
		if (size > source.size) continue;
		const data = Buffer.from(
			await source.readAt(
				BigInt(OLD_INDEX_OFFSET),
				Number(size) - OLD_INDEX_OFFSET,
			),
		);
		const entries = readRecords(data, count, nameLength, source.size);
		if (!entries) continue;
		return { entries: markPacked(entries, method), method };
	}
	// The new layout keeps its index at the end of the file.
	const entries = await readNewIndex(source, count);
	if (!entries) return undefined;
	return { entries: markPacked(entries, method), method };
}

/** GARbro marks an entry packed unless the archive is stored and the method keeps both sizes equal. */
function markPacked(entries: NexasEntry[], method: number): NexasEntry[] {
	for (const entry of entries)
		entry.packed =
			method !== METHOD_NONE &&
			(method !== METHOD_DEFLATE_OR_NONE ||
				entry.storedSize !== entry.unpackedSize);
	return entries;
}

function toFixedEntries(index: NexasIndex): FixedEntry[] {
	return index.entries.map((entry, id) =>
		createFixedEntry({
			id,
			path: entry.name,
			offset: entry.offset,
			size: entry.packed ? entry.unpackedSize : entry.storedSize,
			packedSize: entry.storedSize,
			compressed: entry.packed,
			metadata: { type: "data", method: index.method },
		}),
	);
}

/**
 * GARbro `PacOpener.OpenEntry` dispatches on the method word of the header: the LZSS and huffman methods decode
 * to the declared unpacked size, while the deflate method and any unknown value use a zlib stream.
 */
async function openNexasEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	if (!entry.compressed) return Readable.from([stored]);
	const method = Number(entry.metadata?.method ?? METHOD_DEFLATE_OR_NONE);
	if (method === METHOD_LZSS)
		return Readable.from([
			inflateLzss(stored, { outputLength: Number(entry.size) }),
		]);
	if (method === METHOD_HUFFMAN)
		return Readable.from([decompressHuffman(stored, Number(entry.size))]);
	try {
		return Readable.from([await inflateZlibBuffer(stored, Number(entry.size))]);
	} catch {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid NeXAS packed payload");
	}
}

export const nexasPacDescriptor: FormatDescriptor = {
	id: "nexas-pac",
	name: "NeXAS engine resource archive",
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
			source: "ArcFormats/Nexas/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nexasPacFormat = defineFixedArchive({
	descriptor: nexasPacDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(SIGNATURE, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readNexas(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const index = await readNexas(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NeXAS layout");
		return {
			entries: toFixedEntries(index),
			metadata: { entryCount: index.entries.length, method: index.method },
		};
	},
	openEntry: openNexasEntry,
});
