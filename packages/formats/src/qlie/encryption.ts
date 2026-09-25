// Format reference: GARbro "ArcFormats/Qlie/Encryption.cs", the `QlieEncryption` classes, and the
// packed helpers of `MMX` at "ArcFormats/ArcCommon.cs".
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";

const MASK_32 = 0xffffffffn;
const MASK_64 = 0xffffffffffffffffn;
/** `QlieEntry.EncryptionMethod` of no places of the file of the engine. */
export const ENCRYPTION_NONE = 0;
export const ENCRYPTION_V1 = 1;
export const ENCRYPTION_V2 = 2;
/** The places of the file of the key of the walk of the engine of the letters of the name of it. */
const NAME_KEY = 0xc4;
const NAME_SEED = 0x3e;
const KEY_STEP = 0xce24f523ce24f523n;
const HASH_SEED = 0xa73c5f9da73c5f9dn;
const ROLLING_KEY = 0xfec9753e;

/** The places of the file of the index of the engine: of the walk of the places of the file of a hash. */
export type QlieIndexLayout = "without-hash" | "with-hash";

/** `IEncryption`: the walk of the places of the file of a name and of an entry of the engine. */
export interface QlieEncryption {
	readonly isUnicode: boolean;
	readonly indexLayout: QlieIndexLayout;
	readonly arcKey: number;
	readonly nameKey: number;
	calculateHash(data: Buffer, length: number): number;
	decryptName(name: Buffer): string;
	decryptEntry(
		data: Buffer,
		offset: number,
		length: number,
		entry: QlieEntryPlace,
	): void;
}

/** The places of the file of an entry of the engine of the walk of the places of the file of it. */
export interface QlieEntryPlace {
	/** The count of the walk of the places of the file of the engine: 0 stands of no walk of it. */
	encryptionMethod: number;
	/** The name of the entry of the engine, of the letters of the file of the walk of it. */
	name: string;
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `MMX.PAddD`: the places of the file of the walk of the engine of the two places of a picture. */
export function packedAddDwords(x: bigint, y: bigint): bigint {
	const low = ((x & MASK_32) + (y & MASK_32)) & MASK_32;
	const high = (((x >> 32n) & MASK_32) + ((y >> 32n) & MASK_32)) & MASK_32;
	return (high << 32n) | low;
}

/** `MMX.PAddW`: the places of the file of the walk of the engine of the four places of a picture. */
export function packedAddWords(x: bigint, y: bigint): bigint {
	let out = 0n;
	for (let at = 0n; at < 4n; at += 1n) {
		const shift = at * 16n;
		const lane = ((x >> shift) + (y >> shift)) & 0xffffn;
		out |= lane << shift;
	}
	return out;
}

/** `MMX.PAddB`: the places of the file of the walk of the engine of the eight places of a picture. */
export function packedAddBytes(x: bigint, y: bigint): bigint {
	let out = 0n;
	for (let at = 0n; at < 8n; at += 1n) {
		const shift = at * 8n;
		const lane = ((x >> shift) + (y >> shift)) & 0xffn;
		out |= lane << shift;
	}
	return out;
}

/** `MMX.PSllD`: the places of the file of the walk of the engine of the two places of a picture. */
export function packedShiftLeftDwords(x: bigint, count: number): bigint {
	const size = BigInt(count & 0x1f);
	const low = (0xffffffffn << size) & MASK_32;
	const mask = low | (low << 32n);
	return (x << size) & MASK_64 & mask;
}

/** `MMX.PSrlD`. */
export function packedShiftRightDwords(x: bigint, count: number): bigint {
	const size = BigInt(count & 0x1f);
	const low = (0xffffffffn >> size) & MASK_32;
	const mask = low | (low << 32n);
	return (x >> size) & mask;
}

function signed16(value: bigint): number {
	const place = Number(value & 0xffffn);
	return place >= 0x8000 ? place - 0x10000 : place;
}

/** `QlieEncryption.DecryptName` of the two first kinds of the walk of the engine. */
function decryptNameRolling(name: Buffer, key: number): string {
	for (let at = 0; at < name.length; at += 1) {
		const value = (((at + 1) ^ key) + at + 1) & 0xff;
		name[at] = (name[at] ?? 0) ^ value;
	}
	return decodeCp932(name);
}

/**
 * `IEncryption` of the pictures of the two first kinds of the engine: the walk of the places of the
 * file of the name and of the entry of it of the places of the file of the key of the engine itself.
 */
class RollingEncryption implements QlieEncryption {
	readonly isUnicode = false;
	readonly nameKey = NAME_KEY;

