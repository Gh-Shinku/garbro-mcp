// Port of the index and payload walks of the newer archives of the CVNS engine: the mixes of
// `ArcFormats/Cmvs/ArcCPZ.cs` (`DecryptIndexStage1`, `DecryptIndexDirectory`, `DecryptIndexEntry` and their
// counterparts, `UnpackIndexKey`, `UnpackLzss`, `DecryptPs2`, `DecryptPb3`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Every walk of the index stands of a secret of the engine and of the digest the head of the archive
// carries, and every one of them is carried **both ways** by the reference, which is what the test of this
// module stands of: the walks of the index and of its entries are each other's inverse, and the places of a
// run behind them are held to a second transcription of the same source.
//
// One place of the reference stands apart: the walk of a directory of the index adds the key of the archive
// to its seed on the way in (`seed += 0x10FB562A ^ arc_key`), while the walk back adds the count alone
// (`seed += 0x10FB562A`), and the walk of the entries of a directory stands of the same difference with
// `0x139FA9B`. The two directions are therefore each other's inverse for an archive whose key stands of
// nothing, which is the key of a stock build of the engine, and this port keeps both places as the
// reference writes them.

import { GarbroError } from "@garbro-mcp/core";
import { decompressCmvsHuffman, type Cpz5Scheme } from "@garbro-mcp/codecs";
import { unpackCpzLzss } from "./cpz.js";

const WORD_PLACES = 4;
const SECRET_WORDS = 24;
const INDEX_SEED = 0x76548aef;
const INDEX_DIRECTORY_ADDEND = 0x4a91c262;
const INDEX_DIRECTORY_STEP = 0x10fb562a;
const INDEX_ENTRY_TAIL = 0x37a19e8b;
const INDEX_ENTRY_STEP = 0x139fa9b;
const TAIL_BYTE = 0xff;
/** The places of the head a `PS2A` run keeps its window walk behind. */
const LZSS_HEAD = 0x30;
/**
 * The four places of the key of an archive, which the reference reads out of a `start.ps3` beside the
 * archive (`FindArchiveKey`). A stock build of the engine, and every layout below the seventh, stands of
 * zero for all four of them.
 */
export interface CpzArchiveKey {
	readonly indexDirKey: number;
	readonly indexEntryKey: number;
	readonly entryDataKey1: number;
	readonly entryDataKey2: number;
}

/** The places of the head of an index key, and of the places of the key within it. */
const KEY_SIZE_AT = 16;
const KEY_PLACES_AT = 20;
const KEY_PACKED_AT = 24;
const KEY_HEAD_PLACES = 24;

/** `Binary.RotL`. */
function rotateLeft(word: number, count: number): number {
	const places = count & 31;
	return ((word << places) | (word >>> (32 - places))) >>> 0;
}

/** `Binary.RotR`. */
function rotateRight(word: number, count: number): number {
	const places = count & 31;
	return ((word >>> places) | (word << (32 - places))) >>> 0;
}

/** `Binary.RotByteR`: a rotation of a place of a byte, to the right. */
function rotateByteRight(place: number, count: number): number {
	const places = count & 7;
	return (((place >>> places) | (place << (8 - places))) & 0xff) >>> 0;
}

/** The secret of the walks of an index: the words of the scheme, less the key of the head of the archive. */
function indexSecret(scheme: Cpz5Scheme, key: number): Uint32Array {
	const secret = new Uint32Array(SECRET_WORDS);
	const length = Math.min(SECRET_WORDS, scheme.secret.length);
	for (let at = 0; at < length; at += 1) {
		secret[at] = ((scheme.secret[at] ?? 0) - key) >>> 0;
	}
	return secret;
}

/** The places the places of the index of an archive stand of, in both directions of the walk. */
function stage1Shift(key: number): number {
	const mixed = ((key >>> 24) ^ (key >>> 16) ^ (key >>> 8) ^ key ^ 0x0b) & 0x0f;
	return mixed + 7;
}

/** `DecryptIndexStage1`: the first mix over the places of an index. */
export function decryptCpzIndexStage1(
	data: Buffer,
	key: number,
	scheme: Cpz5Scheme,
): void {
	const secret = indexSecret(scheme, key);
	const shift = stage1Shift(key);
	const words = Math.floor(data.length / WORD_PLACES);
	let place = 5;
	for (let at = 0; at < words; at += 1) {
		const from = at * WORD_PLACES;
		const word = data.readUInt32LE(from);
		const mixed =
			(rotateRight(
				(((secret[place] ?? 0) ^ word) + scheme.indexAddend) >>> 0,
				shift,
			) +
				0x01010101) >>>
			0;
		data.writeUInt32LE(mixed, from);
		place = (place + 1) % SECRET_WORDS;
	}
	for (let at = words * WORD_PLACES; at < data.length; at += 1) {
		const tail = data.length - at;
		data[at] =
			(((data[at] ?? 0) ^ ((secret[place] ?? 0) >>> (tail * 4))) -
				scheme.indexSubtrahend) &
			TAIL_BYTE;
		place = (place + 1) % SECRET_WORDS;
	}
}

