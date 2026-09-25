// Port of GARbro "ArcFormats/Primel/ArcPCF.cs" (tag "PCF", classes `PcfOpener`, `PcfArchive`,
// `PcfIndexReader`, `PrimelScheme` and `PrimelSchemeV2`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The archive of the Primel ADV System engine spells `PackCode` at its head, of the count of its entries at
// 0x08 and of the places of the rest of its head behind that: the count of the places of the block of its
// entries, the place of its index within that block and the count of the places of the index, the flags of
// the index and a key of eight places. The block of the entries stands at the **end** of the file - of the
// count of its places read from the head - and both the index and the place of every entry stand of that
// block rather than of the file.
//
// The index is read with one of two schemes: the older one of the engine's own SHA-256, whose round is not
// that of the standard, and the newer one of the SHA-256 of the standard. The one the flags name then
// stands of the places of every entry as well. A scheme spells a key of sixteen places out of the eight
// places of the head, of the hash of them folded onto itself a place at a time, and a place of the chaining
// out of the same walk over that key; the flags then name the cipher (one of the three of the engine, `RC6`,
// or AES of a segment of one byte) and one or two of the four packed streams of `Compression.cs`.

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { primelSha256, PrimelCipher, Rc6, AesCfb8 } from "@garbro-mcp/codecs";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import {
	unpackPrimelLzss,
	unpackPrimelMtf,
	unpackPrimelRange,
	unpackPrimelRle,
} from "@garbro-mcp/codecs";

const SIGNATURE = Buffer.from("Pack", "ascii");
const MARKER = Buffer.from("Code", "ascii");
const MARKER_OFFSET = 4;
const COUNT_OFFSET = 8;
const DATA_PLACES_AT = 0x10;
const INDEX_PLACES_AT = 0x28;
const INDEX_SIZE_AT = 0x30;
const INDEX_FLAGS_AT = 0x38;
const INDEX_KEY_AT = 0x58;
const HEAD_SIZE = 0x60;
/** The places of a record of the index, and of the places of the name within it. */
const RECORD_SIZE = 0x80;
const NAME_LIMIT = 0x50;
const ENTRY_PLACES_AT = 0x50;
const ENTRY_UNPACKED_AT = 0x58;
const ENTRY_SIZE_AT = 0x60;
const ENTRY_FLAGS_AT = 0x68;
const ENTRY_KEY_AT = 0x78;
const ENTRY_KEY_PLACES = 8;
/** The flags of an entry: the cipher over the places of it, and the streams behind it. */
const CIPHER_MASK = 0xf0000;
const CIPHER_ONE = 0x10000;
const CIPHER_TWO = 0x20000;
const CIPHER_THREE = 0x30000;
const CIPHER_RC6 = 0x80000;
const CIPHER_AES = 0xa0000;
const RANGE_FLAG = 0xff;
const STREAM_MASK = 0xf00;
const STREAM_RLE_MTF = 0x400;
const STREAM_LZSS = 0x700;
/** The places of a key of a scheme, and of the key and the place of the chaining of a cipher. */
const KEY_PLACES = 0x10;
const SEED_PLACES = 8;

/** The two schemes the reference tries in turn, of the hash their keys stand of. */
export type PrimelSchemeKind = "primel" | "standard";

/** The head of the archive: the count of its entries and the places of the block of them. */
export interface PcfLayout {
	count: number;
	dataPlaces: bigint;
	indexPlaces: bigint;
	indexSize: number;
	flags: number;
	key: Buffer;
}

/** An entry of the index, before the block of the entries is turned into places of the file. */
export interface PcfRecord {
	name: string;
	offset: bigint;
	unpackedSize: number;
	size: number;
	flags: number;
	key: Buffer;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `PcfOpener.TryOpen` and `PcfIndexReader.Read`: the head of the archive. */
export function readPcfLayout(data: Buffer): PcfLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!data.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length).equals(MARKER)
	)
		return undefined;
	const count = data.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataPlaces = data.readBigInt64LE(DATA_PLACES_AT);
	const indexPlaces = data.readBigInt64LE(INDEX_PLACES_AT);
	if (dataPlaces < 0n || indexPlaces < 0n) return undefined;
	const indexSize = data.readUInt32LE(INDEX_SIZE_AT);
	return {
		count,
		dataPlaces,
		indexPlaces,
		indexSize,
		flags: data.readUInt32LE(INDEX_FLAGS_AT),
		key: Buffer.from(data.subarray(INDEX_KEY_AT, INDEX_KEY_AT + SEED_PLACES)),
	};
}

/** `PcfIndexReader.ReadIndex`: the records of an index, of the count the head names. */
export function readPcfIndex(
	index: Buffer,
	count: number,
	base: bigint,
	archiveSize: bigint,
): PcfRecord[] | undefined {
	const records: PcfRecord[] = [];
	for (let at = 0; at < count; at += 1) {
		const from = at * RECORD_SIZE;
		if (from + RECORD_SIZE > index.length) break;
		const name = decodeCStringField(index, from, NAME_LIMIT);
		const offset = base + index.readBigInt64LE(from + ENTRY_PLACES_AT);
		const unpackedSize = index.readUInt32LE(from + ENTRY_UNPACKED_AT);
		const size = index.readUInt32LE(from + ENTRY_SIZE_AT);
		if (!checkPlacement(offset, BigInt(size), archiveSize)) return undefined;
		records.push({
			name,
			offset,
			unpackedSize,
			size,
			flags: index.readUInt32LE(from + ENTRY_FLAGS_AT),
			key: Buffer.from(
				index.subarray(
					from + ENTRY_KEY_AT,
					from + ENTRY_KEY_AT + ENTRY_KEY_PLACES,
				),
			),
		});
	}
	return records.length > 0 ? records : undefined;
}

