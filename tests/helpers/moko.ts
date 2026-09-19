const KEY_FIRST = 1;
const KEY_SECOND = 0x23;

/** Mirrors GARbro `MokoCrypt.Decrypt`, which the fixtures use as an oracle while building payloads. */
export function decryptMoko(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = output.length - 2; i >= 0; i -= 1) {
		output[i] = (output[i] ?? 0) ^ (KEY_SECOND ^ (output[i + 1] ?? 0));
		output[i + 1] = (output[i + 1] ?? 0) ^ (KEY_FIRST ^ (output[i] ?? 0));
	}
	return output;
}

/**
 * Encrypts a payload by inverting the reference loop. Every byte but the last follows from the byte behind it,
 * and the last byte is found by trying all values against the reference loop itself.
 */
export function encryptMoko(plain: Buffer): Buffer {
	const cipher = Buffer.alloc(plain.length);
	for (let i = 0; i < plain.length - 1; i += 1)
		cipher[i] = (plain[i + 1] ?? 0) ^ KEY_FIRST ^ KEY_SECOND;
	for (let candidate = 0; candidate < 0x100; candidate += 1) {
		cipher[plain.length - 1] = candidate;
		if (decryptMoko(cipher).equals(plain)) return cipher;
	}
	throw new Error("Plaintext is not reachable through the reference loop");
}

/** Wraps an encrypted payload in the head of the container of the Mokopro engine. */
export function buildNnnn(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(8, 0x00);
	header.write("NNNN", 0, "latin1");
	header.writeInt32LE(unpackedSize, 4);
	return Buffer.concat([header, encryptMoko(stream)]);
}
