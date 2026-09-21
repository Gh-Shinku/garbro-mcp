// Format reference: GARBro "Experimental/SakanaGL/ArcSX.cs", classes `SxOpener` and `SxIndexDeserializer`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, basename, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { zstdDecompressSync } from "node:zlib";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The index of a container stands in a file of its own beside it, opening with these words. */
const INDEX_MARK = "SSXXDEFL";
const INDEX_HEAD_SIZE = 0x10;
const INDEX_KEY_AT = 8;
/** The key both the index and the entries lean on. */
const DEFAULT_KEY = 0x2e76034b;
/** The two words the cipher mixes the key with before it starts. */
const MIX_LO = 0x159a55e5;
const MIX_HI = 0x075bcd15;
const MIX_ONE = 0x0549139a;
const MIX_TWO = 0x8e415c26;
const MIX_THREE = 0x4d9d5bb8;
const HIGH_KEY = 0x2e6;
/** The name of the index beside a container, and the mark its own name may carry. */
const INDEX_SUFFIX = "(00).sx";
const SHORT_NAME_LENGTH = 4;
const NAME_MARK = /^(.*)-([^-]+)$/;
/** Every place in an entry is counted in sixteen byte units. */
const OFFSET_UNIT = 16;
/** What an entry's own flags say about it. */
const FLAG_PACKED = 0x03;
const FLAG_ENCRYPTED = 0x10;
/** How long one record of the archive table and one of the skipped table are. */
const ARCHIVE_RECORD_SIZE = 40;
const SKIPPED_RECORD_SIZE = 24;
/** The mark a name of a tree stands behind, and the one that means "this is a directory". */
const NO_FILE = -1;
/** A container this project is willing to read. */
const LIMIT = 256 * 1024 * 1024;

