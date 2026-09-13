// Format reference: GARbro "ArcFormats/Rits/ArcSAF.cs", classes `SafOpener`, `SafIndexReader5`
// and `SafIndexReader6`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzssAll, inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const VERSION_MASK = 0xff00;
const VERSION5 = 0x500;
const VERSION6 = 0x600;
const DEFAULT_KEY5 = 0xdf;
const DEFAULT_KEY6 = 0xef;
const NAME_FIELD_SIZE = 0x14;
const OFFSET_SHIFT = 11;
const LZSS_VERSION_BIT = 0x2;
/** Guards against cyclic directory references the reference walk would follow forever. */
const MAX_DIRECTORY_DEPTH = 64;

interface SafEntry {
	path: string;
	offset: bigint;
	size: number;
	unpackedSize: number;
}

interface Version5Layout {
	entrySize: number;
	offsetPos: number;
	sizePos: number;
	unpackedPos: number;
	dirIndexPos: number;
	dirCountPos: number;
}

const LAYOUT5: Version5Layout = {
	entrySize: 0x20,
	offsetPos: 0x14,
	sizePos: 0x18,
	unpackedPos: 0x1c,
	dirIndexPos: 0x14,
	dirCountPos: 0x1c,
};

const LAYOUT6: Version5Layout = {
	entrySize: 16,
	offsetPos: 4,
	sizePos: 8,
	unpackedPos: 12,
	dirIndexPos: 4,
	dirCountPos: 12,
};

/** `DecryptIndex` and `DecryptIndexV6`: a per record XOR with a counting key. */
function decryptIndex(
	data: Buffer,
	count: number,
	entrySize: number,
	startKey: number,
): void {
	let offset = 0;
	for (let record = 0; record < count; record += 1) {
		let key = startKey;
		for (let i = 0; i < entrySize; i += 1) {
			data[offset] = (data[offset] ?? 0) ^ key;
			offset += 1;
			key = (key + 1) & 0xff;
		}
	}
}

/** `DecryptNames`: a descending XOR over the whole name blob. */
function decryptNames(data: Buffer): void {
	let key = 0xff;
	for (let i = 0; i < data.length; i += 1) {
		data[i] = (data[i] ?? 0) ^ key;
		key = (key - 1) & 0xff;
	}
}

/** Reads a null terminated CP932 string out of an in-memory blob. */
function cstringFromBuffer(buffer: Buffer, offset: number): string | undefined {
	if (offset < 0 || offset >= buffer.length) return undefined;
	const end = buffer.indexOf(0, offset);
	return decodeCp932(buffer.subarray(offset, end === -1 ? buffer.length : end));
}

interface IndexReader {
	count: number;
	isDir(record: number): boolean;
	readName(record: number): string | undefined;
	field(record: number, position: number): number;
}

function createReader5(index: Buffer, count: number): IndexReader {
	return {
		count,
		isDir: (record) => (index[record * LAYOUT5.entrySize] ?? 0) > 0x7f,
		readName: (record) => {
			const pos = record * LAYOUT5.entrySize;
			index[pos] = (index[pos] ?? 0) & 0x7f;
			const name = decodeCp932(index.subarray(pos, pos + NAME_FIELD_SIZE));
			return name.replace(/[\s\0]+$/u, "");
		},
		field: (record, position) =>
			index.readInt32LE(record * LAYOUT5.entrySize + position),
	};
}

function createReader6(
	index: Buffer,
	names: Buffer,
	count: number,
): IndexReader {
	return {
		count,
		isDir: (record) => (index[record * LAYOUT6.entrySize + 3] ?? 0) > 0x7f,
		readName: (record) => {
			const nameOffset =
				index.readInt32LE(record * LAYOUT6.entrySize) & 0x7fffffff;
			return cstringFromBuffer(names, nameOffset);
		},
		field: (record, position) =>
			index.readInt32LE(record * LAYOUT6.entrySize + position),
	};
}