/** `EncryptIndexStage1`: the same, the other way. */
export function encryptCpzIndexStage1(
	data: Buffer,
	key: number,
	scheme: Cpz5Scheme,
): void {
	const secret = indexSecret(scheme, key);
	const shift = stage1Shift(key);
	const words = Math.floor(data.length / WORD_PLACES);
	let place = 5;
	for (let at = 0; at < words; at += 1) {
		const from = at * WORD_PLACES;
		const word = data.readUInt32LE(from);
		const mixed =
			(rotateLeft((word - 0x01010101) >>> 0, shift) - scheme.indexAddend) >>> 0;
		data.writeUInt32LE((mixed ^ (secret[place] ?? 0)) >>> 0, from);
		place = (place + 1) % SECRET_WORDS;
	}
	for (let at = words * WORD_PLACES; at < data.length; at += 1) {
		const tail = data.length - at;
		data[at] =
			(((data[at] ?? 0) + scheme.indexSubtrahend) ^
				((secret[place] ?? 0) >>> (tail * 4))) &
			TAIL_BYTE;
		place = (place + 1) % SECRET_WORDS;
	}
}

/** `DecryptIndexDirectory`: the mix over the places of the directories of an index. */
export function decryptCpzIndexDirectory(
	data: Buffer,
	length: number,
	key: readonly number[],
	archiveKey: number,
): void {
	let seed = INDEX_SEED >>> 0;
	const words = Math.floor(length / WORD_PLACES);
	let place = 0;
	for (let at = 0; at < words; at += 1) {
		const from = at * WORD_PLACES;
		const word = data.readUInt32LE(from);
		const mixed =
			(rotateLeft(
				((word ^ (key[at & 3] ?? 0)) >>> 0) - INDEX_DIRECTORY_ADDEND,
				3,
			) -
				seed) >>>
			0;
		data.writeUInt32LE(mixed, from);
		seed = (seed + (INDEX_DIRECTORY_STEP ^ archiveKey)) >>> 0;
	}
	// The places behind the words stand of the place the count of the words left the walk at, the way the
	// reference leaves its own counter behind: a run of a count of words that is not a multiple of four
	// therefore stands of another place of the key than a run that is.
	place = words;
	for (let at = words * WORD_PLACES; at < length; at += 1) {
		data[at] =
			(((data[at] ?? 0) ^ ((key[place++ & 3] ?? 0) >>> 6)) + 0x37) & TAIL_BYTE;
	}
}

/** `EncryptIndexDirectory`: the same, the other way. The reference stands of no key of an archive here. */
export function encryptCpzIndexDirectory(
	data: Buffer,
	length: number,
	key: readonly number[],
): void {
	let seed = INDEX_SEED >>> 0;
	const words = Math.floor(length / WORD_PLACES);
	let place = 0;
	for (let at = 0; at < words; at += 1) {
		const from = at * WORD_PLACES;
		const word = data.readUInt32LE(from);
		const mixed =
			(rotateRight((word + seed) >>> 0, 3) + INDEX_DIRECTORY_ADDEND) >>> 0;
		data.writeUInt32LE((mixed ^ (key[at & 3] ?? 0)) >>> 0, from);
		seed = (seed + INDEX_DIRECTORY_STEP) >>> 0;
	}
	place = words;
	for (let at = words * WORD_PLACES; at < length; at += 1) {
		data[at] =
			(((data[at] ?? 0) - 0x37) ^ ((key[place++ & 3] ?? 0) >>> 6)) & TAIL_BYTE;
	}
}

/**
 * The places the reference holds a run of the entries of a directory to: the run stands within the places
 * of the index it was read of. The reference throws of both a place behind the run and a count that runs
 * past it, and this port turns either of them onto the error of the project.
 */
function checkRun(data: Buffer, at: number, length: number): void {
	if (at < 0 || at > data.length) {
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`CVNS index entry run at ${at} stands outside ${data.length} places`,
		);
	}
	if (length < 0 || length > data.length - at) {
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`CVNS index entry run of ${length} places at ${at} runs past ${data.length} places`,
		);
	}
}

/** `DecryptIndexEntry`: the mix over the places of a run of the entries of a directory. */
export function decryptCpzIndexEntry(
	data: Buffer,
	at: number,
	length: number,
	key: readonly number[],
	seed: number,
	archiveKey: number,
): void {
	checkRun(data, at, length);
	let place = 0;
	const words = Math.floor(length / WORD_PLACES);
	for (let word = 0; word < words; word += 1) {
		const from = at + word * WORD_PLACES;
		const value = data.readUInt32LE(from);
		const mixed =
			(rotateLeft(((value ^ (key[word & 3] ?? 0)) >>> 0) - seed, 2) +
				INDEX_ENTRY_TAIL) >>>
			0;
		data.writeUInt32LE(mixed, from);
		seed = (seed - (INDEX_ENTRY_STEP ^ archiveKey)) >>> 0;
	}
	place = words;
	for (let byte = words * WORD_PLACES; byte < length; byte += 1) {
		data[at + byte] =
			(((data[at + byte] ?? 0) ^ ((key[place++ & 3] ?? 0) >>> 4)) + 5) &
			TAIL_BYTE;
	}
}

