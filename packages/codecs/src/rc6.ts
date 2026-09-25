// Port of GARbro `GameRes.Cryptography.RC6` (source `ArcFormats/Primel/RC6.cs`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference is the RC6 block cipher of the AES submission, RC6-32/20/32: a word of thirty two places,
// twenty rounds and a key of any length, of the constants P and Q and of the mixing loop of the submission.
// Its key and its blocks stand of words of four places read from the lowest place of a byte up, which is the
// order of the published vectors of the cipher and the order of the reference's own `LittleEndian` helpers.
//
// The reference also wraps that cipher in a chaining of its own, and the comment over its `TransformBlock`
// calls it CFB while the code feeds back **its input**: read a block of the stream, take the cipher over
// the chaining place, XOR the block into it, and stand of the block as the chaining place of the block
// behind. Where the input is the cipher text - the direction the engine reads an archive in - that is CFB
// exactly, of a chaining place of sixteen places. Where the input is the clear text it is not, and the
// derivation of that direction does not stand of the cipher of this port: the two directions are therefore
// not each other's inverse, which the test of the cipher holds.
//
// The block cipher is checked against the published vectors of the cipher (the NESSIE set, read through
// `draft-krovetz-rc6-rc5-vectors`), so a slip in the key schedule, in the rounds or in the order of the
// words stands out; the chaining is checked against the definition of CFB worked out over that cipher.

/** The places of a block of the cipher, of a word of thirty two places. */
export const RC6_BLOCK_SIZE = 16;
/** The rounds of the cipher the reference stands of. */
export const RC6_ROUNDS = 20;
/** The constants the key schedule stands of, of the fractional parts of e and of the golden ratio. */
const P_WORD = 0xb7e15163;
const Q_WORD = 0x9e3779b9;
const WORD_PLACES = 4;
const ROUND_SHIFT = 5;

/** `Binary.RotL`: a rotation of a word of thirty two places, of the lowest five places of the count. */
function rotl(word: number, count: number): number {
	const places = count & 31;
	return ((word << places) | (word >>> (32 - places))) >>> 0;
}

/** `Binary.RotR`: the same, to the other side. */
function rotr(word: number, count: number): number {
	const places = count & 31;
	return ((word >>> places) | (word << (32 - places))) >>> 0;
}

/** The rounds of a key schedule, beside the words of it. */
export interface Rc6Schedule {
	readonly rounds: number;
	readonly words: Uint32Array;
}

/**
 * `RC6.RC6`: the key schedule of the cipher. The key stands of words of four places from the lowest place of
 * a byte up, of a whole word of nothing where the key does not fill one, and of one such word where the key
 * is empty, which the reference allows.
 */
export function rc6KeySchedule(
	key: Buffer | Uint8Array,
	rounds = RC6_ROUNDS,
): Rc6Schedule {
	const keyLength = Math.max(Math.floor((key.length + 3) / 4), 1);
	const schedule = new Uint32Array(keyLength);
	for (let at = 0; at < key.length; at += 1) {
		const word = at >> 2;
		schedule[word] =
			((schedule[word] ?? 0) | ((key[at] ?? 0) << ((at & 3) * 8))) >>> 0;
	}
	const words = new Uint32Array(2 * (rounds + 2));
	words[0] = P_WORD;
	for (let at = 1; at < words.length; at += 1) {
		words[at] = ((words[at - 1] ?? 0) + Q_WORD) >>> 0;
	}
	let a = 0;
	let b = 0;
	const mixings = 3 * Math.max(words.length, keyLength);
	for (let at = 0; at < mixings; at += 1) {
		const word = at % words.length;
		a = rotl(((words[word] ?? 0) + a + b) >>> 0, 3);
		words[word] = a;
		const place = at % keyLength;
		b = rotl(((schedule[place] ?? 0) + a + b) >>> 0, (a + b) & 31);
		schedule[place] = b;
	}
	return { rounds, words };
}

/**
 * `RC6.Encrypt`: the cipher over one block of sixteen places, of four words read from the lowest place of a
 * byte up and of four such words turned out.
 */
export function rc6EncryptBlock(
	schedule: Rc6Schedule,
	block: Buffer | Uint8Array,
): Buffer {
	if (block.length < RC6_BLOCK_SIZE) {
		throw new RangeError("An RC6 block stands of sixteen places");
	}
	const words = schedule.words;
	let a = readWord(block, 0);
	let b = (readWord(block, 1) + (words[0] ?? 0)) >>> 0;
	let c = readWord(block, 2);
	let d = (readWord(block, 3) + (words[1] ?? 0)) >>> 0;
	let at = 2;
	for (let round = 0; round < schedule.rounds; round += 1) {
		const t = rotl(Math.imul(b, 2 * b + 1) >>> 0, ROUND_SHIFT);
		const u = rotl(Math.imul(d, 2 * d + 1) >>> 0, ROUND_SHIFT);
		a = (rotl(a ^ t, u) + (words[at] ?? 0)) >>> 0;
		at += 1;
		c = (rotl(c ^ u, t) + (words[at] ?? 0)) >>> 0;
		at += 1;
		const swap = a;
		a = b;
		b = c;
		c = d;
		d = swap;
	}
	a = (a + (words[at] ?? 0)) >>> 0;
	c = (c + (words[at + 1] ?? 0)) >>> 0;
	return packWords([a, b, c, d]);
}