/** `SafIndexReader5.Scan` and its recursive `ReadDir`. */
function scanIndex(
	reader: IndexReader,
	layout: Version5Layout,
): SafEntry[] | undefined {
	const entries: SafEntry[] = [];
	let rootName = "";
	let rootIndex = 0;
	let rootCount = reader.count;
	let ignoreDirectories = false;
	if (reader.isDir(0)) {
		const name = reader.readName(0);
		if (name === undefined) return undefined;
		rootName = name === "root" ? "" : name;
		rootIndex = reader.field(0, layout.dirIndexPos);
		rootCount = reader.field(0, layout.dirCountPos);
	} else {
		ignoreDirectories = true;
	}
	const walk = (
		dirName: string,
		index: number,
		count: number,
		depth: number,
	): boolean => {
		if (depth > MAX_DIRECTORY_DEPTH) return false;
		if (index < 0 || count < 0 || index + count > reader.count) return false;
		for (let i = 0; i < count; i += 1) {
			const record = index + i;
			if (reader.isDir(record)) {
				if (ignoreDirectories) continue;
				const subdirIndex = reader.field(record, layout.dirIndexPos);
				if (subdirIndex < index + count) continue;
				const subdirName = reader.readName(record);
				if (subdirName === undefined) return false;
				const subdirCount = reader.field(record, layout.dirCountPos);
				if (
					!walk(
						dirName === "" ? subdirName : `${dirName}/${subdirName}`,
						subdirIndex,
						subdirCount,
						depth + 1,
					)
				)
					return false;
			} else {
				const name = reader.readName(record);
				if (name === undefined) return false;
				const rawOffset = reader.field(record, layout.offsetPos);
				const size = reader.field(record, layout.sizePos);
				const unpackedSize = reader.field(record, layout.unpackedPos);
				if (rawOffset < 0 || size < 0 || unpackedSize < 0) return false;
				entries.push({
					path: dirName === "" ? name : `${dirName}/${name}`,
					offset: BigInt(rawOffset) << BigInt(OFFSET_SHIFT),
					size,
					unpackedSize,
				});
			}
		}
		return true;
	};
	if (!walk(rootName, rootIndex, rootCount, 0)) return undefined;
	return entries;
}

async function readSafEntries(
	source: ByteSource,
): Promise<{ entries: SafEntry[]; lzss: boolean } | undefined> {
	if (source.size < 4n) return undefined;
	const header = await source.readAt(0n, 4);
	const id = header.readUInt16LE(0);
	const count = header.readInt16LE(2);
	if (!isSaneCount(count)) return undefined;
	let reader: IndexReader;
	let layout: Version5Layout;
	if ((id & VERSION_MASK) === VERSION5) {
		const indexSize = 0x20 * count;
		if (4n + BigInt(indexSize) > source.size) return undefined;
		const index = Buffer.from(await source.readAt(4n, indexSize));
		if (id === 0x501) decryptIndex(index, count, 0x20, DEFAULT_KEY5);
		reader = createReader5(index, count);
		layout = LAYOUT5;
	} else if ((id & VERSION_MASK) === VERSION6) {
		if (source.size < 8n) return undefined;
		const namesLength = (await source.readAt(4n, 4)).readInt32LE(0);
		if (namesLength <= 0 || BigInt(namesLength) >= source.size)
			return undefined;
		const indexSize = count * 16;
		if (8n + BigInt(indexSize) + BigInt(namesLength) > source.size)
			return undefined;
		const index = Buffer.from(await source.readAt(8n, indexSize));
		const names = Buffer.from(
			await source.readAt(8n + BigInt(indexSize), namesLength),
		);
		if ((id & 1) !== 0) {
			decryptIndex(index, count, 16, DEFAULT_KEY6);
			decryptNames(names);
		}
		reader = createReader6(index, names, count);
		layout = LAYOUT6;
	} else {
		return undefined;
	}
	const entries = scanIndex(reader, layout);
	if (!entries || entries.length === 0) return undefined;
	for (const entry of entries) {
		if (!checkPlacement(entry.offset, BigInt(entry.size), source.size))
			return undefined;
	}
	return { entries, lzss: (id & LZSS_VERSION_BIT) !== 0 };
}

export const ritsSafDescriptor: FormatDescriptor = {
	id: "rits-saf",
	name: "Rit's resource archive",
	extensions: ["saf"],
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
			source: "ArcFormats/Rits/ArcSAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ritsSafFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ritsSafDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSafEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readSafEntries(source);
		if (!index) throw new GarbroError("INVALID_ARCHIVE", "Invalid SAF index");
		const entries: FixedEntry[] = index.entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.path),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.size),
				compressed: entry.unpackedSize !== 0,
				metadata: { unpackedSize: entry.unpackedSize },
			});
			return entry.unpackedSize !== 0
				? { ...created, sizeKnown: false }
				: created;
		});
		return {
			entries,
			metadata: { entryCount: entries.length, lzss: index.lzss },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = await source.readAt(entry.offset, Number(entry.packedSize));
		if (!entry.compressed) return Readable.from([Buffer.from(stored)]);
		const header = await source.readAt(0n, 2);
		const lzss = (header.readUInt16LE(0) & LZSS_VERSION_BIT) !== 0;
		if (lzss) return Readable.from([inflateLzssAll(stored)]);
		return Readable.from([await inflateZlibBuffer(stored)]);
	},
});