	constructor(
		readonly indexLayout: QlieIndexLayout,
		private readonly lengthInNameKey: boolean,
		readonly arcKey = 0,
	) {}

	calculateHash(): number {
		// `CalculateHash` stands of 0 of the places of the file of the two first walks of the engine.
		return 0;
	}

	decryptName(name: Buffer): string {
		const extra = this.lengthInNameKey ? name.length : 0;
		return decryptNameRolling(name, extra + (NAME_KEY ^ NAME_SEED));
	}

	decryptEntry(data: Buffer, offset: number, length: number): void {
		if (offset < 0 || length > data.length || offset > data.length - length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The walk of the places of the file stands of no places of the file of it",
			);
		}
		const rollingKey = this.lengthInNameKey
			? ((length + this.arcKey) & 0xffffffff) ^ ROLLING_KEY
			: (this.arcKey ^ ROLLING_KEY) >>> 0;
		let hash = HASH_SEED;
		const wide = BigInt(rollingKey >>> 0);
		let xor = wide | (wide << 32n);
		for (let at = offset; at + 8 <= offset + length; at += 8) {
			hash = packedAddDwords(hash, KEY_STEP) ^ xor;
			const value = readUInt64(data, at);
			xor = value ^ hash;
			writeUInt64(data, at, xor);
		}
	}
}

function readUInt64(data: Buffer, at: number): bigint {
	return (
		BigInt(data.readUInt32LE(at)) | (BigInt(data.readUInt32LE(at + 4)) << 32n)
	);
}

function writeUInt64(data: Buffer, at: number, value: bigint): void {
	data.writeUInt32LE(Number(value & MASK_32), at);
	data.writeUInt32LE(Number((value >> 32n) & MASK_32), at + 4);
}

/** `QlieEncryption.Create` of the engine: the walk of the places of the file of the version of it. */
export function createQlieEncryption(
	versionMajor: number,
	versionMinor: number,
	keyData: Buffer | undefined,
	layout?: QlieIndexLayout,
): QlieEncryption {
	if (1 === versionMajor) {
		return new RollingEncryption(layout ?? "without-hash", false);
	}
	if (2 === versionMajor) {
		return new RollingEncryption(layout ?? "with-hash", true);
	}
	if (!keyData) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"The archive of the engine stands of no places of the file of the key of the engine of it",
		);
	}
	if (3 === versionMajor && 1 === versionMinor) {
		return new EncryptionV31(keyData);
	}
	if (3 === versionMajor && 0 === versionMinor) {
		return new EncryptionV3(keyData);
	}
	throw unsupported(
		`A picture of the engine of the places of the file of the version of it ${versionMajor}.${versionMinor}`,
	);
}

/**
 * `EncryptionV3`: the walk of the engine of the third kind of it. The places of the file of a key file
 * (`key.fkey` of the game) and of the places of the file of the key of the engine itself stand of the
 * walk of the places of the file of the engine of no places of the file of it in the reference; this
 * port carries the walk of the places of the file of the entries of the engine of no places of the key
 * of it alone (the walk of the second kind of it).
 */
export class EncryptionV3 implements QlieEncryption {
	readonly isUnicode = false;
	readonly indexLayout: QlieIndexLayout = "with-hash";
	readonly arcKey: number;
	readonly nameKey: number;

	private readonly fallback: RollingEncryption;

	constructor(keyData: Buffer) {
		this.arcKey = this.calculateHash(keyData, keyData.length) & 0x0fffffff;
		this.nameKey = this.arcKey;
		this.fallback = new RollingEncryption("with-hash", true, this.arcKey);
	}

