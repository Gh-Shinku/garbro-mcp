// Format reference: GARbro ArcFormats/NitroPlus/ArcPAK.cs, class `PakOpener` (tag `PAK/MAGI`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream, inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference accepts version 3 and 4 and reads the raw word at offset 0. */
const VERSIONS = new Set([3, 4]);
const VERSION_FIELD = 0;
const COUNT_FIELD = 4;
const INDEX_SIZE_FIELD = 0xc;
/** The zlib-compressed index starts after the fixed 0x118-byte header. */
const INDEX_OFFSET = 0x118;
/** Directory records carry three extra words that the reference skips. */
const DIRECTORY_EXTRA_SIZE = 20;
/** Payload offsets are relative to the end of the compressed index. */
const OFFSET_SIZE = 4;
const UNPACKED_SIZE_SIZE = 4;
const UNUSED_SIZE = 4;
const PACKED_FLAG_SIZE = 4;
const PACKED_SIZE_SIZE = 4;
const ENTRY_RECORD_SIZE =
	OFFSET_SIZE +
	UNPACKED_SIZE_SIZE +
	UNUSED_SIZE +
	PACKED_FLAG_SIZE +
	PACKED_SIZE_SIZE;

export const nitroplusPakDescriptor: FormatDescriptor = {
	id: "nitroplus-pak",
	name: "MAGI engine resource archive",
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
			source: "ArcFormats/NitroPlus/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Mirror of `Path.Combine` for the relative archive names the reference produces. */
function combinePath(directory: string, name: string): string {
	if (directory.length === 0) return name;
	if (/^([A-Za-z]:|[\\/])/.test(name)) return name;
	const separator = /[\\/]$/.test(directory) ? "" : "\\";
	return `${directory}${separator}${name}`;
}

/** The reference reads a `name_length`-byte CP932 field and stops it at the first zero byte. */
function readName(index: Buffer, position: number): string | undefined {
	if (position + 4 > index.length) return undefined;
	const nameLength = index.readInt32LE(position);
	if (nameLength <= 0) return undefined;
	const field = position + 4;
	if (field + nameLength > index.length) return undefined;
	return decodeCStringField(index, field, nameLength);
}

interface MagiIndex {
	version: number;
	entries: FixedEntry[];
}

/**
 * GARbro `PakOpener.TryOpen`. The header holds the archive version (3 or 4), the entry count and the
 * size of a zlib-compressed index that starts at 0x118; payload offsets are relative to the end of
 * that index. Version 4 records may be directories, which update a running directory prefix for the
 * entries that follow them. Packed entries are stored with a declared packed size and a separate
 * unpacked size, and are decoded as zlib streams.
 */
async function readMagiPaK(source: ByteSource): Promise<MagiIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const version = header.readInt32LE(VERSION_FIELD);
	if (!VERSIONS.has(version)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	if (indexSize < 2n || indexSize > source.size) return undefined;
	const available = Number(
		source.size - BigInt(INDEX_OFFSET) < indexSize
			? source.size - BigInt(INDEX_OFFSET)
			: indexSize,
	);
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(
			await source.readAt(BigInt(INDEX_OFFSET), available),
		);
	} catch {
		return undefined;
	}
	const baseOffset = BigInt(INDEX_OFFSET) + indexSize;

	const entries: FixedEntry[] = [];
	let position = 0;
	let currentDirectory = "";
	for (let id = 0; id < count; id += 1) {
		const name = readName(index, position);
		if (name === undefined) return undefined;
		position += 4 + index.readInt32LE(position);
		let entryName = name;
		if (version > 3) {
			if (position + 4 > index.length) return undefined;
			const isDirectory = index.readInt32LE(position) !== 0;
			position += 4;
			if (isDirectory) {
				currentDirectory = name;
				position += DIRECTORY_EXTRA_SIZE;
				if (position > index.length) return undefined;
				continue;
			}
			entryName = combinePath(currentDirectory, name);
		}
		if (position + ENTRY_RECORD_SIZE > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(position)) + baseOffset;
		const unpackedSize = BigInt(index.readUInt32LE(position + 4));
		const packed = index.readUInt32LE(position + 12);
		const packedSize = BigInt(index.readUInt32LE(position + 16));
		position += ENTRY_RECORD_SIZE;
		const compressed = packed !== 0 && packedSize !== 0n;
		const size = compressed ? packedSize : unpackedSize;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(entryName),
				offset,
				size: unpackedSize,
				packedSize: compressed ? packedSize : unpackedSize,
				compressed,
			}),
		);
	}
	return { version, entries };
}

/**
 * GARbro `PakOpener.OpenEntry`. Packed entries are zlib streams; everything else is emitted
 * verbatim.
 */
export const nitroplusPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nitroplusPakDescriptor,
	detection: {
		signatures: [...VERSIONS].map((version) => {
			const bytes = Buffer.alloc(4);
			bytes.writeInt32LE(version);
			return { bytes };
		}),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMagiPaK(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readMagiPaK(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MAGI PAK layout");
		return {
			entries: index.entries,
			metadata: { entryCount: index.entries.length, version: index.version },
		};
	},
	async openEntry(source, entry) {
		if (!entry.compressed)
			return source.createReadStream(entry.offset, entry.packedSize);
		return createZlibInflateStream(
			source.createReadStream(entry.offset, entry.packedSize),
		);
	},
});
