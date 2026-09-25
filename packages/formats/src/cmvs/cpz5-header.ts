// Port of the head of the newer archives of the CVNS engine: GARbro `GameRes.Formats.Purple.CpzHeader`
// (source `ArcFormats/Cmvs/CpzHeader.cs`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.
//
// Every layout of the engine - `CPZ5`, `CPZ6` and `CPZ7` - spells its version at the fourth place of the
// mark, and everything else of its head stands of **that version**: the places of the fields of the head,
// the constants every field is taken apart with, the place of the entries of the head of the archive, and
// the count of the places of the index. The places of a word of the head stand of the lowest place of a
// byte up, and the head is held to a sum of its own: the places of the first `checksum_length` of them,
// added a word at a time from the lowest of them up, stand of the count the head of the engine names.

import { createHash } from "node:crypto";

/** The words of the digest of the engine, and the places of the index a head stands of. */
const DIGEST_WORDS = 4;
const INDEX_MD5_AT = 0x10;
const INDEX_MD5_PLACES = 0x10;
/** The places of the head of every layout, of the sum of a head, and of the count it stands of. */
const HEAD_SIZE_OLD = 0x40;
const HEAD_SIZE_LONG = 0x48;
const SUM_PLACES_OLD = 0x3c;
const SUM_PLACES_LONG = 0x40;
const SUM_AT_OLD = 0x3c;
const SUM_AT_LONG = 0x44;
/** The count the sum of a head begins at. */
const SUM_START = 0x923a564c;

/** The head of an archive: the places the index and the entries of it stand of. */
export interface CpzHeader {
	version: number;
	dirCount: number;
	dirEntriesSize: number;
	fileEntriesSize: number;
	/** The digest of the engine the walk of the entries stands of. */
	digest: readonly number[];
	masterKey: number;
	isEncrypted: boolean;
	entryKey: number;
	indexKeySize: number;
	checksum: number;
	initChecksum: number;
	indexOffset: number;
	indexSize: number;
	indexMd5: Buffer;
	entryNameOffset: number;
	isLongSize: boolean;
}

/**
 * The places of the head of a layout, of the count the sum of it stands over, and of the place the sum
 * itself stands at: the newer layout carries a count of the places of the key of its index behind the sum,
 * so the sum covers places the head does not end at.
 */
function placesOf(version: number): {
	size: number;
	sum: number;
	at: number;
} {
	return version < 7
		? { size: HEAD_SIZE_OLD, sum: SUM_PLACES_OLD, at: SUM_AT_OLD }
		: { size: HEAD_SIZE_LONG, sum: SUM_PLACES_LONG, at: SUM_AT_LONG };
}

/**
 * `CpzHeader.CheckSum`: the sum the head of an archive is held to. The words of the run stand of the lowest
 * place of a byte up and are added one after the other, of the places behind the last whole word added a
 * place at a time.
 */
export function cpzChecksum(
	data: Buffer,
	at: number,
	length: number,
	sum: number,
): number {
	let checksum = sum >>> 0;
	const words = Math.floor(length / 4);
	for (let place = 0; place < words; place += 1) {
		checksum = (checksum + data.readUInt32LE(at + place * 4)) >>> 0;
	}
	const from = at + (length & ~3);
	for (let place = 0; place < (length & 3); place += 1) {
		checksum = (checksum + (data[from + place] ?? 0)) >>> 0;
	}
	return checksum;
}

/** `Binary.RotR`: a rotation of a word of thirty two places, of the lowest five places of the count. */
function rotateRight(word: number, count: number): number {
	const places = count & 31;
	return ((word >>> places) | (word << (32 - places))) >>> 0;
}

