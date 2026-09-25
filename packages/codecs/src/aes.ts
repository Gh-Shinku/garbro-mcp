// AES-128 and the byte wise CFB walk the Primel engine keeps its archives in.
//
// The reference has no AES of its own: `ArcPCF.cs` hands the key and the place of the chaining to the
// platform's `Rijndael` (`Aes`), in `CipherMode.CFB` of the default feedback size of eight places and of
// `PaddingMode.Zeros`. The cipher, the tables of it and the walk below are therefore worked out from the
// standard rather than read off the reference: the block stands of the schedule and of the round of
// FIPS-197, and the walk of the byte wise CFB of SP 800-38A, of the segment of one byte the feedback size of
// the reference names. The test holds the block to the vector of the appendix of FIPS-197 and the walk to
// the four blocks of the byte wise CFB example of SP 800-38A.
//
// Two places of the reference are left behind, and both of them are places of its own platform rather than
// of the engine: its walk reads four blocks at a time where the standard reads one, which stands of the same
// places here, and its `PaddingMode.Zeros` would drop the zero places of the tail of a stream where the
// platform reads the last block of it, which this port leaves where they stand.

/** The places of the block of the cipher, and of the key of the cipher. */
export const AES_BLOCK_SIZE = 16;
export const AES_KEY_SIZE = 16;
const STATE_PLACES = 16;
const STATE_SIDE = 4;
const ROUNDS = 10;
const ROUND_KEYS = ROUNDS + 1;

/**
 * The table of the places of a byte of the cipher, of the inverse of the byte in the field of two to the
 * eighth and of the turn of bits behind it, which is what the standard names the S-box. Making the table
 * from the field keeps a mistyped place out of the module.
 */
const S_BOX: readonly number[] = buildSBox();
/** The table of the inverse of the S-box, for the walks backwards. */
const INV_S_BOX: readonly number[] = buildInverse(S_BOX);

function buildSBox(): number[] {
	const box = new Array<number>(256).fill(0);
	for (let value = 0; value < 256; value += 1) {
		const inverse = value === 0 ? 0 : inverseInField(value);
		box[value] = affine(inverse) & 0xff;
	}
	return box;
}

function buildInverse(box: readonly number[]): number[] {
	const inverse = new Array<number>(256).fill(0);
	for (let value = 0; value < 256; value += 1) inverse[box[value] ?? 0] = value;
	return inverse;
}

/** The product of two places of the field of two to the eighth, of the polynomial of the standard. */
function multiply(left: number, right: number): number {
	let product = 0;
	let a = left & 0xff;
	let b = right & 0xff;
	for (let place = 0; place < 8; place += 1) {
		if (0 !== (b & 1)) product ^= a;
		const high = 0 !== (a & 0x80);
		a = (a << 1) & 0xff;
		if (high) a ^= 0x1b;
		b >>= 1;
	}
	return product & 0xff;
}

/**
 * The inverse of a place of the field: the product of the place with itself two hundred and fifty three
 * times, which is what a place of the field of two hundred and fifty five places stands of.
 */
function inverseInField(value: number): number {
	if (value === 0) return 0;
	let inverse = 1;
	for (let at = 0; at < 254; at += 1) inverse = multiply(inverse, value);
	return inverse;
}

/** The turn of bits of the standard, of the inverse of a place. */
function affine(value: number): number {
	let out = value;
	for (let shift = 1; shift <= 4; shift += 1) {
		out ^= rotateByte(value, shift);
	}
	return out ^ 0x63;
}

function rotateByte(value: number, places: number): number {
	return ((value << places) | (value >>> (8 - places))) & 0xff;
}

