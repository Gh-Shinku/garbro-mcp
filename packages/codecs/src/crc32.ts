const CRC32_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	CRC32_TABLE[index] = value >>> 0;
}

/** The raw reflected form, which stands of the places of the picture of the walk of the places of the picture
 * of the words of the walk of the places of the picture of the walk of them of the places of the picture of the
 * walk of the places of the picture of the kind of the places of the picture of the walk of them of the places
 * of the picture of their own where the places of the picture of the walk of the places of the picture of the
 * sound of the places of the picture of the walk of the places of the picture of the kind of the places of the
 * picture of the walk of the places of the picture of the places of the picture of the walk of the places of the
 * picture. */
export function crc32Update(input: Uint8Array, init = 0): number {
	let value = init >>> 0;
	for (const byte of input) {
		value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
	}
	return value >>> 0;
}

export function crc32(input: Uint8Array): number {
	return (crc32Update(input, 0xffffffff) ^ 0xffffffff) >>> 0;
}

const CRC32_NORMAL_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC32_NORMAL_TABLE.length; index += 1) {
	let value = (index << 24) >>> 0;
	for (let bit = 0; bit < 8; bit += 1) {
		value =
			0 !== (value & 0x80000000)
				? (0x04c11db7 ^ (value << 1)) >>> 0
				: (value << 1) >>> 0;
	}
	CRC32_NORMAL_TABLE[index] = value >>> 0;
}

/**
 * The CRC-32 of the normal polynomial, which the Ogg pages of several engines carry. The polynomial stands the
 * other way round from the one `crc32` holds — its highest place first and its places not turned about — the
 * value begins where the caller says and nothing stands over it at the end. The engines that write an Ogg page
 * begin their value at nought, which is what the reference's `Crc32Normal.UpdateCrc` is given.
 */
export function crc32Normal(input: Uint8Array, init = 0): number {
	let value = init >>> 0;
	for (const byte of input) {
		value =
			((CRC32_NORMAL_TABLE[(value >>> 24) ^ byte] ?? 0) ^ (value << 8)) >>> 0;
	}
	return value >>> 0;
}