/**
 * `RC6.Decrypt`: the cipher backwards. The reference carries this walk and its own engine never calls it, so
 * the test of the cipher holds it to the vectors of the published set alone.
 */
export function rc6DecryptBlock(
	schedule: Rc6Schedule,
	block: Buffer | Uint8Array,
): Buffer {
	if (block.length < RC6_BLOCK_SIZE) {
		throw new RangeError("An RC6 block stands of sixteen places");
	}
	const words = schedule.words;
	let a = readWord(block, 0);
	let b = readWord(block, 1);
	let c = readWord(block, 2);
	let d = readWord(block, 3);
	let at = words.length - 2;
	c = (c - (words[at + 1] ?? 0)) >>> 0;
	a = (a - (words[at] ?? 0)) >>> 0;
	for (let round = 0; round < schedule.rounds; round += 1) {
		at -= 2;
		const swap = a;
		a = d;
		d = c;
		c = b;
		b = swap;
		const u = rotl(Math.imul(d, 2 * d + 1) >>> 0, ROUND_SHIFT);
		const t = rotl(Math.imul(b, 2 * b + 1) >>> 0, ROUND_SHIFT);
		c = (rotr((c - (words[at + 1] ?? 0)) >>> 0, t) ^ u) >>> 0;
		a = (rotr((a - (words[at] ?? 0)) >>> 0, u) ^ t) >>> 0;
	}
	d = (d - (words[1] ?? 0)) >>> 0;
	b = (b - (words[0] ?? 0)) >>> 0;
	return packWords([a, b, c, d]);
}

function readWord(block: Buffer | Uint8Array, index: number): number {
	const at = index * WORD_PLACES;
	return (
		((block[at] ?? 0) |
			((block[at + 1] ?? 0) << 8) |
			((block[at + 2] ?? 0) << 16) |
			((block[at + 3] ?? 0) << 24)) >>>
		0
	);
}

function packWords(words: readonly number[]): Buffer {
	const out = Buffer.alloc(RC6_BLOCK_SIZE);
	for (let index = 0; index < words.length; index += 1) {
		out.writeUInt32LE((words[index] ?? 0) >>> 0, index * WORD_PLACES);
	}
	return out;
}

/**
 * `RC6.TransformBlock` and `RC6.TransformFinalBlock`: the chaining the reference wraps the cipher in, of a
 * chaining place of sixteen places. Every whole block of the input stands of the cipher over the chaining
 * place, of the input block XORed into it and of that input block as the chaining place behind it; a tail
 * shorter than a block stands of the places it came of.
 */
export class Rc6 {
	readonly #schedule: Rc6Schedule;
	readonly #chaining = Buffer.alloc(RC6_BLOCK_SIZE, 0x00);

	constructor(key: Buffer | Uint8Array, iv?: Buffer | Uint8Array | null) {
		this.#schedule = rc6KeySchedule(key);
		if (iv) {
			Buffer.from(iv.subarray(0, RC6_BLOCK_SIZE)).copy(this.#chaining);
		}
	}

	/**
	 * `RC6.TransformBlock`: the whole blocks of the input turned out, of the places of the one behind the
	 * other. A tail shorter than a block stands behind them, of the places it came of.
	 */
	transformBlock(data: Buffer): Buffer {
		const whole = Math.floor(data.length / RC6_BLOCK_SIZE) * RC6_BLOCK_SIZE;
		const out = Buffer.alloc(whole);
		this.#blocks(data, out, 0);
		return out;
	}

	/**
	 * `RC6.TransformFinalBlock`: the whole blocks of the input and the tail behind them as they stand, of a
	 * count shorter than a block left where it is.
	 */
	transformFinalBlock(data: Buffer): Buffer {
		if (data.length < RC6_BLOCK_SIZE) return Buffer.from(data);
		const out = Buffer.alloc(data.length);
		const whole = this.#blocks(data, out, 0);
		data.copy(out, whole, whole);
		return out;
	}

	/** The places of the whole blocks of the input, of the count of them turned out. */
	#blocks(data: Buffer, out: Buffer, from: number): number {
		let at = from;
		while (at + RC6_BLOCK_SIZE <= data.length) {
			const stream = rc6EncryptBlock(this.#schedule, this.#chaining);
			for (let place = 0; place < RC6_BLOCK_SIZE; place += 1) {
				const byte = data[at + place] ?? 0;
				out[at + place] = ((stream[place] ?? 0) ^ byte) & 0xff;
				this.#chaining[place] = byte;
			}
			at += RC6_BLOCK_SIZE;
		}
		return at - from;
	}
}