/** `KeyExpansion`: the eleven round keys of the schedule of the standard. */
export function aes128KeySchedule(key: Buffer | Uint8Array): Uint8Array[] {
	if (key.length < AES_KEY_SIZE) {
		throw new RangeError("An AES key of this module stands of sixteen places");
	}
	const words = new Uint8Array(4 * ROUND_KEYS * 4);
	for (let at = 0; at < 4 * 4; at += 1) words[at] = key[at] ?? 0;
	let rounds = 1;
	for (let at = 16; at < words.length; at += 4) {
		let temp = [
			words[at - 4] ?? 0,
			words[at - 3] ?? 0,
			words[at - 2] ?? 0,
			words[at - 1] ?? 0,
		];
		if (0 === (at / 4) % 4) {
			temp = [
				(S_BOX[temp[1] ?? 0] ?? 0) ^ (roundConstant(rounds) & 0xff),
				S_BOX[temp[2] ?? 0] ?? 0,
				S_BOX[temp[3] ?? 0] ?? 0,
				S_BOX[temp[0] ?? 0] ?? 0,
			];
			rounds += 1;
		}
		for (let place = 0; place < 4; place += 1) {
			words[at + place] = (words[at - 16 + place] ?? 0) ^ (temp[place] ?? 0);
		}
	}
	const schedule: Uint8Array[] = [];
	for (let round = 0; round < ROUND_KEYS; round += 1) {
		schedule.push(words.subarray(round * 16, round * 16 + 16));
	}
	return schedule;
}

/** The constant of a round of the schedule, of the places of the field. */
function roundConstant(round: number): number {
	let constant = 1;
	for (let at = 1; at < round; at += 1) constant = multiply(constant, 2);
	return constant & 0xff;
}

/** `Cipher`: the block of the standard, of the eleven round keys of its schedule. */
export function aes128EncryptBlock(
	schedule: readonly Uint8Array[],
	block: Buffer | Uint8Array,
): Buffer {
	if (block.length < AES_BLOCK_SIZE) {
		throw new RangeError("An AES block stands of sixteen places");
	}
	// The places of the block stand of the state of the standard: a place of a column after the other.
	let state: Uint8Array = new Uint8Array(STATE_PLACES);
	for (let at = 0; at < STATE_PLACES; at += 1) state[at] = block[at] ?? 0;
	state = addRoundKey(state, schedule[0]);
	for (let round = 1; round < ROUNDS; round += 1) {
		state = subBytes(state, S_BOX);
		state = shiftRows(state);
		state = mixColumns(state);
		state = addRoundKey(state, schedule[round]);
	}
	state = subBytes(state, S_BOX);
	state = shiftRows(state);
	state = addRoundKey(state, schedule[ROUNDS]);
	return Buffer.from(state);
}

/** `InvCipher`: the block backwards. */
export function aes128DecryptBlock(
	schedule: readonly Uint8Array[],
	block: Buffer | Uint8Array,
): Buffer {
	let state: Uint8Array = new Uint8Array(STATE_PLACES);
	for (let at = 0; at < STATE_PLACES; at += 1) state[at] = block[at] ?? 0;
	state = addRoundKey(state, schedule[ROUNDS]);
	for (let round = ROUNDS - 1; round >= 1; round -= 1) {
		state = shiftRowsBack(state);
		state = subBytes(state, INV_S_BOX);
		state = addRoundKey(state, schedule[round]);
		state = mixColumnsBack(state);
	}
	state = shiftRowsBack(state);
	state = subBytes(state, INV_S_BOX);
	state = addRoundKey(state, schedule[0]);
	return Buffer.from(state);
}

function addRoundKey(
	state: Uint8Array,
	key: Uint8Array | undefined,
): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let at = 0; at < STATE_PLACES; at += 1) {
		out[at] = (state[at] ?? 0) ^ (key?.[at] ?? 0);
	}
	return out;
}

function subBytes(state: Uint8Array, box: readonly number[]): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let at = 0; at < STATE_PLACES; at += 1) {
		out[at] = box[state[at] ?? 0] ?? 0;
	}
	return out;
}

/** The rows of the state stand one place to the left of the one in front of them, of their count. */
function shiftRows(state: Uint8Array): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let row = 0; row < STATE_SIDE; row += 1) {
		for (let column = 0; column < STATE_SIDE; column += 1) {
			const from = row + STATE_SIDE * ((column + row) % STATE_SIDE);
			out[row + STATE_SIDE * column] = state[from] ?? 0;
		}
	}
	return out;
}

