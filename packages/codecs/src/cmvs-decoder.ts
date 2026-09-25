// Port of the dword walk of the CVNS engine: GARbro `GameRes.Formats.Cmvs.Cpz5Decoder` (source
// `ArcFormats/Cmvs/ArcCPZ.cs`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The newer archive of the engine mixes the places of every entry and of its index through a table of the
// places of a byte that stands of the head of the archive, and then through a run of words of four places
// that stands of a secret of the engine, of the digest of the head of the archive and of a seed. The
// reference carries **both directions** of that walk, which is what lets the test below write the streams it
// reads: the table is built by swaps and is therefore a permuting of the places of a byte, the walk over a
// run is its own inverse once the places of the run stand in the other direction, and the places of a tail
// shorter than a word stand of the table alone.

/** The words of the secret of the engine, of which the walk stands of the first sixteen. */
export const CMVS_CPZ5_SECRET: readonly number[] = [
	0xcd90f089, 0xe982b782, 0xa282ab88, 0xcd82718e, 0x52838a83, 0xa882aa82,
	0x7592648e, 0xb582ab82, 0xe182bf82, 0xdc82a282, 0x4281b782, 0xed82f48e,
	0xbf82ea82, 0xa282e182, 0xb782dc82, 0x6081e682, 0xc6824181, 0xa482a282,
	0xe082a982, 0xf48ea482, 0xbf82c182, 0xa282e182, 0xb582dc82, 0xf481bd82,
];

/** The places of the walk, and the places of the secret it stands of. */
const TABLE_PLACES = 0x100;
const SECRET_WORDS = 0x10;
const WORD_PLACES = 4;
const SEED_CLEAR = 0xff;
const TAIL_CLEAR = 0xff;
const SECRET_SHIFT = 1;
const KEY_PLACE_MASK = 3;
const SECRET_PLACE_SHIFT = 6;
const SECRET_PLACE_MASK = 0xf;
const KEY_PLACES = 0x10;

/** The scheme of an archive: the places the walk of its entries and of its index stands of. */
export interface Cpz5Scheme {
	readonly secret: readonly number[];
	readonly decoderFactor: number;
	readonly entryInitKey: number;
	readonly entryTailKey: number;
	readonly entryKeyPos: number;
}

/** `CpzOpener.CreateCpz5Scheme`: the scheme of the layout of the engine of the mark `CPZ5`. */
export const CMVS_CPZ5_SCHEME: Cpz5Scheme = {
	secret: CMVS_CPZ5_SECRET,
	decoderFactor: 0x1a743125,
	entryInitKey: 0x2547a39e,
	entryTailKey: 0xbc,
	entryKeyPos: 9,
};

/** `Binary.RotR`: a rotation of a word of thirty two places, of the lowest five places of the count. */
function rotateRight(word: number, count: number): number {
	const places = count & 31;
	return ((word >>> places) | (word << (32 - places))) >>> 0;
}

/**
 * `Cpz5Decoder.Init`: the table of the places of a byte, of two swaps a turn over two hundred and fifty six
 * turns, of a key that walks a turn of its own for every turn of the table.
 */
export function initCpz5Table(
	scheme: Cpz5Scheme,
	key: number,
	summand: number,
): Uint8Array {
	const table = new Uint8Array(TABLE_PLACES);
	for (let at = 0; at < table.length; at += 1) table[at] = at;
	let walk = key >>> 0;
	for (let at = 0; at < TABLE_PLACES; at += 1) {
		let first = (walk >>> 16) & 0xff;
		let second = walk & 0xff;
		const swap = table[first] ?? 0;
		table[first] = table[second] ?? 0;
		table[second] = swap;
		first = (walk >>> 8) & 0xff;
		second = walk >>> 24;
		const other = table[first] ?? 0;
		table[first] = table[second] ?? 0;
		table[second] = other;
		walk =
			(summand + Math.imul(scheme.decoderFactor, rotateRight(walk, 2))) >>> 0;
	}
	return table;
}

/** The table of the places of the walk, and of the places of the run a place stands of. */
export class Cpz5Decoder {
	readonly #scheme: Cpz5Scheme;
	readonly #table: Uint8Array;
	readonly #inverse = new Uint8Array(TABLE_PLACES);

	constructor(scheme: Cpz5Scheme, key: number, summand: number) {
		this.#scheme = scheme;
		this.#table = initCpz5Table(scheme, key, summand);
		for (let at = 0; at < this.#table.length; at += 1) {
			this.#inverse[this.#table[at] ?? 0] = at;
		}
	}

