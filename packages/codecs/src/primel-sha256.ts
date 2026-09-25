// Port of GARbro "ArcFormats/Primel/SHA256.cs" (class `SHA256`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// **This is not the hash of the standard.** The two rotations of the round of the reference are the ones
// the standard names as well, but the round writes the first two of them as `RotL` where the standard
// stands of `RotR`: with the reference's own words the hash of nothing walks to f5c868940c5e3398..., and
// with the words of the standard it walks to e3b0c44298fc1c14..., which is the hash of the standard. The
// keys of the engine this copy stands in are built of its own words, so this port follows them rather than
// the standard, and the name says where they come from.
//
// The walk of the places of the hash is the one of the standard: a block of sixty four places, the word of
// every place read from the highest of a byte down, a place of 0x80 behind the message, the words of it
// behind that one and the count of the places of the message in bits behind them. The two words of the walk
// stand of the places of the word and of the places five, eleven and twenty five of the walk behind them,
// and every step stands of the words of the round.
//
// The reference carries the hash of a **single block**: its own copy refuses a message of more than fifty
// five places, which is what the keys of the engine it stands in need. This port walks the blocks of a
// message of any count, which is the same walk over one block and the standard one over the rest.

const BLOCK_SIZE = 64;
const WORD_SIZE = 4;
const WORDS = 16;
const ROUNDS = 64;
const MESSAGE_LIMIT = 55;
const PAD_PLACE = 0x80;

/** The words of the round of the standard walk. */
const ROUND_WORDS: readonly number[] = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The words the hash starts of. */
const START_WORDS: readonly number[] = [
	0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
	0x1f83d9ab, 0x5be0cd19,
];

/** `Binary.RotL`: the places of a word turned up, of a count of them that stands below thirty two. */
function rotateLeft(value: number, count: number): number {
	const at = count & 31;
	if (0 === at) return value >>> 0;
	return ((value << at) | (value >>> (32 - at))) >>> 0;
}

/** `Binary.RotR`: the places of a word turned down, of a count of them that stands below thirty two. */
function rotateRight(value: number, count: number): number {
	const at = count & 31;
	if (0 === at) return value >>> 0;
	return ((value >>> at) | (value << (32 - at))) >>> 0;
}

/** `SHA256.TransformBlock`: one block of the walk, of the places of it that stand in the ring of sixteen. */
function transformBlock(state: Uint32Array, data: Uint32Array): void {
	let a = state[0] ?? 0;
	let b = state[1] ?? 0;
	let c = state[2] ?? 0;
	let d = state[3] ?? 0;
	let e = state[4] ?? 0;
	let f = state[5] ?? 0;
	let g = state[6] ?? 0;
	let h = state[7] ?? 0;
	for (let round = 0; round < ROUNDS; round += WORDS) {
		for (let i = 0; i < WORDS; i += 1) {
			if (round > 0) {
				const x = data[(i - 15) & 15] ?? 0;
				const y = data[(i - 2) & 15] ?? 0;
				const first = (rotateLeft(x, 7) ^ rotateLeft(x, 18) ^ (x >>> 3)) >>> 0;
				const second =
					(rotateLeft(y, 17) ^ rotateLeft(y, 19) ^ (y >>> 10)) >>> 0;
				data[i] =
					((data[i] ?? 0) + first + second + (data[(i - 7) & 15] ?? 0)) >>> 0;
			}
			const word = data[i] ?? 0;
			const s0 =
				(rotateLeft(a, 2) ^ rotateLeft(a, 13) ^ rotateRight(a, 10)) >>> 0;
			const majority = ((a & b) ^ (b & c) ^ (c & a)) >>> 0;
			const t0 = (s0 + majority) >>> 0;
			const s1 =
				(rotateLeft(e, 6) ^ rotateLeft(e, 11) ^ rotateRight(e, 7)) >>> 0;
			const choose = ((e & f) ^ (~e & g)) >>> 0;
			const t1 = (h + s1 + choose + (ROUND_WORDS[i + round] ?? 0) + word) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t0 + t1) >>> 0;
		}
	}
	state[0] = ((state[0] ?? 0) + a) >>> 0;
	state[1] = ((state[1] ?? 0) + b) >>> 0;
	state[2] = ((state[2] ?? 0) + c) >>> 0;
	state[3] = ((state[3] ?? 0) + d) >>> 0;
	state[4] = ((state[4] ?? 0) + e) >>> 0;
	state[5] = ((state[5] ?? 0) + f) >>> 0;
	state[6] = ((state[6] ?? 0) + g) >>> 0;
	state[7] = ((state[7] ?? 0) + h) >>> 0;
}

/** `SHA256.CopyBigEndian`: the places of a block, of the word of every four of them. */
function readWords(data: Buffer, at: number, out: Uint32Array): void {
	for (let i = 0; i < WORDS; i += 1) {
		out[i] = data.readUInt32BE(at + i * WORD_SIZE);
	}
}

/**
 * `SHA256.ComputeHash`: the hash of the places of a message, of thirty two places. The reference walks one
 * block of sixty four places and refuses a message of more than fifty five of them; this port walks every
 * block of a longer message, of the same walk over the first one.
 */
export function primelSha256(message: Uint8Array): Buffer {
	const data = Buffer.from(
		message.buffer,
		message.byteOffset,
		message.byteLength,
	);
	const length = data.length;
	const blocks = Math.floor((length + 1 + 8 + BLOCK_SIZE - 1) / BLOCK_SIZE);
	const padded = Buffer.alloc(blocks * BLOCK_SIZE, 0x00);
	data.copy(padded, 0);
	padded[length] = PAD_PLACE;
	const bits = BigInt(length) * 8n;
	padded.writeBigUInt64BE(bits, blocks * BLOCK_SIZE - 8);
	const state = Uint32Array.from(START_WORDS);
	const words = new Uint32Array(WORDS);
	for (let block = 0; block < blocks; block += 1) {
		readWords(padded, block * BLOCK_SIZE, words);
		transformBlock(state, words);
	}
	const hash = Buffer.alloc(32, 0x00);
	for (let i = 0; i < state.length; i += 1) {
		hash.writeUInt32BE(state[i] ?? 0, i * WORD_SIZE);
	}
	return hash;
}

/** The count of the places of a message the reference's own single block copy of the hash takes. */
export const PRIMEL_SHA256_MESSAGE_LIMIT = MESSAGE_LIMIT;
