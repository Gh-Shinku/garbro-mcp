// Format reference: GARbro "ArcFormats/TanukiSoft/ArcTAC.cs", class `TacOpener`, and the byte level
// Blowfish implementation in "ArcFormats/Blowfish.cs".
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Blowfish, inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const TAC_MARKER = "TArc";
const TAC_VERSION_100 = "1.00";
const TAC_VERSION_110 = "1.10";
const HEADER_SIZE = 0x24;
const V110_INDEX_OFFSET = 0x2c;
const V100_INDEX_OFFSET = 0x24;
const COUNT_FIELD = 0x14;
const BUCKET_COUNT_FIELD = 0x18;
const INDEX_SIZE_FIELD = 0x1c;
const ARC_SEED_FIELD = 0x20;
const BUCKET_SIZE = 8;
const ENTRY_SIZE = 24;
const BLOCK_SIZE = 8;
const INDEX_KEY = Buffer.from("TLibArchiveData", "ascii");
const KEY_SUFFIX = "_tlib_secure_";
/** Images keep their tail unencrypted beyond this many bytes. */
const MAX_ENCRYPTED_IMAGE = 10240;
/** Guards the unbounded bucket walk of the reference against malformed indexes. */
const MAX_BUCKET_ENTRIES = 0x100000;
const UINT64_MASK = 0xffffffffffffffffn;

interface TacBucket {
	hash: number;
	count: number;
	index: number;
}

interface TacEntry {
	hash: bigint;
	packed: boolean;
	unpackedSize: number;
	offset: number;
	size: number;
}

interface TacIndex {
	entries: TacEntry[];
	baseOffset: bigint;
	seed: number;
}

/** The reference names unknown entries `{0:X16}` of their hash. */
function hashName(hash: bigint): string {
	return hash.toString(16).toUpperCase().padStart(16, "0");
}

function entryKey(hash: bigint): Buffer {
	return Buffer.from(`${hash.toString(10)}${KEY_SUFFIX}`, "ascii");
}

/**
 * Reads the Blowfish protected, zlib packed index. The optional `tanuki.lst` name list of the reference
 * is a game side file that is not available here, so every entry keeps its hash based name.
 */
async function readTacIndex(source: ByteSource): Promise<TacIndex | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.toString("latin1", 0, 4) !== TAC_MARKER) return undefined;
	const version = header.toString("latin1", 4, 8);
	let indexOffset = V100_INDEX_OFFSET;
	if (version === TAC_VERSION_110) indexOffset = V110_INDEX_OFFSET;
	else if (version !== TAC_VERSION_100) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	const bucketCount = header.readInt32LE(BUCKET_COUNT_FIELD);
	const indexSize = header.readUInt32LE(INDEX_SIZE_FIELD);
	const seed = header.readUInt32LE(ARC_SEED_FIELD);
	if (!isSaneCount(count)) return undefined;
	// The reference never validates the bucket count, which may legitimately be zero.
	if (bucketCount < 0 || bucketCount > MAX_BUCKET_ENTRIES) return undefined;
	if (indexSize < BLOCK_SIZE) return undefined;
	if (BigInt(indexOffset) + BigInt(indexSize) > source.size) return undefined;
	const blob = Buffer.from(await source.readAt(BigInt(indexOffset), indexSize));
	// Only whole blocks are deciphered; the reference leaves a trailing partial block alone.
	const whole = indexSize & ~(BLOCK_SIZE - 1);
	const decrypted = Buffer.concat([
		new Blowfish(INDEX_KEY).decipherBlocks(blob.subarray(0, whole)),
		blob.subarray(whole),
	]);
	let unpacked: Buffer;
	try {
		unpacked = await inflateZlibBuffer(decrypted);
	} catch {
		return undefined;
	}
	const required = bucketCount * BUCKET_SIZE + count * ENTRY_SIZE;
	if (unpacked.length < required) return undefined;
	const buckets: TacBucket[] = [];
	for (let id = 0; id < bucketCount; id += 1) {
		const base = id * BUCKET_SIZE;
		buckets.push({
			hash: unpacked.readUInt16LE(base),
			count: unpacked.readUInt16LE(base + 2),
			index: unpacked.readInt32LE(base + 4),
		});
	}
	const entries: TacEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = bucketCount * BUCKET_SIZE + id * ENTRY_SIZE;
		entries.push({
			hash: unpacked.readBigUInt64LE(base),
			packed: unpacked.readInt32LE(base + 8) !== 0,
			unpackedSize: unpacked.readUInt32LE(base + 12),
			offset: unpacked.readUInt32LE(base + 16),
			size: unpacked.readUInt32LE(base + 20),
		});
	}
	// Bucket hashes complete the top sixteen bits of the entry hash. Every bucket member is looked up
	// inside the entry table, which also bounds the walk.
	for (const [bucketId, bucket] of buckets.entries()) {
		if (bucketId >= MAX_BUCKET_ENTRIES) return undefined;
		if (bucket.count < 0 || bucket.index < 0) return undefined;
		for (let id = 0; id < bucket.count; id += 1) {
			const entry = entries[bucket.index + id];
			if (!entry) return undefined;
			entry.hash = ((entry.hash << 16n) | BigInt(bucket.hash)) & UINT64_MASK;
		}
	}
	return { entries, baseOffset: BigInt(indexOffset + indexSize), seed };
}

