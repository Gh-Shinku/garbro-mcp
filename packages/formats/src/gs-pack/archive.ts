// Format reference: GARbro ArcFormats/GsPack/ArcGsPack.cs, classes `PakOpener` and `DatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	decodeCStringField,
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { detectFileType } from "../shared/detect-type.js";

const PACK_MARKERS = ["DataPack5", "GsPack5", "GsPack4"];
const PACK_HEADER_SIZE = 0x48;
const PACK_MAJOR_FIELD = 0x32;
const PACK_INDEX_SIZE_FIELD = 0x34;
const PACK_ENCRYPTION_FIELD = 0x38;
const PACK_COUNT_FIELD = 0x3c;
const PACK_DATA_OFFSET_FIELD = 0x40;
const PACK_INDEX_OFFSET_FIELD = 0x44;
const PACK_MAX_INDEX_SIZE = 0xffffff;
const PACK_ENTRY_SIZE_V4 = 0x48;
const PACK_ENTRY_SIZE_V5 = 0x68;
const PACK_NAME_SIZE = 0x40;
const PACK_PAYLOAD_OFFSET_FIELD = 0x40;
const PACK_PAYLOAD_SIZE_FIELD = 0x44;
/** Bit zero encrypts the index, bit one the payloads. */
const PACK_INDEX_ENCRYPTED = 1;
const PACK_DATA_ENCRYPTED = 2;

const SYMBOL_MARKER = Buffer.from("GsSYMBOL5BINDATA", "latin1");
const SYMBOL_HEADER_SIZE = 0xd0;
const SYMBOL_HEADER_SIZE_FIELD = 0xa4;
const SYMBOL_COUNT_FIELD = 0xa8;
const SYMBOL_INDEX_OFFSET_FIELD = 0xb8;
const SYMBOL_INDEX_SIZE_FIELD = 0xbc;
const SYMBOL_KEY_FIELD = 0xc0;
const SYMBOL_UNPACKED_FIELD = 0xc4;
const SYMBOL_DATA_OFFSET_FIELD = 0xc8;
const SYMBOL_ENTRY_SIZE = 0x18;
const SYMBOL_OFFSET_FIELD = 0;
const SYMBOL_PACKED_SIZE_FIELD = 4;
const SYMBOL_UNPACKED_SIZE_FIELD = 8;
const NAME_DIGITS = 5;
const KEY_MULTIPLIER = 37;
const KEY_CASE_MASK = 0x20;

interface ArchiveEntry {
	name: string | undefined;
	type: string | undefined;
	offset: bigint;
	packedSize: bigint;
	unpackedSize: bigint;
	compressed: boolean;
}

/** `PakOpener.DecryptData`: a rolling key derived from the entry name, applied word by word. */
export function decryptGsPackData(data: Buffer, name: string): void {
	let key = 0;
	for (let index = 0; index < name.length; index += 1)
		key =
			(key * KEY_MULTIPLIER + (name.charCodeAt(index) | KEY_CASE_MASK | 0)) | 0;
	for (let offset = 0; offset + 4 <= data.length; offset += 4) {
		const value = data.readUInt32LE(offset);
		data.writeUInt32LE((value ^ key) >>> 0, offset);
	}
}

/**
 * `PakOpener.TryOpen`: a versioned header with an optional compressed index, and a payload table that
 * may be encrypted with a name derived key.
 */
