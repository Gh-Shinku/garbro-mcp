// Format reference: GARBro "ArcFormats/FamilyAdvSystem/ArcCSAF.cs", classes `CsafOpener`, `CsafEncryption`
// and `CsafStream`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { createDecipheriv, createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head: the word of its own, the flags, how many entries stand in it, and how long its names are. */
const FLAGS_FIELD = 4;
const COUNT_FIELD = 8;
const NAMES_SIZE_FIELD = 0x0c;
const HASH_FIELD = 0x10;
const HASH_SIZE = 0x10;
const HEAD_SIZE = 0x20;
/** The low half of the flags has to name this much, and the highest bit says the names are kept wrapped. */
const FLAGS_SHAPE = 0x10000;
const ENCRYPTED_FLAG = 0x80000000;
/** The index stands in whole pages with a head of its own behind them. */
const PAGE_SIZE = 0x1000;
const INDEX_HEAD_SIZE = 0xfe0;
const ENTRY_SIZE = 0x18;
const ENTRY_FIRST = 0x10;
const PLACE_SHIFT = 12;
const NAME_TERMINATOR = 0;
/** The phrase and the place the picture of this engine is wrapped with, both of them in the reference. */
const DEFAULT_KEY = "江ノ島の南";
const DEFAULT_IV = Buffer.from("FamilyAdvSystem ", "ascii");
/** A wrapped entry is unwrapped a page at a time, every page with a key of its own. */
const BLOCK_GROUP = 8;
const KEY_SIZE = 0x20;
const HALF_KEY = 0x10;

export interface CsafLayout {
	count: number;
	namesSize: number;
	indexSize: number;
	encrypted: boolean;
	hash: Buffer;
}

export interface CsafIndexEntry {
	path: string;
	offset: bigint;
	size: number;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `CsafOpener.TryOpen`: the head of the archive, and the shape the low half of its flags has to have. */
export function readCsafLayout(data: Buffer): CsafLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, 4) !== "CSAF") return undefined;
	const flags = data.readUInt32LE(FLAGS_FIELD);
	if ((flags & 0x7fffffff) !== FLAGS_SHAPE) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const namesSize = data.readUInt32LE(NAMES_SIZE_FIELD);
	// The index stands in whole pages, with the head of its own behind them.
	const indexSize =
		((count * ENTRY_SIZE + 0x1f) & -PAGE_SIZE) + INDEX_HEAD_SIZE;
	if (indexSize + namesSize > data.length) return undefined;
	return {
		count,
		namesSize,
		indexSize,
		encrypted: 0 !== (flags & ENCRYPTED_FLAG),
		hash: data.subarray(HASH_FIELD, HASH_FIELD + HASH_SIZE),
	};
}

/** `CsafEncryption.InitKey`: the phrase this engine was built with, taken twice over with one byte between. */
export function csafKey(phrase: string): Buffer {
	const key = Buffer.alloc(KEY_SIZE, 0x00);
	const bytes = Buffer.from(phrase, "utf16le");
	createHash("md5").update(bytes).digest().copy(key, 0, 0, HALF_KEY);
	createHash("md5")
		.update(bytes.subarray(1, bytes.length - 1))
		.digest()
		.copy(key, HALF_KEY, 0, HALF_KEY);
	return key;
}

/** `Binary.RotByteL`. */
function rotByteLeft(value: number, count: number): number {
	const by = count & 7;
	return ((value << by) | (value >>> (8 - by))) & 0xff;
}

/** `CsafEncryption.GetBlockKey`: every page of the archive is unwrapped with a key of its own. */
export function csafBlockKey(key: Buffer, blockNumber: number): Buffer {
	const offset = Math.trunc(blockNumber / BLOCK_GROUP);
	const shift = blockNumber & (BLOCK_GROUP - 1);
	const blockKey = Buffer.alloc(KEY_SIZE, 0x00);
	const buffer = Buffer.alloc(HALF_KEY, 0x00);
	for (let index = 0; index < HALF_KEY; index += 1) {
		buffer[index] = rotByteLeft(
			key[(offset + index) & (HALF_KEY - 1)] ?? 0,
			shift,
		);
	}
	createHash("md5").update(buffer).digest().copy(blockKey, 0, 0, HALF_KEY);
	for (let index = 0; index < HALF_KEY; index += 1) {
		buffer[index] = rotByteLeft(
			key[HALF_KEY + ((offset + index) & (HALF_KEY - 1))] ?? 0,
			shift,
		);
	}
	createHash("md5")
		.update(buffer)
		.digest()
		.copy(blockKey, HALF_KEY, 0, HALF_KEY);
	return blockKey;
}

/**
 * The wrapped places of an archive are read back whole: a run of bytes at a place of its own, unwrapped with
 * the key of the page it stands in, every page with the same place the wrapping began at. The reference reads
 * a stream this way one page at a time, and this port reads the one place a caller asks for the same way.
 */
