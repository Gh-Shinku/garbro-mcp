// Format reference: GARbro "ArcFormats/Lucifen/ArcLPK.cs", class `EncryptionScheme` and its helpers.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** A 32 bit rotate right, mirroring `Binary.RotR`. */
export function rotateRight(value: number, count: number): number {
	const shift = count & 31;
	if (shift === 0) return value >>> 0;
	return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/** A 32 bit rotate left, mirroring `Binary.RotL`. */
export function rotateLeft(value: number, count: number): number {
	const shift = count & 31;
	if (shift === 0) return value >>> 0;
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** A byte nibble swap, mirroring `Binary.RotByteR (value, 4)`. */
export function rotateByteRight(value: number, count: number): number {
	const shift = count & 7;
	if (shift === 0) return value & 0xff;
	return (((value >>> shift) | (value << (8 - shift))) & 0xff) >>> 0;
}

export interface LpkKey {
	key1: number;
	key2: number;
}

export interface EncryptionScheme {
	baseKey: LpkKey;
	contentXor: number;
	rotatePattern: number;
}

/** The built in scheme every archive starts with. */
export const DEFAULT_SCHEME: EncryptionScheme = {
	baseKey: { key1: 0xa5b9ac6b, key2: 0x9a639de5 },
	contentXor: 0x5d,
	rotatePattern: 0x31746285,
};

/** `EncryptionScheme.DecryptContent`: a content XOR followed by a nibble swap. */
export function decryptContent(data: Buffer, scheme: EncryptionScheme): void {
	for (let i = 0; i < data.length; i += 1) {
		const value = (data[i] ?? 0) ^ scheme.contentXor;
		data[i] = rotateByteRight(value, 4) & 0xff;
	}
}

/** `EncryptionScheme.DecryptIndex`: a rotating key XOR over whole little endian words. */
export function decryptIndex(
	data: Buffer,
	length: number,
	key: number,
	scheme: EncryptionScheme,
): void {
	let pattern = scheme.rotatePattern;
	let current = key >>> 0;
	const words = Math.trunc(length / 4);
	for (let i = 0; i < words; i += 1) {
		const position = i * 4;
		if (position + 4 > data.length) break;
		data.writeUInt32LE((data.readUInt32LE(position) ^ current) >>> 0, position);
		pattern = rotateLeft(pattern, 4);
		current = rotateRight(current, pattern);
	}
}

/** `EncryptionScheme.DecryptEntry`: the mirror image of the index rotation. */
export function decryptEntry(
	data: Buffer,
	length: number,
	key: number,
	scheme: EncryptionScheme,
): void {
	let pattern = scheme.rotatePattern;
	let current = key >>> 0;
	const words = Math.trunc(length / 4);
	for (let i = 0; i < words; i += 1) {
		const position = i * 4;
		if (position + 4 > data.length) break;
		data.writeUInt32LE((data.readUInt32LE(position) ^ current) >>> 0, position);
		pattern = rotateRight(pattern, 4);
		current = rotateLeft(current, pattern);
	}
}