/** `EncryptIndexEntry`: the same, the other way. The reference stands of no key of an archive here. */
export function encryptCpzIndexEntry(
	data: Buffer,
	at: number,
	length: number,
	key: readonly number[],
	seed: number,
): void {
	checkRun(data, at, length);
	let place = 0;
	const words = Math.floor(length / WORD_PLACES);
	for (let word = 0; word < words; word += 1) {
		const from = at + word * WORD_PLACES;
		const value = data.readUInt32LE(from);
		const mixed =
			(rotateRight((value - INDEX_ENTRY_TAIL) >>> 0, 2) + seed) >>> 0;
		data.writeUInt32LE((mixed ^ (key[word & 3] ?? 0)) >>> 0, from);
		seed = (seed - INDEX_ENTRY_STEP) >>> 0;
	}
	place = words;
	for (let byte = words * WORD_PLACES; byte < length; byte += 1) {
		data[at + byte] =
			(((data[at + byte] ?? 0) - 5) ^ ((key[place++ & 3] ?? 0) >>> 4)) &
			TAIL_BYTE;
	}
}

/**
 * `CpzOpener.UnpackIndexKey`: the key behind the index of the seventh layout, of its own head. The places
 * of the run stand of the places of a key of four within the head of it, and of the tree of the reader of
 * the engine behind that.
 */
export function unpackCpzIndexKey(
	data: Buffer,
	at: number,
	length: number,
): Buffer {
	const keyAt = at + KEY_PLACES_AT;
	const packedAt = at + KEY_PACKED_AT;
	const packedLength = length - KEY_HEAD_PLACES;
	for (let place = 0; place < packedLength; place += 1) {
		data[packedAt + place] =
			(data[packedAt + place] ?? 0) ^ (data[keyAt + (place & 3)] ?? 0);
	}
	const unpackedLength = data.readInt32LE(at + KEY_SIZE_AT);
	return decompressCmvsHuffman(data, packedAt, unpackedLength);
}

/** `CpzOpener.DecryptPs2`: the places of the payload of a `PS2A` run, of the key of its own head. */
export function decryptCpzPs2(data: Buffer): void {
	let key = data.readUInt32LE(12);
	const shift = (((key >>> 20) % 5) + 1) | 0;
	key = ((key >>> 24) + (key >>> 3)) >>> 0;
	for (let at = LZSS_HEAD; at < data.length; at += 1) {
		data[at] = rotateByteRight(
			((key ^ ((data[at] ?? 0) - 0x7c)) & 0xff) >>> 0,
			shift,
		);
	}
}

/**
 * `CpzOpener.UnpackPs2`: the places of a `PS2A` payload, of the head of it and of the window walk of
 * `UnpackLzss`, which the opener of the older layouts of the engine stands of as well.
 */
export function unpackCpzPs2(data: Buffer): Buffer {
	decryptCpzPs2(data);
	return unpackCpzLzss(data);
}

/** `CpzOpener.DecryptPb3`: the places of a `PB3B` payload, of two places of its own tail. */
export function decryptCpzPb3(data: Buffer): void {
	const first = data[data.length - 3] ?? 0;
	const second = data[data.length - 2] ?? 0;
	let src = data.length - 0x2f;
	for (let at = 8; at < 0x34; at += 2) {
		data[at] = ((data[at] ?? 0) ^ first) & TAIL_BYTE;
		data[at] = ((data[at] ?? 0) - (data[src++] ?? 0)) & TAIL_BYTE;
		data[at + 1] = ((data[at + 1] ?? 0) ^ second) & TAIL_BYTE;
		data[at + 1] = ((data[at + 1] ?? 0) - (data[src++] ?? 0)) & TAIL_BYTE;
	}
}

/** `CpzOpener.EncryptPb3`: the same, the other way. */
export function encryptCpzPb3(data: Buffer): void {
	const first = data[data.length - 3] ?? 0;
	const second = data[data.length - 2] ?? 0;
	let src = data.length - 0x2f;
	for (let at = 8; at < 0x34; at += 2) {
		data[at] = ((data[at] ?? 0) + (data[src++] ?? 0)) & TAIL_BYTE;
		data[at] = ((data[at] ?? 0) ^ first) & TAIL_BYTE;
		data[at + 1] = ((data[at + 1] ?? 0) + (data[src++] ?? 0)) & TAIL_BYTE;
		data[at + 1] = ((data[at + 1] ?? 0) ^ second) & TAIL_BYTE;
	}
}