/** `PrimelScheme.GenerateKey`: the sixteen places of a key, of the hash of the seed folded onto itself. */
export function primelGeneratedKey(
	seed: Buffer | Uint8Array,
	scheme: PrimelSchemeKind,
): Buffer {
	const hash =
		"primel" === scheme
			? primelSha256(seed)
			: createHash("sha256").update(seed).digest();
	const key = Buffer.alloc(KEY_PLACES, 0x00);
	for (let at = 0; at < hash.length; at += 1) {
		key[at & 0x0f] = (key[at & 0x0f] ?? 0) ^ (hash[at] ?? 0);
	}
	return key;
}

/**
 * `PrimelScheme.TransformStream`: the places of a run of the archive, of the cipher the flags name and of
 * the streams behind it. `limit` is the count of the places the caller reads, which the reference asks of
 * the walk of the table of the places of a byte, that walk never stopping of its own.
 */
export function transformPrimelStream(
	input: Buffer,
	key: Buffer | Uint8Array,
	flags: number,
	scheme: PrimelSchemeKind,
	limit: number,
): Buffer {
	const key1 = primelGeneratedKey(key, scheme);
	const iv = primelGeneratedKey(key1, scheme);
	let data = input;
	switch (flags & CIPHER_MASK) {
		case CIPHER_ONE:
			data = new PrimelCipher(1, key1, iv).transformFinalBlock(data);
			break;
		case CIPHER_TWO:
			data = new PrimelCipher(2, key1, iv).transformFinalBlock(data);
			break;
		case CIPHER_THREE:
			data = new PrimelCipher(3, key1, iv).transformFinalBlock(data);
			break;
		case CIPHER_RC6:
			data = new Rc6(key1, iv).transformFinalBlock(data);
			break;
		case CIPHER_AES:
			data = new AesCfb8(key1, iv).decrypt(data);
			break;
		default:
			break;
	}
	if (0 !== (flags & RANGE_FLAG)) data = unpackPrimelRange(data);
	switch (flags & STREAM_MASK) {
		case STREAM_RLE_MTF:
			data = unpackPrimelRle(data);
			data = unpackPrimelMtf(data, limit > 0 ? limit : data.length);
			break;
		case STREAM_LZSS:
			data = unpackPrimelLzss(data);
			break;
		default:
			break;
	}
	return limit > 0 && data.length > limit ? data.subarray(0, limit) : data;
}

/** The places of every entry of the archive, of the index behind the block of the entries. */
function readEntries(
	data: Buffer,
	layout: PcfLayout,
	base: bigint,
	archiveSize: bigint,
): { scheme: PrimelSchemeKind; records: PcfRecord[] } | undefined {
	if (layout.indexPlaces > data.length) return undefined;
	const from = base + layout.indexPlaces;
	if (from > BigInt(data.length)) return undefined;
	const index = data.subarray(Number(from), Number(from) + layout.indexSize);
	for (const scheme of ["primel", "standard"] as const) {
		try {
			const places = transformPrimelStream(
				index,
				layout.key,
				layout.flags,
				scheme,
				0,
			);
			const records = readPcfIndex(places, layout.count, base, archiveSize);
			if (records) return { scheme, records };
		} catch {
			// The scheme the flags stand of is not this one, so the next one is read.
		}
	}
	return undefined;
}

export const primelPcfDescriptor: FormatDescriptor = {
	id: "primel-pcf-archive",
	name: "Primel ADV System resource archive",
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
			source: "ArcFormats/Primel/ArcPCF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const primelPcfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: primelPcfDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = await readStored(source);
			if (!readPcfLayout(data)) return false;
			return (await readArchive(data, source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPcfLayout(data);
		if (!layout) throw invalidArchive("Invalid Primel archive layout");
		const archive = await readArchive(data, source.size);
		if (!archive) throw invalidArchive("Invalid Primel archive index");
		const entries: FixedEntry[] = archive.records.map((record, at) =>
			createFixedEntry({
				id: at,
				...normalizeEntryPath(record.name),
				offset: record.offset,
				size: BigInt(record.unpackedSize),
				packedSize: BigInt(record.size),
				compressed: record.unpackedSize !== record.size,
				encrypted: 0 !== (record.flags & CIPHER_MASK),
				metadata: {
					flags: record.flags,
					key: record.key.toString("hex"),
					scheme: archive.scheme,
				},
			}),
		);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				scheme: archive.scheme,
				flags: layout.flags,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const flags = Number(entry.metadata?.flags ?? 0);
		const keyHex = String(entry.metadata?.key ?? "");
		const scheme =
			entry.metadata?.scheme === "standard" ? "standard" : "primel";
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const limit = entry.compressed ? Number(entry.size) : 0;
		return Readable.from([
			transformPrimelStream(
				stored,
				Buffer.from(keyHex, "hex"),
				flags,
				scheme,
				limit,
			),
		]);
	},
});

/** The layout, the block of the entries and the index of an archive, of the scheme that reads it. */
async function readArchive(
	data: Buffer,
	archiveSize: bigint,
): Promise<{ scheme: PrimelSchemeKind; records: PcfRecord[] } | undefined> {
	const layout = readPcfLayout(data);
	if (!layout) return undefined;
	if (layout.dataPlaces >= archiveSize) return undefined;
	if (layout.indexPlaces >= archiveSize) return undefined;
	const base = archiveSize - layout.dataPlaces;
	if (base < BigInt(HEAD_SIZE)) return undefined;
	return readEntries(data, layout, base, archiveSize);
}
