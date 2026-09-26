// Port of the BSHF cipher of the Entis GLS engine, from GARbro "ArcFormats/Entis/ArcNOA.cs" — the classes
// `BSHFDecodeContext` and `ERIBshfBuffer` — at GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.
//
// A stream of this cipher is decoded thirty two bytes at a time. Each block of thirty two bytes is a bag of
// two hundred and fifty six bits, and the password says where each bit of the source lands: walking the
// password from a place that advances by one for every block, the cipher adds a password byte to a counter
// and takes the low three bits of the counter as a place inside a byte and the rest as the byte itself. The
// byte the counter names is then scanned forward, whole bytes at a time and then bit by bit, until a place
// stands free; that free place takes the next bit of the source, and the scan continues from there for the
// bit behind it. Every place is taken exactly once, so the block comes out as a permutation of the bits of
// the source. A password of zero bytes does **not** leave the block where it is: the counter stands still but
// the scan keeps moving, so the first eight bits of the source land in the first byte of the block in
// reverse order, the next eight skip the second byte and land in the third, and the second byte is only
// reached once the scan has come round again.
//
// The reference expands a password of fewer than thirty two bytes to thirty two: the byte `0x1b` follows
// the password and every byte behind it is the sum of the byte at the place the count wraps to and the byte
// before it. A password of thirty two bytes or more stands as it is.
//
// The reference reads the coded bytes into a buffer of `m_nBufferingSize` and fills its thirty two byte
// block from that buffer, so a stream whose length is not a multiple of thirty two loses its last, short
// block. That is what the port does as well.

const BLOCK_SIZE = 32;
const BIT_COUNT = BLOCK_SIZE * 8;
const PASSWORD_MINIMUM = 32;
const PASSWORD_FILL = 0x1b;
const BYTE_BITS = 8;
const FULL_BYTE = 0xff;
const HIGH_BIT = 0x80;

/** The reference reads through a buffer of this many bytes, rounded up to a multiple of four. */
export const BSHF_BUFFERING_SIZE = 0x10000;

function invalidCipher(message: string): Error {
	return new Error(message);
}

/**
 * `BSHFDecodeContext.PrepareToDecodeBSHFCode`: the bytes of the password, expanded to thirty two of them
 * when it is shorter. The reference takes the password as ASCII.
 */
export function prepareBshfPassword(password: string): Uint8Array {
	const text = "" === password ? " " : password;
	// The reference takes the bytes of the password as ASCII, where a character outside that set stands as a
	// question mark; the ASCII encoding of this project keeps the low seven bits instead, so the bytes are
	// taken one by one here.
	const given = Buffer.alloc(text.length, 0x3f);
	for (let at = 0; at < text.length; at += 1) {
		const code = text.charCodeAt(at);
		given[at] = code < 0x80 ? code : 0x3f;
	}
	const length = Math.max(given.length, PASSWORD_MINIMUM);
	const bytes = new Uint8Array(length);
	bytes.set(given.subarray(0, length));
	let count = Math.min(given.length, length);
	if (count < PASSWORD_MINIMUM) {
		bytes[count] = PASSWORD_FILL;
		count += 1;
		for (let at = count; at < PASSWORD_MINIMUM; at += 1) {
			bytes[at] = ((bytes[at % count] ?? 0) + (bytes[at - 1] ?? 0)) & 0xff;
		}
	}
	return bytes;
}

/**
 * `ERIBshfBuffer.DecodeBuffer`: the permutation of one block of two hundred and fifty six bits that the
 * password names, from the place in the password the block starts at. The place the block starts at is
 * advanced by one, which the caller owns.
 */
export function decodeBshfBuffer(
	password: Uint8Array,
	source: Uint8Array,
	passwordOffset: number,
): Uint8Array {
	const output = new Uint8Array(BLOCK_SIZE);
	const mask = new Uint8Array(BLOCK_SIZE);
	const length = password.length;
	const start = passwordOffset >= length ? 0 : passwordOffset;
	let at = start;
	let bit = 0;
	for (let index = 0; index < BIT_COUNT; index += 1) {
		bit = (bit + (password[at] ?? 0)) & 0xff;
		at += 1;
		if (at >= length) at = 0;
		let place = bit >> 3;
		let mark = HIGH_BIT >> (bit & 7);
		while (FULL_BYTE === mask[place]) {
			bit = (bit + BYTE_BITS) & 0xff;
			place = bit >> 3;
		}
		while (0 !== ((mask[place] ?? 0) & mark)) {
			bit += 1;
			mark >>= 1;
			if (0 === mark) {
				bit = (bit + BYTE_BITS) & 0xff;
				place = bit >> 3;
				mark = HIGH_BIT;
			}
		}
		if (place >= BLOCK_SIZE) {
			// Every place is taken exactly once, so the scan always finds a free one inside the block; the
			// reference would walk off the end of its own buffer here.
			throw invalidCipher("The cipher of the engine runs past its block");
		}
		mask[place] = (mask[place] ?? 0) | mark;
		if (0 !== ((source[index >> 3] ?? 0) & (HIGH_BIT >> (index & 7)))) {
			output[place] = (output[place] ?? 0) | mark;
		}
	}
	return output;
}

/**
 * `BSHFDecodeContext`: a stream of the cipher, read thirty two bytes at a time with the password walking one
 * place forward for every block. `decodeBshfCodeBytes` returns how many bytes it wrote, which the reference
 * compares against the length it asked for.
 */
export class BshfDecodeContext {
	private readonly password: Uint8Array;
	private readonly source: Uint8Array;
	private passwordOffset = 0;
	private position = 0;
	private buffer: Uint8Array = new Uint8Array(0);
	/** The place inside the block the reader hands bytes out of; the end of a block means none is held. */
	private bufferAt = BLOCK_SIZE;

	constructor(password: string, source: Uint8Array) {
		this.password = prepareBshfPassword(password);
		this.source = source;
	}

	/** The block the reader stands at, or undefined when fewer than thirty two bytes are left. */
	decodeBshfBlock(): Uint8Array | undefined {
		if (this.position + BLOCK_SIZE > this.source.length) return undefined;
		const block = this.source.subarray(
			this.position,
			this.position + BLOCK_SIZE,
		);
		this.position += BLOCK_SIZE;
		const decoded = decodeBshfBuffer(this.password, block, this.passwordOffset);
		this.passwordOffset += 1;
		return decoded;
	}

	decodeBshfCodeBytes(
		output: Uint8Array,
		offset: number,
		count: number,
	): number {
		let written = 0;
		while (written < count) {
			if (this.bufferAt >= BLOCK_SIZE) {
				const block = this.decodeBshfBlock();
				if (!block) return written;
				this.buffer = block;
				this.bufferAt = 0;
			}
			const take = Math.min(BLOCK_SIZE - this.bufferAt, count - written);
			output.set(
				this.buffer.subarray(this.bufferAt, this.bufferAt + take),
				offset + written,
			);
			this.bufferAt += take;
			written += take;
		}
		return written;
	}
}

/**
 * `NoaOpener.DecodeBSHF`: a whole stream of the cipher, decoded to `length` bytes. The reference turns a
 * stream that runs out early into an end of stream error, and so does this.
 */
export function decodeBshf(
	source: Uint8Array,
	password: string,
	length: number,
): Buffer {
	const context = new BshfDecodeContext(password, source);
	const output = new Uint8Array(length);
	const decoded = context.decodeBshfCodeBytes(output, 0, length);
	if (decoded < length) {
		throw invalidCipher(
			"The places of the stream of the engine stand short of it",
		);
	}
	return Buffer.from(output);
}
