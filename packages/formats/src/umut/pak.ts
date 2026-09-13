// Format reference: GARbro ArcFormats/StudioJikkenshitsu/ArcUMPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
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
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("UMPK", "ascii");
const VERSION_MARKER = Buffer.from("0001", "ascii");
const NAME_LENGTH_OFFSET = 0x18;
/** The record area starts behind the header name plus a two-byte gap. */
const HEADER_NAME_BIAS = 0x1a;
const RECORD_FIELD_SIZE = 20;
const RESERVED_OFFSET = 0;
const COUNT_OFFSET = 8;
const RECORD_LENGTH_OFFSET = 0;
const SIZE_OFFSET = 4;
const OFFSET_OFFSET = 8;
const ID_OFFSET = 12;
const NAME_LENGTH_FIELD_OFFSET = 16;
const NAME_OFFSET = 20;
/** GARbro stores payload offsets relative to the end of the file header. */
const DATA_BIAS = 8;
const FALLBACK_KEY = 0x37;

export const umpkDescriptor: FormatDescriptor = {
	id: "umut-umpk",
	name: "UM Utility engine audio archive",
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
			source: "ArcFormats/StudioJikkenshitsu/ArcUMPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PakOpener.GetEntryKey`: the sum of the name's UTF-16 code units, the size, and the id,
 * folded into one byte that never becomes zero.
 */
function entryKey(name: string, size: bigint, id: number): number {
	let nameSum = 0n;
	for (let position = 0; position < name.length; position += 1)
		nameSum += BigInt(name.charCodeAt(position));
	let key = size + BigInt(id >>> 0);
	key =
		(key + nameSum + (key >> 8n) + (key >> 16n) + (key >> 24n)) & 0xffffffffn;
	const value = Number(key & 0xffn);
	return value === 0 ? FALLBACK_KEY : value;
}

interface UmpkIndex {
	entries: FixedEntry[];
	keys: Map<string, number>;
}

/**
 * GARbro `PakOpener.TryOpen`. The header name at 0x18 sizes the header, and the record area starts
 * behind it. The base holds a reserved word and the record count; records are variable length with
 * the record length first, the size, the data offset, an id, the name length, and the name.
 */
async function readUmpkIndex(
	source: ByteSource,
): Promise<UmpkIndex | undefined> {
	if (source.size < BigInt(NAME_LENGTH_OFFSET + 1)) return undefined;
	const header = await source.readAt(0n, NAME_LENGTH_OFFSET + 1);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!header.subarray(4, 4 + VERSION_MARKER.length).equals(VERSION_MARKER))
		return undefined;
	const headerNameLength = header[NAME_LENGTH_OFFSET] ?? 0;
	const baseOffset = BigInt(HEADER_NAME_BIAS + headerNameLength);
	if (baseOffset + BigInt(COUNT_OFFSET + 4) > source.size) return undefined;
	const base = await source.readAt(baseOffset, COUNT_OFFSET + 4);
	if (base.readUInt32LE(RESERVED_OFFSET) !== 0) return undefined;
	const count = base.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	const keys = new Map<string, number>();
	let position = baseOffset + BigInt(COUNT_OFFSET + 4);
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(NAME_OFFSET) > source.size) return undefined;
		const fields = await source.readAt(position, NAME_OFFSET);
		const recordLength = BigInt(fields.readUInt32LE(RECORD_LENGTH_OFFSET));
		const size = BigInt(fields.readUInt32LE(SIZE_OFFSET));
		const dataOffset = BigInt(fields.readUInt32LE(OFFSET_OFFSET));
		const entryId = fields.readUInt32LE(ID_OFFSET);
		const nameLength = fields.readUInt32LE(NAME_LENGTH_FIELD_OFFSET);
		if (position + BigInt(NAME_OFFSET + nameLength) > source.size)
			return undefined;
		const name = decodeCStringField(
			await source.readAt(position + BigInt(NAME_OFFSET), nameLength),
			0,
			nameLength,
		);
		const offset = BigInt(DATA_BIAS) + baseOffset + dataOffset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size,
			encrypted: true,
		});
		keys.set(entry.id, entryKey(name, size, entryId));
		entries.push(entry);
		position += recordLength + 4n;
	}
	return { entries, keys };
}

/** GARbro `PakOpener.OpenEntry`: payloads are XORed with their derived key. */
const umpkEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	const key = entry.metadata?.key;
	if (typeof key === "number" && key !== 0) {
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ key;
	}
	return Readable.from([payload]);
};

export const umpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readUmpkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readUmpkIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid UMPK audio archive");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { ...entry.metadata, key: index.keys.get(entry.id) ?? 0 },
		}));
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: umpkEntryOpener,
});