	calculateHash(data: Buffer, length: number): number {
		if (length > data.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The places of the file of the walk of the engine stand of no places of it",
			);
		}
		let hash = 0n;
		let key = 0n;
		for (let at = 0; at + 8 <= length; at += 8) {
			hash = packedAddWords(hash, 0x0307030703070307n);
			key = packedAddWords(key, readUInt64(data, at) ^ hash);
		}
		const value = key ^ (key >> 32n);
		return Number(value & MASK_32);
	}

	decryptName(name: Buffer): string {
		return this.fallback.decryptName(name);
	}

	decryptEntry(
		data: Buffer,
		offset: number,
		length: number,
		entry: QlieEntryPlace,
	): void {
		// The places of the file of a key file of the game stand of the walk of the places of the file of
		// the engine of no places of it: of no places of the file of them the walk of the second kind of
		// the engine stands of the walk of the places of the file of the entry of it.
		void entry;
		this.fallback.decryptEntry(data, offset, length);
	}
}

/**
 * `EncryptionV3_1`: the walk of the third kind of the engine of the places of the file of the name of
 * it of the two places of the file of a letter (`Encoding.Unicode`) and of the two walks of the entry
 * of it of the places of the file of the tables of the engine.
 */
export class EncryptionV31 implements QlieEncryption {
	readonly isUnicode = true;
	readonly indexLayout: QlieIndexLayout = "with-hash";
	readonly arcKey: number;
	readonly nameKey: number;

	constructor(keyData: Buffer) {
		this.arcKey = this.calculateHash(keyData, keyData.length) & 0x0fffffff;
		this.nameKey = this.arcKey;
	}

