// Port of the three ciphers of the Primel engine: `GameRes.Formats.Primel.PrimelEncyptionBase`,
// `Primel1Encyption`, `Primel2Encyption` and `Primel3Encyption` (source
// `ArcFormats/Primel/Encryption.cs`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The engine keeps three ciphers, and the flags of an archive entry name the one its places stand of. All
// three stand of one block of sixteen places, of four words read from the lowest place of a byte up, and of a
// key schedule that runs the four words of the key through a table of the places of a byte of its own - the
// table of `MutateKey` - over a key of the engine and a count of its own:
//
//   * `Primel1Encyption` folds the key over `DefaultKey[i & 7]` and walks a block of four words, of a place
//     of the key behind the other four times over;
//   * `Primel2Encyption` folds the key over `DefaultKey[(i + 3) & 7]`, counts the places of every word of
//     the key and stands of eight turns of the block, of a word of the key per turn;
//   * `Primel3Encyption` folds the key over `DefaultKey[(i - 3) & 7]` over eight words, of a place of the
//     key that every turn of the schedule takes, and walks a block eight times over, backwards, of a table
//     of the places of a byte per place of the key.
//
// The chaining that follows every block feeds back **its input**, as the chaining of `RC6` does: where the
// input is a clear text the chaining is not CFB, and the two directions of the ciphers are not each other's
// inverse, which the test of the ciphers holds. The reference has no inverse of any of the three - an engine
// reads an archive with them - so there is no anchor outside the reference for the walks themselves: the test
// holds the tables, of the word of the tables as they stand and of the place of every row of them, and the
// walks against a second transcription of the same source, worked out outside this package.

import {
	PRIMEL_BYTE_MAP,
	PRIMEL_CODE_TABLE,
	PRIMEL_DEFAULT_KEY,
	PRIMEL_OFFSETS,
} from "./primel-cipher-tables.js";

/** The places of a block, of a word of thirty two places. */
export const PRIMEL_BLOCK_SIZE = 16;
const BLOCK_WORDS = 4;
const WORD_PLACES = 4;
const KEY_PLACES = 16;
/** The count of the schedule of every cipher, and the words it folds over. */
const SCHEME_ONE_STEPS = 16;
const SCHEME_TWO_STEPS = 16;
const SCHEME_THREE_STEPS = 0x20;
/** The words of the key of the two older ciphers, and of the newer one. */
const SHORT_KEY_WORDS = 4;
const LONG_KEY_WORDS = 8;
/** The ciphers the flags of an entry name. */
export type PrimelCipherScheme = 1 | 2 | 3;

/** `Binary.RotL`. */
function rotateLeft(word: number, count: number): number {
	const places = count & 31;
	return ((word << places) | (word >>> (32 - places))) >>> 0;
}

/** `Binary.RotR`. */
function rotateRight(word: number, count: number): number {
	const places = count & 31;
	return ((word >>> places) | (word << (32 - places))) >>> 0;
}

/** The places of a word of the stream, from the lowest place of a byte up. */
function readWord(data: Buffer, at: number): number {
	return (
		((data[at] ?? 0) |
			((data[at + 1] ?? 0) << 8) |
			((data[at + 2] ?? 0) << 16) |
			((data[at + 3] ?? 0) << 24)) >>>
		0
	);
}

function writeWord(data: Buffer, at: number, word: number): void {
	data[at] = word & 0xff;
	data[at + 1] = (word >>> 8) & 0xff;
	data[at + 2] = (word >>> 16) & 0xff;
	data[at + 3] = (word >>> 24) & 0xff;
}

/** `PrimelEncyptionBase.MutateKey`: every place of a word stands of its own table of the places of a byte. */
export function primelMutateKey(word: number): number {
	return (
		((PRIMEL_CODE_TABLE[0]?.[word & 0xff] ?? 0) |
			((PRIMEL_CODE_TABLE[1]?.[(word >>> 8) & 0xff] ?? 0) << 8) |
			((PRIMEL_CODE_TABLE[2]?.[(word >>> 16) & 0xff] ?? 0) << 16) |
			((PRIMEL_CODE_TABLE[3]?.[word >>> 24] ?? 0) << 24)) >>>
		0
	);
}

/**
 * The fold the two newer ciphers stand of, of the count of the places of a word.
 *
 * The reference adds the two halves of the word at the end of the fold **without clearing the higher one
 * first**, so the value it hands over is the count of the places of the word in its low places alone, over
 * the halves of the count in the places over them. Every use of the value in the reference masks the low four
 * or five places of it, where it stands of the count of the places exactly, and the test of the ciphers holds
 * it to a count worked out on its own there.
 */
