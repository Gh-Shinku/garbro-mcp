// Format reference: GARbro "ArcFormats/Xuse/ArcWAG.cs", classes `WagOpener`, `WagArchive` and
// `IndexReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	encodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const TITLE_OFFSET = 6;
const TITLE_SIZE = 0x40;
const COUNT_OFFSET = 0x46;
const VERSION_OFFSET = 4;
const INDEX_BIAS = 0x200;
const INDEX_MODULUS = 0x401;
const INDEX_ADDEND = 0x4a;
const V2_ENTRY_HEADER = 0x10;
const V3_CHUNK_HEADER = 10;
const DRIVE_PREFIX = /^(?:.+:|\.\.)?\\+/;

/** `WagOpener.GenerateKey`: a keyword derived XOR key of at least 0x40 bytes. */
function generateKey(keyword: Buffer, length = keyword.length): Buffer {
	let hash = 0;
	for (let i = 0; i < length; i += 1) {
		const signed = ((keyword[i] ?? 0) << 24) >> 24;
		hash = (((signed + i) ^ hash) + length) | 0;
	}
	let keyLength = (hash & 0xff) + 0x40;
	for (let i = 0; i < length; i += 1) {
		const signed = ((keyword[i] ?? 0) << 24) >> 24;
		hash = (hash + signed) | 0;
	}
	const key = Buffer.alloc(keyLength);
	keyLength -= 1;
	key[1] = (hash >> 8) & 0xff;
	hash &= 0x0f;
	key[0] = hash & 0xff;
	key[2] = 0x46;
	key[3] = 0x88;
	for (let i = 4; i < keyLength; i += 1) {
		const signed = ((keyword[i % length] ?? 0) << 24) >> 24;
		hash = (hash + (((signed ^ hash) + i) & 0xff)) | 0;
		key[i] = hash & 0xff;
	}
	return key;
}

/**
 * `WagOpener.Decrypt`: a repeating XOR key whose period is one less than the key length, indexed by the
 * absolute archive offset of every byte.
 */
function decryptOffset(
	offset: number,
	key: Buffer,
	data: Buffer,
	length = data.length,
): void {
	const keyLast = key.length - 1;
	for (let i = 0; i < length; i += 1)
		data[i] = (data[i] ?? 0) ^ (key[(offset + i) % keyLast] ?? 0);
}

/** `IndexReader.ReadChunk`: a small decrypted window read from the archive. */
async function readChunk(
	source: ByteSource,
	offset: number,
	size: number,
	dataKey: Buffer,
): Promise<Buffer | undefined> {
	if (size < 0 || BigInt(offset) + BigInt(size) > source.size) return undefined;
	const data = Buffer.from(await source.readAt(BigInt(offset), size));
	decryptOffset(offset, dataKey, data);
	return data;
}

interface ParsedEntry {
	name: string;
	offset: number;
	size: number;
	type: string;
}

/** `IndexReader.ParseEntryV2`: a size, a name length and optionally a trailing name. */
async function parseEntryV2(
	source: ByteSource,
	entryOffset: number,
	entrySize: number,
	dataKey: Buffer,
): Promise<ParsedEntry | undefined> {
	const header = await readChunk(source, entryOffset, 8, dataKey);
	if (!header) return undefined;
	const dataSize = header.readUInt32LE(0);
	if (dataSize >= entrySize) return undefined;
	const nameLength = header.readInt32LE(4);
	const offset = entryOffset + V2_ENTRY_HEADER;
	let name = "";
	if (nameLength > 0) {
		const chunk = await readChunk(
			source,
			offset + dataSize,
			nameLength,
			dataKey,
		);
		if (!chunk) return undefined;
		let length = nameLength;
		if (chunk[length - 1] === 0x7c) length -= 1;
		name = decodeCp932(chunk.subarray(0, length));
	}
	return { name, offset, size: dataSize, type: "" };
}

/** `IndexReader.ParseEntryV3`: a `DSET` chunk holding `PICT` and `FTAG` chunks. */
async function parseEntryV3(
	source: ByteSource,
	entryOffset: number,
	entrySize: number,
	dataKey: Buffer,
): Promise<ParsedEntry | undefined> {
	const header = await readChunk(source, entryOffset, 8, dataKey);
	if (!header) return undefined;
	if (header.toString("latin1", 0, 4) !== "DSET") return undefined;
	const chunkCount = header.readInt32LE(4);
	let chunkOffset = entryOffset + V3_CHUNK_HEADER;
	let offset = entryOffset;
	let size = entrySize;
	let type = "";
	let filename: string | undefined;
	for (let chunk = 0; chunk < chunkCount; chunk += 1) {
		const chunkHeader = await readChunk(source, chunkOffset, 8, dataKey);
		if (!chunkHeader) return undefined;
		const chunkSize = chunkHeader.readInt32LE(4);
		if (chunkSize <= 0) return undefined;
		const tag = chunkHeader.toString("latin1", 0, 4);
		if (tag === "PICT" && type.length === 0) {
			type = "image";
			offset = chunkOffset + V2_ENTRY_HEADER;
			size = chunkSize - 6;
		} else if (filename === undefined && tag === "FTAG") {
			const data = await readChunk(
				source,
				chunkOffset + V3_CHUNK_HEADER,
				chunkSize - 2,
				dataKey,
			);
			if (!data) return undefined;
			filename = decodeCp932(data);
		}
		chunkOffset += V3_CHUNK_HEADER + chunkSize;
	}
	return {
		name: filename === undefined ? "" : filename.replace(DRIVE_PREFIX, ""),
		offset,
		size,
		type,
	};
}