function shiftRowsBack(state: Uint8Array): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let row = 0; row < STATE_SIDE; row += 1) {
		for (let column = 0; column < STATE_SIDE; column += 1) {
			const from =
				row + STATE_SIDE * ((column + STATE_SIDE - row) % STATE_SIDE);
			out[row + STATE_SIDE * column] = state[from] ?? 0;
		}
	}
	return out;
}

function mixColumns(state: Uint8Array): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let column = 0; column < STATE_SIDE; column += 1) {
		const at = column * STATE_SIDE;
		const a0 = state[at] ?? 0;
		const a1 = state[at + 1] ?? 0;
		const a2 = state[at + 2] ?? 0;
		const a3 = state[at + 3] ?? 0;
		out[at] = multiply(a0, 2) ^ multiply(a1, 3) ^ a2 ^ a3;
		out[at + 1] = a0 ^ multiply(a1, 2) ^ multiply(a2, 3) ^ a3;
		out[at + 2] = a0 ^ a1 ^ multiply(a2, 2) ^ multiply(a3, 3);
		out[at + 3] = multiply(a0, 3) ^ a1 ^ a2 ^ multiply(a3, 2);
	}
	return out;
}

function mixColumnsBack(state: Uint8Array): Uint8Array {
	const out = new Uint8Array(STATE_PLACES);
	for (let column = 0; column < STATE_SIDE; column += 1) {
		const at = column * STATE_SIDE;
		const a0 = state[at] ?? 0;
		const a1 = state[at + 1] ?? 0;
		const a2 = state[at + 2] ?? 0;
		const a3 = state[at + 3] ?? 0;
		out[at] =
			multiply(a0, 14) ^ multiply(a1, 11) ^ multiply(a2, 13) ^ multiply(a3, 9);
		out[at + 1] =
			multiply(a0, 9) ^ multiply(a1, 14) ^ multiply(a2, 11) ^ multiply(a3, 13);
		out[at + 2] =
			multiply(a0, 13) ^ multiply(a1, 9) ^ multiply(a2, 14) ^ multiply(a3, 11);
		out[at + 3] =
			multiply(a0, 11) ^ multiply(a1, 13) ^ multiply(a2, 9) ^ multiply(a3, 14);
	}
	return out;
}

/**
 * The byte wise CFB walk of SP 800-38A: the chaining place stands of the block of the cipher over it, and
 * the byte of the walk stands of the byte in front of it XORed into the head of that block; the byte of the
 * walk then stands at the end of the chaining place, which the places in front of it move one place back.
 *
 * The engine of the reference reads its archives of this walk, so the direction the walk stands of is the
 * one that reads a cipher text.
 */
export class AesCfb8 {
	readonly #schedule: Uint8Array[];
	readonly #chaining = Buffer.alloc(AES_BLOCK_SIZE, 0x00);

	constructor(key: Buffer | Uint8Array, iv: Buffer | Uint8Array | null) {
		this.#schedule = aes128KeySchedule(key);
		if (iv) Buffer.from(iv.subarray(0, AES_BLOCK_SIZE)).copy(this.#chaining);
	}

	/** The walk over a run of places, of a cipher text to the clear text it stands of. */
	decrypt(data: Buffer): Buffer {
		return this.#walk(data, false);
	}

	/** The same, of a clear text to the cipher text of it. */
	encrypt(data: Buffer): Buffer {
		return this.#walk(data, true);
	}

	#walk(data: Buffer, encrypting: boolean): Buffer {
		const out = Buffer.alloc(data.length);
		for (let at = 0; at < data.length; at += 1) {
			// The segment of the walk stands of one byte, so the block of the cipher over the chaining place
			// is taken again for every byte of the run, and the chaining place moves one byte along.
			const stream = aes128EncryptBlock(this.#schedule, this.#chaining);
			const place = data[at] ?? 0;
			out[at] = place ^ (stream[0] ?? 0);
			const feedback = encrypting ? (out[at] ?? 0) : place;
			for (let shift = 0; shift < AES_BLOCK_SIZE - 1; shift += 1) {
				this.#chaining[shift] = this.#chaining[shift + 1] ?? 0;
			}
			this.#chaining[AES_BLOCK_SIZE - 1] = feedback;
		}
		return out;
	}
}