/** `AutoEntry.DetectFileType` on the deciphered first block of an entry. */
async function sniffType(
	source: ByteSource,
	offset: bigint,
	size: number,
	key: Buffer,
): Promise<string | undefined> {
	if (size < BLOCK_SIZE) return undefined;
	if (!checkPlacement(offset, BigInt(BLOCK_SIZE), source.size))
		return undefined;
	const head = Buffer.from(await source.readAt(offset, BLOCK_SIZE));
	return detectFileType(new Blowfish(key).decipherBlocks(head).readUInt32LE(0))
		?.type;
}

export const tanukiTacDescriptor: FormatDescriptor = {
	id: "tanuki-tac",
	name: "TanukiSoft resource archive",
	extensions: ["tac", "stx"],
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
			source: "ArcFormats/TanukiSoft/ArcTAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tanukiTacFormat = defineFixedArchive({
	descriptor: tanukiTacDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("TArc", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTacIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readTacIndex(source);
		if (!index) throw new GarbroError("INVALID_ARCHIVE", "Invalid TAC index");
		const entries: FixedEntry[] = [];
		for (const [id, entry] of index.entries.entries()) {
			const offset = index.baseOffset + BigInt(entry.offset);
			if (!checkPlacement(offset, BigInt(entry.size), source.size))
				throw new GarbroError("INVALID_ARCHIVE", "TAC entry outside file");
			if (entry.packed) {
				entries.push(
					createFixedEntry({
						id,
						...normalizeEntryPath(hashName(entry.hash)),
						offset,
						size: BigInt(entry.unpackedSize),
						packedSize: BigInt(entry.size),
						compressed: true,
						encrypted: false,
					}),
				);
				continue;
			}
			const key = entryKey(entry.hash);
			// The reference types entries from the missing name list first; without it the deciphered
			// first block is the only type source.
			const type = await sniffType(source, offset, entry.size, key);
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(hashName(entry.hash)),
					offset,
					size: BigInt(entry.size),
					packedSize: BigInt(entry.size),
					compressed: false,
					encrypted: true,
					metadata: {
						key: key.toString("latin1"),
						encryptedSize:
							type === "image"
								? Math.min(MAX_ENCRYPTED_IMAGE, entry.size)
								: entry.size,
						...(type === undefined ? {} : { type }),
					},
				}),
			);
		}
		return {
			entries,
			metadata: { entryCount: entries.length, seed: index.seed },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize ?? entry.size)),
		);
		const meta = (entry.metadata ?? {}) as {
			key?: string;
			encryptedSize?: number;
		};
		if (entry.compressed)
			return Readable.from([await inflateZlibBuffer(stored)]);
		if (meta.key === undefined) return Readable.from([stored]);
		const decipher = new Blowfish(Buffer.from(meta.key, "latin1"));
		const encryptedSize = meta.encryptedSize ?? stored.length;
		if (encryptedSize < stored.length) {
			return Readable.from([
				Buffer.concat([
					decipher.decipherBlocks(stored.subarray(0, encryptedSize)),
					stored.subarray(encryptedSize),
				]),
			]);
		}
		if (stored.length % BLOCK_SIZE === 0) {
			return Readable.from([decipher.decipherBlocks(stored)]);
		}
		const whole = stored.length & ~(BLOCK_SIZE - 1);
		return Readable.from([
			Buffer.concat([
				decipher.decipherBlocks(stored.subarray(0, whole)),
				stored.subarray(whole),
			]),
		]);
	},
});