export function decryptCsafRange(
	data: Buffer,
	key: Buffer,
	offset: number,
	size: number,
): Buffer {
	const output = Buffer.alloc(size, 0x00);
	let at = offset;
	let written = 0;
	while (written < size) {
		const pageStart = at & ~(PAGE_SIZE - 1);
		const page = data.subarray(pageStart, pageStart + PAGE_SIZE);
		if (page.length !== PAGE_SIZE) {
			throw invalidArchive("The archive ends inside a page of its own");
		}
		const blockKey = csafBlockKey(key, pageStart >> 12);
		const decipher = createDecipheriv("aes-256-cbc", blockKey, DEFAULT_IV);
		decipher.setAutoPadding(false);
		const plain = Buffer.concat([decipher.update(page), decipher.final()]);
		const inside = at - pageStart;
		const take = Math.min(size - written, PAGE_SIZE - inside);
		plain.copy(output, written, inside, inside + take);
		at += take;
		written += take;
	}
	return output;
}

/**
 * `CsafOpener.TryOpen`: the directory of the archive. The first `index_size` bytes stand as they are even in a
 * wrapped archive; the names behind them are unwrapped, and then the whole of it has to be the very thing the
 * head keeps a digest of.
 */
export function readCsafIndex(
	data: Buffer,
	layout: CsafLayout,
	phrase: string,
): CsafIndexEntry[] | undefined {
	const index = Buffer.from(
		data.subarray(HEAD_SIZE, HEAD_SIZE + layout.indexSize + layout.namesSize),
	);
	if (layout.encrypted) {
		const key = csafKey(phrase);
		const wrapped = data.subarray(
			HEAD_SIZE + layout.indexSize,
			HEAD_SIZE + layout.indexSize + layout.namesSize,
		);
		// The names are unwrapped as one run, from the place the index ends at, with the first key.
		const decipher = createDecipheriv(
			"aes-256-cbc",
			csafBlockKey(key, 0),
			DEFAULT_IV,
		);
		decipher.setAutoPadding(false);
		const plain = Buffer.concat([decipher.update(wrapped), decipher.final()]);
		plain.copy(index, layout.indexSize);
	}
	const digest = createHash("md5").update(index).digest();
	if (!digest.equals(layout.hash)) return undefined;
	const entries: CsafIndexEntry[] = [];
	let indexPos = ENTRY_FIRST;
	let namePos = layout.indexSize;
	for (let count = 0; count < layout.count; count += 1) {
		let at = namePos;
		while (at + 1 < index.length) {
			if (index[at] === NAME_TERMINATOR && index[at + 1] === NAME_TERMINATOR) {
				break;
			}
			at += 2;
		}
		const nameLength = at - namePos;
		const name = index
			.subarray(namePos, namePos + nameLength)
			.toString("utf16le");
		namePos += nameLength + 10;
		const place = index.readUInt32LE(indexPos);
		const size = index.readUInt32LE(indexPos + 4);
		indexPos += ENTRY_SIZE;
		if (
			!checkPlacement(
				BigInt(place) << BigInt(PLACE_SHIFT),
				BigInt(size),
				BigInt(data.length),
			)
		) {
			return undefined;
		}
		entries.push({
			path: normalizeEntryPath(name).path,
			offset: BigInt(place) << BigInt(PLACE_SHIFT),
			size,
		});
	}
	return entries;
}

/** The kind of a name, as the reference's own catalogue would tell it. */
function entryType(path: string): string {
	const extension = sourceExtension(path);
	if (["bmp", "png", "jpg", "jpeg", "gif", "webp", "tga"].includes(extension)) {
		return "image";
	}
	if (["ogg", "wav", "mp3", "opus"].includes(extension)) return "audio";
	if (["txt", "csv", "ini", "psb", "txtz", "psbz"].includes(extension)) {
		return "script";
	}
	return "binary";
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const csafArchiveDescriptor: FormatDescriptor = {
	id: "family-adv-system-csaf-archive",
	name: "Family Adv System resource archive",
	extensions: [""],
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
			source: "ArcFormats/FamilyAdvSystem/ArcCSAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const csafArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: csafArchiveDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("CSAF", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		const head = await source.readAt(0n, HEAD_SIZE);
		return head.toString("latin1", 0, 4) === "CSAF";
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readCsafLayout(data);
		if (!layout) throw invalidArchive("Not a Family Adv System archive");
		const entries = readCsafIndex(data, layout, DEFAULT_KEY);
		if (!entries)
			throw invalidArchive("The archive does not match its own digest");
		const fixed: FixedEntry[] = entries.map((place, id) =>
			createFixedEntry({
				id,
				path: place.path,
				offset: place.offset,
				size: BigInt(place.size),
				encrypted: layout.encrypted,
				metadata: {
					type: entryType(place.path),
					// A wrapped entry is unwrapped a page at a time as it is read.
					wrapped: layout.encrypted,
				},
			}),
		);
		return {
			entries: fixed,
			metadata: { entries: fixed.length, encrypted: layout.encrypted },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const data = await readStored(source);
		const layout = readCsafLayout(data);
		if (!layout) throw invalidArchive("Not a Family Adv System archive");
		const offset = Number(entry.offset);
		const size = Number(entry.size);
		if (0 === size) return Readable.from([Buffer.alloc(0, 0x00)]);
		if (!layout.encrypted) {
			return Readable.from([Buffer.from(data.subarray(offset, offset + size))]);
		}
		return Readable.from([
			decryptCsafRange(data, csafKey(DEFAULT_KEY), offset, size),
		]);
	},
});
