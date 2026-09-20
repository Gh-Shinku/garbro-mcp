// Format reference: GARbro "Experimental/RPGMaker/ArcRGSS.cs", classes `RgssOpener`, `RgssEntry` and
// `KeyGenerator` (an RPG Maker engine archive: the walk of the files stands at the front of the file, every
// place of it and of the files standing under a walk of keys of its own). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The word the reference registers, the word behind it, and the place that names the kind of the walk. */
const SIGNATURE = Buffer.from("RGSS", "latin1");
const AD_WORD = "AD\0";
const AD_WORD_FIELD = 0x04;
const VERSION_FIELD = 0x07;
const HEADER_SIZE = 0x08;
/** The keys of the walks this port reads: the walk of the first kind, which walks the whole file, and the
 * walk of the third kind, which stands as a walk of its own. */
const VERSION_V1 = 1;
const VERSION_V3 = 3;
/** The key the walk of the first kind stands from, and the walk of a key of its own. */
const V1_SEED = 0xdeadcafe;
const KEY_MULTIPLIER = 7;
const KEY_ADDEND = 3;
/** The key the walk of the third kind stands from, which stands as the word at the front of the walk. */
const V3_KEY_MULTIPLIER = 9;
const V3_KEY_ADDEND = 3;
const V3_KEY_FIELD = 0x08;
/** A name of a file of the walk of the names, which stands in the places of a text of the kind the engine
 * stands its scripts in. */
const NAME_ENCODING = "utf8";
/** How many files an archive of this kind may hold, past which this project stands the walk as mad. */
const MAXIMUM_COUNT = 0x10000;
/** A name that stands as the name of a file: the places a text of the kind the engine stands its names in
 * stands in, without the place the walk of a file begins with. */
const NAME_BYTES = /^[\x20-\x7e\u00a1-\uffff]+$/;

export interface RgssEntryLayout {
	name: string;
	offset: number;
	size: number;
	/** The key the places of the file stand under. */
	key: number;
}

export interface RgssLayout {
	version: number;
	entries: RgssEntryLayout[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `KeyGenerator`: every key of a walk stands as the key before it stood, seven times over, three places
 * standing beside it, the places of the key standing in four and thirty places of their own. */
export class RgssKeyGenerator {
	#seed: number;

	constructor(seed: number) {
		this.#seed = seed >>> 0;
	}

	get current(): number {
		return this.#seed;
	}

	getNext(): number {
		const key = this.#seed;
		this.#seed = (Math.imul(this.#seed, KEY_MULTIPLIER) + KEY_ADDEND) >>> 0;
		return key;
	}
}

/** How many places of a ciphered block stand in every key of a walk of the third kind. */
const KEY_BYTES = 4;

/** The place of a key that stands at a place of a walk of places, the four places of a key standing over and
 * over where a file is longer than they are. */
function keyByte(key: number, at: number): number {
	return (key >>> ((at << 3) & 31)) & 0xff;
}

/** `RgssOpener.OpenEntry`: every four places of a file stand under the four places of one key, and the key
 * behind them stands as the next key of the walk of the file. */
export function decryptRgssPlaces(data: Buffer, seed: number): Buffer {
	const out: Buffer = Buffer.from(data);
	const keys = new RgssKeyGenerator(seed);
	let key = keys.getNext();
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) ^ keyByte(key, at & (KEY_BYTES - 1))) & 0xff;
		if (0 === (at + 1) % KEY_BYTES) key = keys.getNext();
	}
	return out;
}

/** The other way of the same walk, which stands the places of a file as the archive stands them. */
export function encryptRgssPlaces(data: Buffer, seed: number): Buffer {
	return decryptRgssPlaces(data, seed);
}

/** `RgssOpener.DecryptName` of the walk of the first kind: every place of a name stands under the lowest place
 * of one key of the walk. */
function decryptNameV1(name: Buffer, keys: RgssKeyGenerator): string {
	const out: Buffer = Buffer.from(name);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) ^ (keys.getNext() & 0xff)) & 0xff;
	}
	return out.toString(NAME_ENCODING);
}

/** `RgssOpener.DecryptName` of the walk of the third kind: every place of a name stands under one place of the
 * key of the walk, the four places of the key standing over and over. */
function decryptNameV3(name: Buffer, key: number): string {
	const out: Buffer = Buffer.from(name);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) ^ keyByte(key, at & (KEY_BYTES - 1))) & 0xff;
	}
	return out.toString(NAME_ENCODING);
}

/** A name of the walk of the names, which stands as the name of a file of the archive. */
function readName(name: string): string | undefined {
	if (0 === name.length || !NAME_BYTES.test(name)) return undefined;
	if (name.includes("\0") || name.includes("\\")) return undefined;
	const trimmed = name.replace(/^\/+/, "");
	return 0 === trimmed.length ? undefined : trimmed;
}

/** The walk of the first kind: every file of the walk stands behind the places of the file before it, so the
 * walk and the places of the files stand one behind the other in the file. */