/** `CpzHeader.Parse`: the head of an archive, of the version its mark spells. */
export function readCpzHeader(data: Buffer): CpzHeader | undefined {
	if (data.length < 4) return undefined;
	if (!data.subarray(0, 3).equals(Buffer.from("CPZ", "ascii")))
		return undefined;
	const digit = data[3] ?? 0;
	if (digit < 0x30 || digit > 0x39) return undefined;
	const version = digit - 0x30;
	const places = placesOf(version);
	if (data.length < places.size) return undefined;
	const header = data.subarray(0, places.size);
	const head: CpzHeader = {
		version,
		dirCount: 0,
		dirEntriesSize: 0,
		fileEntriesSize: 0,
		digest: [0, 0, 0, 0],
		masterKey: 0,
		isEncrypted: false,
		entryKey: 0,
		indexKeySize: 0,
		checksum: header.readUInt32LE(places.at),
		initChecksum: SUM_START,
		indexOffset: 0,
		indexSize: 0,
		indexMd5: Buffer.from(
			header.subarray(INDEX_MD5_AT, INDEX_MD5_AT + INDEX_MD5_PLACES),
		),
		entryNameOffset: 0x18,
		isLongSize: version > 6,
	};
	// The places of the index: the two counts of the entries of it, and, of the newer layout, the count of
	// the places of the key of the index behind them.
	head.dirCount =
		(header.readInt32LE(4) ^ (version < 6 ? -0x1c5ac27 : -0x1c5ac26)) | 0;
	head.dirEntriesSize =
		header.readInt32LE(8) ^ (version < 6 ? 0x37f298e7 : 0x37f298e8);
	head.fileEntriesSize =
		header.readInt32LE(0x0c) ^ (version < 6 ? 0x7a6f3a2c : 0x7a6f3a2d);
	head.masterKey =
		(header.readUInt32LE(0x30) ^ (version < 6 ? 0xae7d39bf : 0xae7d39b7)) >>> 0;
	head.isEncrypted =
		0 !== (header.readUInt32LE(0x34) ^ (version < 6 ? 0xfb73a955 : 0xfb73a956));
	const digest: number[] = [];
	for (let at = 0; at < DIGEST_WORDS; at += 1) {
		const addend = version < 6 ? 0x43de7c19 : 0x43de7c1a;
		digest.push((header.readUInt32LE(0x20 + at * 4) ^ (addend + at)) >>> 0);
	}
	head.digest = digest;
	if (version >= 6) {
		// The key of the entries of an archive of the newer layouts stands of a turn of its own.
		const entryKey = (header.readUInt32LE(0x38) ^ 0x37acf832) >>> 0;
		head.entryKey =
			(0x13712765 + Math.imul(0x7da8f173, rotateRight(entryKey, 5))) >>> 0;
	}
	if (version >= 7) {
		const indexKeySize = header.readInt32LE(0x40);
		head.indexKeySize = (indexKeySize ^ 0x65ef99f3) | 0;
		head.initChecksum = ((indexKeySize >>> 0) - 0x6dc5a9b4) >>> 0;
		head.entryNameOffset = 0x1c;
	}
	head.indexOffset = version < 7 ? HEAD_SIZE_OLD : HEAD_SIZE_LONG;
	head.indexSize =
		(head.dirEntriesSize +
			head.fileEntriesSize +
			(version < 7 ? 0 : head.indexKeySize)) >>>
		0;
	if (head.checksum !== cpzChecksum(header, 0, places.sum, head.initChecksum)) {
		return undefined;
	}
	return head;
}

/**
 * `CpzHeader.VerifyIndex`: the places of the index of an archive, held to the digest of the head of it and,
 * of the newer layouts of the engine, to the digest of the key behind them.
 */
export function verifyCpzIndex(header: CpzHeader, index: Buffer): boolean {
	if (index.length !== header.indexSize) return false;
	if (!createHash("md5").update(index).digest().equals(header.indexMd5)) {
		return false;
	}
	if (header.version > 6 && header.indexKeySize > INDEX_MD5_PLACES) {
		const entries = header.dirEntriesSize + header.fileEntriesSize;
		const key = index.subarray(
			entries + INDEX_MD5_PLACES,
			entries + header.indexKeySize,
		);
		const named = index.subarray(entries, entries + INDEX_MD5_PLACES);
		if (!createHash("md5").update(key).digest().equals(named)) return false;
	}
	return true;
}