	/** `Cpz5Decoder.Decode`: the places of a run, of the table and of a place of a key. */
	decode(data: Buffer, at: number, length: number, key: number): void {
		for (let place = 0; place < length; place += 1) {
			const from = at + place;
			data[from] = this.#table[(key ^ (data[from] ?? 0)) & 0xff] ?? 0;
		}
	}

	/**
	 * `Cpz5Decoder.Encode`: the same, the other way. The table of the reference is a permuting of the places
	 * of a byte, so the place of a byte of the run stands of the inverse of that table here rather than of a
	 * walk of the table for every place of the run.
	 */
	encode(data: Buffer, at: number, length: number, key: number): void {
		for (let place = 0; place < length; place += 1) {
			const from = at + place;
			data[from] = (key ^ (this.#inverse[data[from] ?? 0] ?? 0)) & TAIL_CLEAR;
		}
	}

	/** `Cpz5Decoder.DecryptEntry`: the places of an entry, of the digest of the head of the archive. */
	decryptEntry(data: Buffer, digest: readonly number[], seed: number): void {
		const secret = this.#secretKey(digest, seed);
		let key = this.#scheme.entryInitKey >>> 0;
		let place = this.#scheme.entryKeyPos;
		const words = Math.floor(data.length / WORD_PLACES);
		for (let at = 0; at < words; at += 1) {
			const from = at * WORD_PLACES;
			const word = data.readUInt32LE(from);
			const behind =
				secret[(key >>> SECRET_PLACE_SHIFT) & SECRET_PLACE_MASK] ?? 0;
			const turn = (secret[place] ?? 0) >>> SECRET_SHIFT;
			const mixed =
				((digest[key & KEY_PLACE_MASK] ?? 0) ^
					((((word ^ behind ^ turn) >>> 0) - seed) >>> 0)) >>>
				0;
			data.writeUInt32LE(mixed, from);
			place = (place + 1) & SECRET_PLACE_MASK;
			key = (key + seed + mixed) >>> 0;
		}
		for (let at = words * WORD_PLACES; at < data.length; at += 1) {
			data[at] =
				this.#table[((data[at] ?? 0) ^ this.#scheme.entryTailKey) & 0xff] ?? 0;
		}
	}

	/** `Cpz5Decoder.EncryptEntry`: the walk of an entry, of the other direction. */
	encryptEntry(data: Buffer, digest: readonly number[], seed: number): void {
		const secret = this.#secretKey(digest, seed);
		let key = this.#scheme.entryInitKey >>> 0;
		let place = this.#scheme.entryKeyPos;
		const words = Math.floor(data.length / WORD_PLACES);
		for (let at = 0; at < words; at += 1) {
			const from = at * WORD_PLACES;
			const word = data.readUInt32LE(from);
			const behind =
				secret[(key >>> SECRET_PLACE_SHIFT) & SECRET_PLACE_MASK] ?? 0;
			const turn = (secret[place] ?? 0) >>> SECRET_SHIFT;
			const mixed = (((digest[key & KEY_PLACE_MASK] ?? 0) ^ word) + seed) >>> 0;
			const out = ((mixed ^ turn ^ behind) >>> 0) >>> 0;
			data.writeUInt32LE(out, from);
			place = (place + 1) & SECRET_PLACE_MASK;
			key = (key + seed + word) >>> 0;
		}
		for (let at = words * WORD_PLACES; at < data.length; at += 1) {
			data[at] =
				(this.#inverse[data[at] ?? 0] ?? 0) ^ this.#scheme.entryTailKey;
		}
	}

	/** The secret of the walk: the words of the scheme, of the table and of the seed over them. */
	#secretKey(digest: readonly number[], seed: number): Uint32Array {
		const length = Math.min(this.#scheme.secret.length, SECRET_WORDS);
		const bytes = Buffer.alloc(length * WORD_PLACES, 0x00);
		const key = ((digest[1] ?? 0) >>> 2) >>> 0;
		for (let at = 0; at < length * WORD_PLACES; at += 1) {
			const place = this.#scheme.secret[at >> 2] ?? 0;
			bytes[at] =
				(key ^ (this.#table[(place >>> ((at & 3) * 8)) & 0xff] ?? 0)) &
				SEED_CLEAR;
		}
		// The reference stands of sixteen words where the secret of a scheme may be shorter, and turns the
		// seed onto every one of them, so the words past the secret stand of the seed itself.
		const secret = new Uint32Array(KEY_PLACES);
		for (let at = 0; at < length; at += 1) {
			secret[at] = bytes.readUInt32LE(at * WORD_PLACES) >>> 0;
		}
		for (let at = 0; at < secret.length; at += 1) {
			secret[at] = ((secret[at] ?? 0) ^ seed) >>> 0;
		}
		return secret;
	}
}
