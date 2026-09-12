const CRC32_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	CRC32_TABLE[index] = value >>> 0;
}

export function crc32(input: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of input) {
		value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
	}
	return (value ^ 0xffffffff) >>> 0;
}
