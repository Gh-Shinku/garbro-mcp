// The data encryption standard, the way GARbro stands it: "ArcFormats/StudioJikkenshitsu/SjTransform.cs" is
// the standard cipher, its tables being the tables of the standard, and the two ways the tables of its own
// shuffle the places of a block being the ways the standard shuffles them. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference stands the cipher over a stream as the .NET `CryptoStream` does: every whole block of the
// stream stands under the cipher, and the places of a block that do not stand whole stand as they stand.

/** How many bytes stand in a block of the cipher, and how many places of a colour its key holds. */
export const DES_BLOCK_SIZE = 8;
const DES_KEY_SIZE = 8;
const HALF_BITS = 28;
const SIDE_BITS = 32;

/** The order the places of a block stand in first. */
const IP = [
	58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38,
	30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1,
	59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39,
	31, 23, 15, 7,
];
/** The order they stand in last, which stands the places of the first order back where they stood. */
const FP = [
	40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14,
	54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
	35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9,
	49, 17, 57, 25,
];
/** The order the places of the side of a block stand in where a step of the walk takes them up. */
const E = [
	32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16,
	17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29,
	28, 29, 30, 31, 32, 1,
];
/** The order the places of the side of a block stand in behind a step of the walk. */
const P = [
	16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32,
	27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
/** The order the places of a key stand in where the key stands as two halves, the places of a colour that
 * stand in every byte of the key being left out. */
const PC1 = [
	57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
	27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38,
	30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
/** The order the places of those halves stand in where a step of the walk takes its own key. */
const PC2 = [
	14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27,
	20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34,
	53, 46, 42, 50, 36, 29, 32,
];
/** How many places of the halves of a key stand before a step of the walk takes up its own key. */
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

/** The tables a step of the walk stands six places of a block as four places by. */
const S_BOXES: readonly (readonly number[])[] = [
	[
		14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2,
		13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7,
		3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
	],
	[
		15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8,
		14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9,
		3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
	],
	[
		10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6,
		10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5,
		10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
	],
	[
		7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15,
		0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14,
		5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
	],
	[
		2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7,
		13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6,
		3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
	],
	[
		12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12,
		9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1,
		13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
	],
	[
		4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1,
		10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0,
		5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
	],
	[
		13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3,
		7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13,
		15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
	],
];

const MASK_28 = 0xfffffffn;
const MASK_32 = 0xffffffffn;
const MASK_48 = 0xffffffffffffn;
const MASK_64 = 0xffffffffffffffffn;

/** The places of a block as places of a number, the highest place of the block standing first. */
function toBits(bytes: Uint8Array): bigint {
	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);
	return value;
}

function toBytes(value: bigint, size: number): Buffer {
	const out: Buffer = Buffer.alloc(size, 0x00);
	for (let at = size - 1; at >= 0; at -= 1) {
		out[at] = Number(value & 0xffn);
		value >>= 8n;
	}
	return out;
}

/** The places of a block in the order a table names, every place of the table naming a place of the block
 * counting from its highest place. */
function permute(
	value: bigint,
	table: readonly number[],
	places: number,
): bigint {
	let out = 0n;
	for (const place of table) {
		out = (out << 1n) | ((value >> BigInt(places - place)) & 1n);
	}
	return out;
}

/** The keys the steps of the walk stand over, one for every step. */
function expandKey(key: Uint8Array): bigint[] {
	const halves = permute(toBits(key), PC1, 64);
	let left = halves >> 28n;
	let right = halves & MASK_28;
	const subkeys: bigint[] = [];
	for (const shift of SHIFTS) {
		const places = BigInt(shift);
		left =
			((left << places) | (left >> (BigInt(HALF_BITS) - places))) & MASK_28;
		right =
			((right << places) | (right >> (BigInt(HALF_BITS) - places))) & MASK_28;
		subkeys.push(permute((left << 28n) | right, PC2, 56));
	}
	return subkeys;
}

/** The places a step of the walk stands the side of a block as. */
function feistel(right: bigint, subkey: bigint): bigint {
	const mixed = permute(right, E, SIDE_BITS) ^ subkey;
	let out = 0n;
	for (let box = 0; box < S_BOXES.length; box += 1) {
		const six = Number((mixed >> BigInt(42 - 6 * box)) & 0x3fn);
		const row = ((six & 0x20) >> 4) | (six & 1);
		const column = (six >> 1) & 0x0f;
		out = (out << 4n) | BigInt(S_BOXES[box]?.[row * 16 + column] ?? 0);
	}
	return permute(out, P, SIDE_BITS);
}

function cryptBlock(block: Uint8Array, subkeys: readonly bigint[]): Buffer {
	if (block.length !== DES_BLOCK_SIZE) {
		throw new RangeError("A block of the standard cipher holds eight places");
	}
	let left = permute(toBits(block), IP, 64) >> 32n;
	let right = permute(toBits(block), IP, 64) & MASK_32;
	for (const subkey of subkeys) {
		const next = left ^ feistel(right, subkey);
		left = right;
		right = next;
	}
	return toBytes(permute(((right << 32n) | left) & MASK_64, FP, 64), 8);
}

function subkeysFor(key: Uint8Array): bigint[] {
	if (key.length !== DES_KEY_SIZE) {
		throw new RangeError("A key of the standard cipher holds eight places");
	}
	return expandKey(key);
}

/** The places of a block stand as the places of the block under the key. */
export function desEncryptBlock(block: Uint8Array, key: Uint8Array): Buffer {
	return cryptBlock(block, subkeysFor(key));
}

/** The places of a block stand back as they stood before the block stood under the key, the steps of the walk
 * standing the other way round. */
export function desDecryptBlock(block: Uint8Array, key: Uint8Array): Buffer {
	return cryptBlock(block, subkeysFor(key).reverse());
}

/**
 * Every whole block of a stream stands under the cipher, and the places of a block that do not stand whole
 * stand as they stand, which is what the reference's stream does with the last places of a stream.
 */
export function desEcbDecrypt(data: Uint8Array, key: Uint8Array): Buffer {
	const subkeys = subkeysFor(key).reverse();
	const whole = data.length - (data.length % DES_BLOCK_SIZE);
	const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const out: Buffer = Buffer.alloc(data.length, 0x00);
	for (let at = 0; at < whole; at += DES_BLOCK_SIZE) {
		cryptBlock(source.subarray(at, at + DES_BLOCK_SIZE), subkeys).copy(out, at);
	}
	source.copy(out, whole, whole);
	return out;
}

/** The same, standing the places of a stream under the cipher the other way. */
export function desEcbEncrypt(data: Uint8Array, key: Uint8Array): Buffer {
	const subkeys = subkeysFor(key);
	const whole = data.length - (data.length % DES_BLOCK_SIZE);
	const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const out: Buffer = Buffer.alloc(data.length, 0x00);
	for (let at = 0; at < whole; at += DES_BLOCK_SIZE) {
		cryptBlock(source.subarray(at, at + DES_BLOCK_SIZE), subkeys).copy(out, at);
	}
	source.copy(out, whole, whole);
	return out;
}

/** The places of a key the reference stands a key of its own as, every place of a colour of the key standing
 * as the four low places of it, the places of a key that hold nought and every place behind them left out. */
export function expandNibbleKey(
	key: Uint8Array,
	keySize = DES_KEY_SIZE,
): Buffer {
	const bits: number[] = [];
	for (const byte of key) {
		if (0 === byte || bits.length >= keySize * 8) break;
		bits.push((byte >> 3) & 1, (byte >> 2) & 1, (byte >> 1) & 1, byte & 1);
	}
	while (bits.length < keySize * 8) bits.push(0);
	const out: Buffer = Buffer.alloc(keySize, 0x00);
	for (let at = 0; at < bits.length; at += 1) {
		out[at >> 3] =
			((out[at >> 3] ?? 0) | ((bits[at] ?? 0) << (7 - (at & 7)))) & 0xff;
	}
	return out;
}