	calculateHash(data: Buffer, length: number): number {
		if (length > data.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The places of the file of the walk of the engine stand of no places of it",
			);
		}
		let hash = 0n;
		let key = 0n;
		for (let at = 0; at + 8 <= length; at += 8) {
			hash = packedAddWords(hash, 0xa35793a7a35793a7n);
			key = packedAddWords(key, readUInt64(data, at) ^ hash);
			key = packedShiftLeftDwords(key, 3) | packedShiftRightDwords(key, 29);
		}
		// `MMX.PMAddWD (key, key >> 32)`, of the places of the file of the two places of a place.
		const value =
			signed16(key) * signed16(key >> 32n) +
			signed16(key >> 16n) * signed16(key >> 48n);
		return value >>> 0;
	}

	decryptName(name: Buffer): string {
		const count = name.length >> 1;
		let hash = (count * count) ^ count;
		hash ^= 0x3e13 ^ (this.nameKey >> 16) ^ this.nameKey;
		hash &= 0xffff;
		let key = hash;
		for (let at = 0; at < count; at += 1) {
			key = (hash + at + 8 * key) | 0;
			name[at * 2] = (name[at * 2] ?? 0) ^ (key & 0xff);
			name[at * 2 + 1] = (name[at * 2 + 1] ?? 0) ^ ((key >> 8) & 0xff);
		}
		return name.toString("utf16le");
	}

	decryptEntry(
		data: Buffer,
		offset: number,
		length: number,
		entry: QlieEntryPlace,
	): void {
		if (ENCRYPTION_NONE === entry.encryptionMethod) return;
		if (offset < 0 || length > data.length || offset > data.length - length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The walk of the places of the file stands of no places of the file of it",
			);
		}
		if (length < 8) return;
		if (ENCRYPTION_V1 === entry.encryptionMethod) {
			this.decryptV1(data, offset, length, entry);
		} else {
			this.decryptV2(data, offset, length, entry);
		}
	}

	/** `EncryptionV3_1.DecryptV1`: the first walk of the places of the file of the entry of the engine. */
	private decryptV1(
		data: Buffer,
		offset: number,
		length: number,
		entry: QlieEntryPlace,
	): void {
		const seed = this.seedOf(
			entry.name,
			length,
			0x85f532,
			0x33f641,
			7,
			0x8f32dc,
		);
		const table = generateTable(0x20, seed, 0x8df21431);
		let at = offset;
		let place = 2 * ((table[0xd] ?? 0) & 0xf);
		let hash = BigInt(table[6] ?? 0) | (BigInt(table[7] ?? 0) << 32n);
		const count = Math.trunc(length / 8);
		for (let i = 0; i < count; i += 1) {
			const t =
				BigInt(table[place] ?? 0) | (BigInt(table[place + 1] ?? 0) << 32n);
			hash = packedAddDwords(hash ^ t, t);
			const value = readUInt64(data, at);
			const place64 = value ^ hash;
			writeUInt64(data, at, place64);
			hash = packedAddBytes(hash, place64) ^ place64;
			hash = packedAddWords(packedShiftLeftDwords(hash, 1), place64);
			at += 8;
			place = (place + 2) & 0x1f;
		}
	}

	/** `EncryptionV3_1.DecryptV2`: the second walk of the places of the file of the entry of the engine. */
	private decryptV2(
		data: Buffer,
		offset: number,
		length: number,
		entry: QlieEntryPlace,
	): void {
		const seed = this.seedOf(
			entry.name,
			length,
			0x86f7e2,
			0x4437f1,
			13,
			0x56e213,
		);
		const table = generateTable(0x20, seed, 0x8a77f473);
		const keyData = generateKeyData();
		let at = offset;
		let place = (8 * ((table[8] ?? 0) & 0xd)) & 0x7f;
		let hash = BigInt(table[6] ?? 0) | (BigInt(table[7] ?? 0) << 32n);
		const count = Math.trunc(length / 8);
		for (let i = 0; i < count; i += 1) {
			const index = 2 * (place & 0xf);
			let t =
				BigInt(table[index] ?? 0) | (BigInt(table[index + 1] ?? 0) << 32n);
			t ^= readUInt64(keyData, 8 * place);
			hash = packedAddDwords(hash ^ t, t);
			const value = readUInt64(data, at);
			const place64 = value ^ hash;
			writeUInt64(data, at, place64);
			hash = packedAddBytes(hash, place64) ^ place64;
			hash = packedAddWords(packedShiftLeftDwords(hash, 1), place64);
			at += 8;
			place = (place + 1) & 0x7f;
		}
	}

	/** The places of the file of the walk of the engine of the entry of the table of it. */
	private seedOf(
		name: string,
		length: number,
		hashSeed: number,
		seedSeed: number,
		step: number,
		xorPlace: number,
	): number {
		let hash = hashSeed;
		let seed = seedSeed;
		for (let at = 0; at < name.length; at += 1) {
			hash = (hash + ((name.charCodeAt(at) << (at & 7)) >>> 0)) >>> 0;
			seed = (seed ^ hash) >>> 0;
		}
		seed =
			(seed +
				(this.arcKey ^
					((step * (length & 0xffffff) +
						length +
						hash +
						(hash ^ length ^ xorPlace)) >>>
						0))) >>>
			0;
		return Math.imul(step, seed & 0xffffff) >>> 0;
	}
}

/** `EncryptionV3_1.DecryptV1`'s table of the walk of the engine. */
export function generateTable(
	length: number,
	seed: number,
	key: number,
): number[] {
	const table: number[] = [];
	let place = BigInt(seed >>> 0);
	const placeKey = BigInt(key >>> 0);
	for (let i = 0; i < length; i += 1) {
		const product = placeKey * ((place ^ placeKey) & 0xffffffffn);
		place = ((product >> 32n) + product) & 0xffffffffn;
		table.push(Number(place));
	}
	return table;
}

/** `EncryptionV3_1.GenerateKeyData` of no places of the file of the key file of the game. */
export function generateKeyData(): Buffer {
	const keyData: Buffer = Buffer.alloc(0x400, 0);
	for (let i = 0; i < 0x100; i += 1) {
		const hash = 0 === i % 3 ? (i + 7) * (i + 3) : (i + 7) * -(i + 3);
		keyData.writeInt32LE(hash | 0, i * 4);
	}
	return keyData;
}