async function readPackEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: ArchiveEntry[]; encrypted: boolean } | undefined> {
	if (source.size < BigInt(PACK_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, PACK_HEADER_SIZE);
	const text = header.toString("latin1");
	if (!PACK_MARKERS.some((marker) => text.startsWith(marker))) return undefined;
	const major = header.readUInt16LE(PACK_MAJOR_FIELD);
	const indexSize = header.readUInt32LE(PACK_INDEX_SIZE_FIELD);
	if (indexSize > PACK_MAX_INDEX_SIZE) return undefined;
	const encryption = header.readUInt32LE(PACK_ENCRYPTION_FIELD);
	const count = header.readInt32LE(PACK_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(PACK_DATA_OFFSET_FIELD));
	const indexOffset = BigInt(header.readInt32LE(PACK_INDEX_OFFSET_FIELD));
	const entrySize =
		major < PACK_ENTRY_SIZE_V5 ? PACK_ENTRY_SIZE_V4 : PACK_ENTRY_SIZE_V5;
	if (indexOffset < 0n) return undefined;
	const unpackedSize = count * entrySize;
	let index: Buffer;
	if (indexSize !== 0) {
		if (indexOffset + BigInt(indexSize) > source.size) return undefined;
		const packed = Buffer.from(await source.readAt(indexOffset, indexSize));
		if ((encryption & PACK_INDEX_ENCRYPTED) !== 0) {
			for (let position = 0; position < packed.length; position += 1)
				packed[position] = (packed[position] ?? 0) ^ (position & 0xff);
		}
		index = inflateLzss(packed, { outputLength: unpackedSize });
	} else {
		if (indexOffset + BigInt(unpackedSize) > source.size) return undefined;
		index = Buffer.from(await source.readAt(indexOffset, unpackedSize));
	}
	const archiveName = (sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase();
	const defaultType = archiveName.startsWith("image")
		? "image"
		: archiveName.startsWith("voice")
			? "audio"
			: undefined;
	const entries: ArchiveEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * entrySize;
		const name = decodeCStringField(index, base, PACK_NAME_SIZE);
		if (name.length !== 0) {
			const offset =
				dataOffset +
				BigInt(index.readUInt32LE(base + PACK_PAYLOAD_OFFSET_FIELD));
			const size = BigInt(index.readUInt32LE(base + PACK_PAYLOAD_SIZE_FIELD));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			const signature =
				size >= 4n && offset + 4n <= source.size
					? (await source.readAt(offset, 4)).readUInt32LE(0)
					: 0;
			const detected =
				defaultType === undefined ? detectFileType(signature) : undefined;
			entries.push({
				name,
				type: defaultType ?? detected?.type,
				offset,
				packedSize: size,
				unpackedSize: size,
				compressed: false,
			});
		}
	}
	if (entries.length === 0) return undefined;
	return { entries, encrypted: (encryption & PACK_DATA_ENCRYPTED) !== 0 };
}

/** `DatOpener.TryOpen`: a symbol table with an encrypted, compressed index. */
async function readSymbolEntries(
	source: ByteSource,
): Promise<ArchiveEntry[] | undefined> {
	if (source.size < BigInt(SYMBOL_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, SYMBOL_HEADER_SIZE);
	if (!header.subarray(0, SYMBOL_MARKER.length).equals(SYMBOL_MARKER))
		return undefined;
	const headerSize = header.readUInt32LE(SYMBOL_HEADER_SIZE_FIELD);
	if (headerSize < SYMBOL_HEADER_SIZE) return undefined;
	const count = header.readInt32LE(SYMBOL_COUNT_FIELD);
	const indexOffset = BigInt(header.readUInt32LE(SYMBOL_INDEX_OFFSET_FIELD));
	const indexSize = header.readUInt32LE(SYMBOL_INDEX_SIZE_FIELD);
	const key = header.readUInt32LE(SYMBOL_KEY_FIELD);
	const unpackedSize = header.readUInt32LE(SYMBOL_UNPACKED_FIELD);
	const dataOffset = BigInt(header.readUInt32LE(SYMBOL_DATA_OFFSET_FIELD));
	if (!isSaneCount(count) || count * SYMBOL_ENTRY_SIZE !== unpackedSize)
		return undefined;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const packed = Buffer.from(await source.readAt(indexOffset, indexSize));
	if (key !== 0) {
		for (let position = 0; position < packed.length; position += 1)
			packed[position] = (packed[position] ?? 0) ^ (position & key & 0xff);
	}
	const index = inflateLzss(packed, { outputLength: unpackedSize });
	const entries: ArchiveEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * SYMBOL_ENTRY_SIZE;
		const offset =
			dataOffset + BigInt(index.readUInt32LE(base + SYMBOL_OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(base + SYMBOL_PACKED_SIZE_FIELD));
		const unpacked = BigInt(
			index.readUInt32LE(base + SYMBOL_UNPACKED_SIZE_FIELD),
		);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			name: String(id).padStart(NAME_DIGITS, "0"),
			type: undefined,
			offset,
			packedSize: size,
			unpackedSize: unpacked,
			compressed: true,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(
	entries: readonly ArchiveEntry[],
	encrypted = false,
): FixedEntry[] {
	return entries.map((entry, id) => {
		const created = createFixedEntry({
			id,
			...normalizeEntryPath(
				entry.name ?? String(id).padStart(NAME_DIGITS, "0"),
			),
			offset: entry.offset,
			size: entry.unpackedSize,
			packedSize: entry.packedSize,
			compressed: entry.compressed,
			...(encrypted ? { encrypted: true } : {}),
			...(entry.type === undefined ? {} : { metadata: { type: entry.type } }),
		});
		return entry.unpackedSize === entry.packedSize
			? created
			: { ...created, sizeKnown: false };
	});
}

export const gsPackDescriptor: FormatDescriptor = {
	id: "gs-pack",
	name: "GsPack resource archive",
	extensions: ["pak", "dat", "pa_"],
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
			source: "ArcFormats/GsPack/ArcGsPack.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gsDataDescriptor: FormatDescriptor = {
	...gsPackDescriptor,
	id: "gs-data",
	name: "GsPack symbol archive",
	extensions: ["dat"],
};

export const gsPackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsPackDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("Data", "latin1") },
			{ bytes: Buffer.from("GsPa", "latin1") },
		],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPackEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readPackEntries(source, sourcePath);
		if (!result)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GsPack index");
		const entries = toFixedEntries(result.entries, result.encrypted);
		return {
			entries,
			metadata: { entryCount: entries.length, encrypted: result.encrypted },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize ?? entry.size)),
		);
		if (!entry.encrypted) return Readable.from([stored]);
		decryptGsPackData(stored, entry.rawPath ?? entry.path);
		return Readable.from([stored]);
	},
});

export const gsDataFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsDataDescriptor,
	detection: { signatures: [{ bytes: SYMBOL_MARKER.subarray(0, 4) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSymbolEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSymbolEntries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GsPack symbol index");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.packedSize === 0n || entry.packedSize === undefined)
			return Readable.from([Buffer.alloc(0)]);
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		return Readable.from([
			inflateLzss(stored, { outputLength: Number(entry.size) }),
		]);
	},
});