export interface SxEntryPlan {
	name: string;
	offset: number;
	size: number;
	packed: boolean;
	encrypted: boolean;
	arcIndex: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function u32(value: number): number {
	return value >>> 0;
}

/**
 * `SxOpener.DecryptData`: a stream of thirty-two bit words, each exclusive-ored with a word of a sequence
 * that steps four words at a time. The same call both keys and unkeys a run, since what a word is
 * exclusive-ored with never stands on the bytes themselves.
 */
export function decryptSxData(
	data: Buffer,
	keyLo: number,
	keyHi: number,
): void {
	if (data.length < 4) return;
	const low = u32(keyLo ^ MIX_LO);
	const high = u32(keyHi ^ MIX_HI);
	const first = u32(high ^ u32(high << 11));
	let v1 = u32(first ^ (u32(first ^ u32(high << 11)) >>> 8) ^ MIX_ONE);
	const second = u32(v1 ^ low ^ u32(low << 11));
	let v2 = u32(second ^ (u32(second ^ u32(v1 >>> 11)) >>> 8));
	let v3 = u32(v2 ^ (v2 >>> 19) ^ MIX_TWO);
	let v4 = u32(v3 ^ (v3 >>> 19) ^ MIX_THREE);
	const count = Math.floor(data.length / 4);
	for (let index = 0; index < count; index += 1) {
		const t1 = u32(
			v4 ^ v1 ^ u32(v1 << 11) ^ (u32(u32(v1 << 11) ^ u32(v4 >>> 11)) >>> 8),
		);
		const t2 = u32(v2 ^ u32(v2 << 11));
		v2 = v4;
		v4 = u32(t1 ^ t2 ^ (u32(t2 ^ u32(t1 >>> 11)) >>> 8));
		const word = u32(
			data.readUInt32LE(index * 4) ^ u32((t1 >>> 4) ^ u32(v4 << 12)),
		);
		data.writeUInt32LE(word, index * 4);
		v1 = v3;
		v3 = t1;
	}
}

/** `SxOpener.UnpackZstd`: the size the run unpacks to stands in front of it, of four bytes. */
export function unpackSxZstd(data: Buffer): Buffer {
	if (data.length < 4)
		throw invalid("A packed run is shorter than its own size");
	const unpackedSize = data.readInt32BE(0);
	const packed = data.subarray(4);
	const unpacked = Buffer.from(zstdDecompressSync(packed));
	if (unpackedSize > 0 && unpacked.length !== unpackedSize) {
		throw invalid("A packed run unpacks to a size other than the one it names");
	}
	return unpacked;
}

/** The key of an entry: its own place and length, and the key the engine fixes. */
function entryKey(offset: number, size: number): { low: number; high: number } {
	return {
		low: u32(
			(Math.floor(offset / OFFSET_UNIT) >>> 0) ^ u32(size << 16) ^ DEFAULT_KEY,
		),
		high: u32((size >>> 16) ^ HIGH_KEY),
	};
}

/**
 * `SxOpener.TryOpen`: the key of the index stands in its own head and leans on the length behind it, the
 * whole of which is mixed in sixty-four bits before the cipher is handed the two halves.
 */
export function sxIndexKey(
	index: Buffer,
): { low: number; high: number } | undefined {
	if (index.length <= INDEX_HEAD_SIZE) return undefined;
	const key = BigInt(index.readInt32BE(INDEX_KEY_AT));
	const length = BigInt(index.length - INDEX_HEAD_SIZE);
	const mixed = BigInt.asUintN(
		64,
		key ^ (961n * (key + length) - 124789n) ^ BigInt(DEFAULT_KEY),
	);
	return {
		low: u32(Number(mixed & 0xffffffffn)),
		high: u32(Number(mixed >> 32n) ^ HIGH_KEY),
	};
}

/** `SxIndexDeserializer.Deserialize`: the names, the entries, the archive table and the tree of names. */
export function readSxIndex(
	index: Buffer,
	maxOffset: number,
): SxEntryPlan[] | undefined {
	let at = 8;
	const readCount = (): number => {
		if (at + 4 > index.length)
			throw invalid("The index of the container stops short");
		const value = index.readInt32BE(at);
		at += 4;
		return value;
	};
	const count = readCount();
	if (count < 0 || count > 0x10000) return undefined;
	const names: string[] = [];
	for (let name = 0; name < count; name += 1) {
		if (at >= index.length)
			throw invalid("The index stops inside its own names");
		const length = index[at] ?? 0;
		at += 1;
		if (at + length > index.length)
			throw invalid("The index stops inside a name");
		names.push(index.toString("utf8", at, at + length));
		at += length;
	}
	const entryCount = readCount();
	if (entryCount < 0 || entryCount > 0x10000) return undefined;
	const entries: SxEntryPlan[] = [];
	for (let entry = 0; entry < entryCount; entry += 1) {
		if (at + 12 > index.length)
			throw invalid("The index stops inside its own entries");
		const arcIndex = index.readUInt16BE(at);
		const flags = index.readUInt16BE(at + 2);
		const offset = index.readUInt32BE(at + 4) * OFFSET_UNIT;
		const size = index.readUInt32BE(at + 8);
		at += 12;
		entries.push({
			name: "",
			offset,
			size,
			packed: 0 !== (flags & FLAG_PACKED),
			encrypted: 0 === (flags & FLAG_ENCRYPTED),
			arcIndex,
		});
	}
	// The table of the containers this index stands over, of which the one this very file is gives its own
	// length. Only when a container is one of several do its entries have to be picked out.
	if (at + 2 > index.length)
		throw invalid("The index stops before its own table");
	const arcCount = index.readUInt16BE(at);
	at += 2;
	let arcIndex = -1;
	for (let arc = 0; arc < arcCount; arc += 1) {
		if (at + ARCHIVE_RECORD_SIZE > index.length) {
			throw invalid("The index stops inside its own table");
		}
		const arcSize = index.readUInt32BE(at + 12) * OFFSET_UNIT;
		if (maxOffset === arcSize) arcIndex = arc;
		at += ARCHIVE_RECORD_SIZE;
	}
	if (at + 2 > index.length)
		throw invalid("The index stops before its own tail");
	const skipped = index.readUInt16BE(at);
	at += 2 + skipped * SKIPPED_RECORD_SIZE;
	if (at + 10 > index.length)
		throw invalid("The index stops before its own names");
	// `SxIndexDeserializer.DeserializeTree`: one node names a place in the tree of names, and a node that
	// names no file is a directory whose own `count` children stand as whole nodes behind it.
	const walkTree = (path: string): void => {
		if (at + 10 > index.length) {
			throw invalid("The index stops inside its own name tree");
		}
		const children = index.readUInt16BE(at);
		const nameIndex = index.readInt32BE(at + 2);
		const fileIndex = index.readInt32BE(at + 6);
		at += 10;
		const leaf = names[nameIndex] ?? "";
		const name = path.length > 0 ? `${path}/${leaf}` : leaf;
		if (NO_FILE === fileIndex) {
			for (let child = 0; child < children; child += 1) walkTree(name);
			return;
		}
		const entry = entries[fileIndex];
		if (entry) entry.name = name;
	};
	walkTree("");
	if (arcCount > 1 && arcIndex !== -1) {
		return entries.filter((entry) => entry.arcIndex === arcIndex);
	}
	return entries;
}

/** `SxOpener.TryOpen`: the index stands beside the container, under one of two names. */
export function sxIndexName(archivePath: string): string[] {
	const base = basename(archivePath, extname(archivePath));
	const directory = dirname(resolve(archivePath));
	const names = [`${base.slice(0, SHORT_NAME_LENGTH)}${INDEX_SUFFIX}`];
	const match = NAME_MARK.exec(base);
	if (match?.[1]) names.push(`${match[1]}${INDEX_SUFFIX}`);
	return names.map((name) => resolve(directory, name));
}

export async function readSxIndexFor(
	archivePath: string,
	maxOffset: number,
): Promise<SxEntryPlan[] | undefined> {
	for (const candidate of sxIndexName(archivePath)) {
		if (candidate === resolve(archivePath)) continue;
		let index: Buffer;
		try {
			index = await readFile(candidate);
		} catch {
			continue;
		}
		if (index.length <= INDEX_HEAD_SIZE) continue;
		if (index.toString("latin1", 0, 8) !== INDEX_MARK) continue;
		const key = sxIndexKey(index);
		if (!key) continue;
		const payload = Buffer.from(index.subarray(INDEX_HEAD_SIZE));
		decryptSxData(payload, key.low, key.high);
		const unpacked = unpackSxZstd(payload);
		const entries = readSxIndex(unpacked, maxOffset);
		if (entries && entries.length > 0) return entries;
	}
	return undefined;
}

export const sakanaglSxArchiveDescriptor: FormatDescriptor = {
	id: "sakanagl-sx-archive",
	name: "SakanaGL engine resource archive",
	extensions: ["sx"],
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
			source: "Experimental/SakanaGL/ArcSX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sakanaglSxArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sakanaglSxArchiveDescriptor,
	// A container of this engine writes no word of its own: its index stands in a file beside it.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		const size = Number(source.size);
		if (size <= 0 || size > LIMIT) return false;
		return (await readSxIndexFor(sourcePath, size)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const size = Number(source.size);
		if (size <= 0 || size > LIMIT) {
			throw invalid("The container is larger than this project will read");
		}
		const entries = await readSxIndexFor(sourcePath, size);
		if (!entries) throw invalid("Not a SakanaGL engine resource archive");
		const fixed: FixedEntry[] = [];
		for (const [index, entry] of entries.entries()) {
			// The tree of names is what names an entry; one it never reaches has none to offer.
			if (0 === entry.name.length) continue;
			if (
				entry.offset < 0 ||
				entry.size < 0 ||
				entry.offset + entry.size > size
			) {
				throw invalid(`The entry ${entry.name} reaches past the container`);
			}
			fixed.push({
				...createFixedEntry({
					id: index,
					path: entry.name,
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					compressed: entry.packed,
					encrypted: entry.encrypted,
					metadata: {
						packed: entry.packed,
						encrypted: entry.encrypted,
					},
				}),
				// A packed entry unpacks to its own size, which the index need not name.
				sizeKnown: !entry.packed,
			});
		}
		return {
			entries: fixed,
			metadata: { containerSize: size },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		// What an entry's own flags said about it stands in its own metadata.
		const packed = true === entry.metadata?.packed;
		const encrypted = true === entry.metadata?.encrypted;
		if (!packed && !encrypted) return Readable.from([stored]);
		if (encrypted) {
			const key = entryKey(Number(entry.offset), Number(entry.size));
			decryptSxData(stored, key.low, key.high);
		}
		return Readable.from([packed ? unpackSxZstd(stored) : stored]);
	},
});