export function primelFoldedPlaces(word: number): number {
	let places = word >>> 0;
	places = ((places & 0x55555555) + ((places >>> 1) & 0x55555555)) >>> 0;
	places = ((places & 0x33333333) + ((places >>> 2) & 0x33333333)) >>> 0;
	places = ((places & 0x0f0f0f0f) + ((places >>> 4) & 0x0f0f0f0f)) >>> 0;
	places = ((places & 0x00ff00ff) + ((places >>> 8) & 0x00ff00ff)) >>> 0;
	// The reference takes the sum of the two halves as a word of thirty two places. The count of the places
	// of a word is at most thirty two, so the sum never stands over the word and the cast of the reference
	// has nothing to do.
	return (places + (places >>> 16)) | 0;
}

/**
 * One of the three ciphers of the engine, of its key schedule, of its walk and of the chaining the reference
 * wraps them in.
 */
export class PrimelCipher {
	readonly #scheme: PrimelCipherScheme;
	readonly #keys: Uint32Array;
	readonly #shifts = new Int32Array(8);
	readonly #offsets = new Int32Array(4);
	readonly #chaining = Buffer.alloc(PRIMEL_BLOCK_SIZE, 0x00);

	constructor(
		scheme: PrimelCipherScheme,
		key: Buffer | Uint8Array,
		iv: Buffer | Uint8Array | null,
	) {
		this.#scheme = scheme;
		this.#keys = new Uint32Array(
			scheme === 3 ? LONG_KEY_WORDS : SHORT_KEY_WORDS,
		);
		for (let at = 0; at < KEY_PLACES; at += 1) {
			const place = at >> 2;
			this.#keys[place] =
				((this.#keys[place] ?? 0) | ((key[at] ?? 0) << ((at & 3) * 8))) >>> 0;
		}
		if (iv) Buffer.from(iv.subarray(0, PRIMEL_BLOCK_SIZE)).copy(this.#chaining);
		switch (scheme) {
			case 1:
				this.#schedule(SCHEME_ONE_STEPS, (at) => at & 7);
				break;
			case 2: {
				this.#schedule(SCHEME_TWO_STEPS, (at) => (at + 3) & 7);
				for (let at = 0; at < BLOCK_WORDS; at += 1) {
					const places = primelFoldedPlaces(this.#keys[at] ?? 0);
					this.#shifts[at + BLOCK_WORDS] =
						(places ^ ((places + at) >> 1)) & 0xf;
					this.#shifts[at] = (places + at) & 0x1f;
				}
				break;
			}
			case 3: {
				this.#schedule(SCHEME_THREE_STEPS, (at) => (at - 3) & 7, true);
				for (let at = 0; at < this.#keys.length; at += 1) {
					const places = primelFoldedPlaces(this.#keys[at] ?? 0);
					this.#shifts[at] = (places + at) & 0x1f;
				}
				break;
			}
			default:
				break;
		}
	}

	/** The schedule of a cipher: the key folded over the key of the engine, of a table of its own. */
	#schedule(
		steps: number,
		keyPlace: (at: number) => number,
		offsets = false,
	): void {
		const words = this.#keys.length;
		let place = 0;
		for (let at = 0; at < steps; at += 1) {
			place =
				((this.#keys[at % words] ?? 0) ^
					((place + (PRIMEL_DEFAULT_KEY[keyPlace(at)] ?? 0)) >>> 0)) >>>
				0;
			this.#keys[at % words] = primelMutateKey(place);
			if (offsets) this.#offsets[at & 3] = (place >>> 7) & 0xf;
		}
	}

	/** `TransformBlock`: the whole blocks of the input turned out, of the chaining of the reference. */
	transformBlock(data: Buffer): Buffer {
		const whole =
			Math.floor(data.length / PRIMEL_BLOCK_SIZE) * PRIMEL_BLOCK_SIZE;
		const out = Buffer.alloc(whole);
		for (let at = 0; at < whole; at += PRIMEL_BLOCK_SIZE) {
			this.#block(data, out, at);
			for (let place = 0; place < PRIMEL_BLOCK_SIZE; place += 1) {
				out[at + place] = (out[at + place] ?? 0) ^ (this.#chaining[place] ?? 0);
			}
			data.copy(this.#chaining, 0, at, at + PRIMEL_BLOCK_SIZE);
		}
		return out;
	}

	/** `TransformFinalBlock`: the whole blocks of the input and the tail behind them as they stand. */
	transformFinalBlock(data: Buffer): Buffer {
		if (data.length < PRIMEL_BLOCK_SIZE) return Buffer.from(data);
		const out = this.transformBlock(data);
		return Buffer.concat([out, data.subarray(out.length)]);
	}

	/** The walk of the cipher over one block, of the places of the block behind them. */
	#block(input: Buffer, output: Buffer, at: number): void {
		switch (this.#scheme) {
			case 1:
				this.#walkOne(input, output, at);
				break;
			case 2:
				this.#walkTwo(input, output, at);
				break;
			case 3: {
				input.copy(output, at, at, at + PRIMEL_BLOCK_SIZE);
				for (let turn = 7; turn >= 0; turn -= 1)
					this.#walkThree(output, at, turn);
				break;
			}
			default:
				break;
		}
	}

	/** `Primel1Encyption.Transform`: a place of the key behind the other four times over. */
	#walkOne(input: Buffer, output: Buffer, at: number): void {
		for (let word = 0; word < BLOCK_WORDS; word += 1) {
			let value = readWord(input, at + word * WORD_PLACES);
			value = (value ^ (this.#keys[(word - 1) & 3] ?? 0)) >>> 0;
			value = (value - (this.#keys[(word - 2) & 3] ?? 0)) >>> 0;
			value = (value ^ (this.#keys[(word - 3) & 3] ?? 0)) >>> 0;
			value = (value - (this.#keys[(word - 4) & 3] ?? 0)) >>> 0;
			writeWord(output, at + word * WORD_PLACES, value);
		}
	}

	/** `Primel2Encyption.Transform`: a turn of the block and of the places of the key behind it. */
	#walkTwo(input: Buffer, output: Buffer, at: number): void {
		for (let word = 0; word < BLOCK_WORDS; word += 1) {
			const first = (word - 1) & 3;
			const second = (word - 2) & 3;
			const third = (word - 3) & 3;
			const fourth = (word - 4) & 3;
			let value = readWord(input, at + word * WORD_PLACES);
			value =
				(rotateRight(value, this.#shifts[first] ?? 0) +
					(this.#keys[first] ?? 0)) >>>
				0;
			value = rotateRight(
				(value ^ (this.#keys[second] ?? 0)) >>> 0,
				this.#shifts[second] ?? 0,
			);
			value =
				(rotateRight(value, this.#shifts[third] ?? 0) -
					(this.#keys[third] ?? 0)) >>>
				0;
			value = rotateRight(
				(value ^ (this.#keys[fourth] ?? 0)) >>> 0,
				this.#shifts[fourth] ?? 0,
			);
			writeWord(output, at + word * WORD_PLACES, value);
		}
	}

	/** `Primel3Encyption.Transform`: a turn of the block backwards, of a table of the places of a byte. */
	#walkThree(data: Buffer, at: number, turn: number): void {
		const place = turn & 3;
		for (let word = BLOCK_WORDS - 2; word >= 0; word -= 1) {
			const from = at + word * WORD_PLACES + 2;
			const value = rotateLeft(
				(readWord(data, from) + (this.#keys[place + BLOCK_WORDS] ?? 0)) >>> 0,
				this.#shifts[place + BLOCK_WORDS] ?? 0,
			);
			writeWord(data, from, (value ^ (this.#keys[place] ?? 0)) >>> 0);
		}
		const map = 8 * (this.#offsets[place] ?? 0) + BLOCK_WORDS;
		for (let word = BLOCK_WORDS - 1; word >= 0; word -= 1) {
			const from = at + word * WORD_PLACES;
			const value = rotateRight(
				((this.#keys[place + BLOCK_WORDS] ?? 0) ^ readWord(data, from)) >>> 0,
				this.#shifts[place] ?? 0,
			);
			let out = 0;
			for (let byte = 0; byte < WORD_PLACES; byte += 1) {
				const row = PRIMEL_BYTE_MAP[PRIMEL_OFFSETS[map + byte] ?? 0];
				out |= (row?.[(value >>> (byte * 8)) & 0xff] ?? 0) << (byte * 8);
			}
			out = (out - (this.#keys[place] ?? 0)) >>> 0;
			writeWord(data, from, out);
		}
	}
}