interface WagIndex {
	entries: ParsedEntry[];
	dataKey: Buffer;
	title: Buffer;
	version: number;
}

/** `WagOpener.TryOpen` and `IndexReader.ReadIndex`. */
async function buildWagIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<WagIndex | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = Buffer.from(await source.readAt(0n, COUNT_OFFSET + 4));
	const version = header.readUInt16LE(VERSION_OFFSET);
	if (version !== 0x300 && version !== 0x200) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const title = header.subarray(TITLE_OFFSET, TITLE_OFFSET + TITLE_SIZE);
	const terminator = title.indexOf(0);
	const titleLength = terminator === -1 ? title.length : terminator;
	const rawName = sourcePath.split(/[\\/]/).pop() ?? "";
	const arcFilename = version === 0x200 ? rawName : rawName.toLowerCase();
	const baseFilename = arcFilename.replace(/\.[^.]*$/, "");
	const nameKey = generateKey(encodeCp932(arcFilename));
	const nameSum = nameKey.reduce((total, value) => total + value, 0);
	let indexOffset = (INDEX_BIAS + nameSum) >>> 0;
	// The reference applies the same rotation loop twice.
	for (let pass = 0; pass < 2; pass += 1) {
		for (const value of nameKey) {
			indexOffset = (indexOffset ^ value) >>> 0;
			indexOffset = ((indexOffset >>> 1) | (indexOffset << 31)) >>> 0;
		}
	}
	indexOffset = (indexOffset % INDEX_MODULUS) + INDEX_ADDEND;
	if (BigInt(indexOffset) + BigInt(4 * count) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(indexOffset), 4 * count),
	);
	const indexKey = Buffer.alloc(index.length);
	for (let i = 0; i < indexKey.length; i += 1) {
		const value =
			(nameKey[(i + 1) % nameKey.length] ?? 0) ^
			(((nameKey[i % nameKey.length] ?? 0) + i) & 0xff);
		indexKey[i] = (count + value) & 0xff;
	}
	decryptOffset(indexOffset, indexKey, index);
	const dataKey = generateKey(title, titleLength);
	const entries: ParsedEntry[] = [];
	let currentOffset = 0;
	let nextOffset = index.readUInt32LE(currentOffset);
	for (let i = 0; i < count; i += 1) {
		currentOffset += 4;
		const entryOffset = nextOffset;
		if (BigInt(entryOffset) >= source.size) return undefined;
		nextOffset =
			i + 1 === count ? Number(source.size) : index.readUInt32LE(currentOffset);
		const entrySize = nextOffset - entryOffset;
		const parsed =
			version === 0x200
				? await parseEntryV2(source, entryOffset, entrySize, dataKey)
				: await parseEntryV3(source, entryOffset, entrySize, dataKey);
		if (!parsed) return undefined;
		if (parsed.name.length === 0)
			parsed.name = `${baseFilename}#${i.toString().padStart(4, "0")}`;
		entries.push(parsed);
	}
	return { entries, dataKey, title, version };
}

export const xuseWagDescriptor: FormatDescriptor = {
	id: "xuse-wag",
	name: "Xuse/Eternal resource archive",
	extensions: ["wag", "4ag", "004"],
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
			source: "ArcFormats/Xuse/ArcWAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const xuseWagFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseWagDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("WAG@", "latin1") },
			{ bytes: Buffer.from("GAF4", "latin1") },
		],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await buildWagIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await buildWagIndex(source, sourcePath);
		if (!index) throw new GarbroError("INVALID_ARCHIVE", "Invalid WAG index");
		const fixed: FixedEntry[] = index.entries.map((entry, id) => {
			const metadata: Record<string, unknown> = {
				// The entry payload is decrypted with a key derived from the archive title.
				title: Buffer.from(index.title),
			};
			if (entry.type.length > 0) metadata.type = entry.type;
			return createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				packedSize: BigInt(entry.size),
				encrypted: true,
				metadata,
			});
		});
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length, version: index.version },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.size === 0n) return Readable.from([]);
		const metadata = entry.metadata as { title?: Buffer } | undefined;
		const title = metadata?.title ?? Buffer.alloc(0);
		const terminator = title.indexOf(0);
		const titleLength = terminator === -1 ? title.length : terminator;
		const offset = Number(entry.offset ?? 0n);
		const size = Number(entry.size);
		const data = Buffer.from(await source.readAt(entry.offset ?? 0n, size));
		decryptOffset(offset, generateKey(title, titleLength), data);
		return Readable.from([data]);
	},
});