function readIndexV1(
	data: Buffer,
	fileLength: number,
): RgssEntryLayout[] | undefined {
	const keys = new RgssKeyGenerator(V1_SEED);
	const entries: RgssEntryLayout[] = [];
	let at = HEADER_SIZE;
	while (at + 4 <= fileLength && at + 4 <= data.length) {
		if (entries.length >= MAXIMUM_COUNT) return undefined;
		const nameLength = (data.readUInt32LE(at) ^ keys.getNext()) >>> 0;
		at += 4;
		if (nameLength > data.length || at + nameLength > fileLength) {
			return undefined;
		}
		const name = readName(
			decryptNameV1(data.subarray(at, at + nameLength), keys),
		);
		at += nameLength;
		if (!name) return undefined;
		if (at + 4 > data.length || at + 4 > fileLength) return undefined;
		const size = (data.readUInt32LE(at) ^ keys.getNext()) >>> 0;
		at += 4;
		const offset = at;
		const key = keys.current;
		if (offset + size > fileLength) return undefined;
		entries.push({ name, offset, size, key });
		at += size;
	}
	return entries;
}

/** The walk of the third kind: the walk stands as a walk of its own at the front of the file, every place of
 * it standing under the key of the walk, and a place of nought at the front of a file ends it. */
function readIndexV3(
	data: Buffer,
	fileLength: number,
): RgssEntryLayout[] | undefined {
	if (V3_KEY_FIELD + 4 > data.length) return undefined;
	const key =
		(Math.imul(data.readUInt32LE(V3_KEY_FIELD), V3_KEY_MULTIPLIER) +
			V3_KEY_ADDEND) >>>
		0;
	const entries: RgssEntryLayout[] = [];
	let at = HEADER_SIZE + 4;
	while (at + 16 <= fileLength && at + 16 <= data.length) {
		const offset = (data.readUInt32LE(at) ^ key) >>> 0;
		if (0 === offset) return entries;
		if (entries.length >= MAXIMUM_COUNT) return undefined;
		const size = (data.readUInt32LE(at + 4) ^ key) >>> 0;
		const keyOfFile = (data.readUInt32LE(at + 8) ^ key) >>> 0;
		const nameLength = (data.readUInt32LE(at + 12) ^ key) >>> 0;
		at += 16;
		if (nameLength > data.length || at + nameLength > fileLength) {
			return undefined;
		}
		const name = readName(
			decryptNameV3(data.subarray(at, at + nameLength), key),
		);
		at += nameLength;
		if (!name) return undefined;
		if (offset + size > fileLength) return undefined;
		entries.push({ name, offset, size, key: keyOfFile });
	}
	return entries;
}

/**
 * `RgssOpener.TryOpen`: the word `RGSS` stands at the beginning of the file with the word `AD` and a place of
 * nothing behind it, and the place behind those names the kind of the walk of the files.
 */
export function readRgssLayout(
	data: Buffer,
	fileLength = data.length,
): RgssLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data.toString("latin1", AD_WORD_FIELD, AD_WORD_FIELD + 3) !== AD_WORD) {
		return undefined;
	}
	const version = data[VERSION_FIELD] ?? 0;
	let entries: RgssEntryLayout[] | undefined;
	if (VERSION_V1 === version) entries = readIndexV1(data, fileLength);
	else if (VERSION_V3 === version) entries = readIndexV3(data, fileLength);
	else return undefined;
	if (!entries || 0 === entries.length) return undefined;
	return { version, entries };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readRgss(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readRgssLayout(stored, Number(source.size));
	if (!layout) throw invalidArchive("Not an RPG Maker engine archive");
	return { stored, layout };
}

export const rpgMakerRgssAdDescriptor: FormatDescriptor = {
	id: "rpg-maker-rgss-ad",
	name: "RPG Maker engine resource archive",
	extensions: ["rgssad", "rgss2a", "rgss3a"],
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
			source: "Experimental/RPGMaker/ArcRGSS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rpgMakerRgssAdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rpgMakerRgssAdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const stored = await readStored(source);
			return readRgssLayout(stored, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const { layout } = await readRgss(source);
		const entries = layout.entries.map((entry, id) =>
			createFixedEntry({
				id,
				path: entry.name,
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				encrypted: true,
				metadata: { type: "file" } as Record<string, unknown>,
			}),
		);
		return {
			entries,
			metadata: { version: layout.version, encrypted: true },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const { stored, layout } = await readRgss(source);
		const at = layout.entries[Number(entry.id)];
		if (!at)
			throw invalidArchive(
				"RPG Maker archive entry stands outside the archive",
			);
		const start = at.offset;
		const end = start + at.size;
		if (end > stored.length) {
			throw invalidArchive(
				"RPG Maker archive entry stands outside the archive",
			);
		}
		// The places of a file stand under the walk of the key the walk of the files named for it.
		return Readable.from([
			decryptRgssPlaces(stored.subarray(start, end), at.key),
		]);
	},
});
