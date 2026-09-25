// Port of the MD5 family of the CMVS engine: GARbro `GameRes.Cryptography.MD5Base` and `GameRes.MD5`
// (source `ArcFormats/MD5.cs`) and the seven keys of `GameRes.Formats.Cmvs.MD5` (source
// `ArcFormats/Cmvs/CmvsMD5.cs`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The round of the reference is the round of the standard: the four functions of the message schedule, the
// sine table, the shift table and the register walk of RFC 1321, over a block of sixteen words read - and
// written, of the state - from the lowest place of a byte up. The engine stands of seven keys over that
// round, each of them of its own **initial state** and of its own **mapping of the four words the round
// leaves behind**: no variant touches the round itself.
//
// The seventh of them, `mirai`, stands of the state of the standard and of nothing else, so it is the
// standard MD5 of the sixteen places of its input, which is what the test holds it to. The engine hands its
// digest over as a single call: the reference reads the four words it is given into the head of a block of
// sixteen words, then a place of 0x80 at the fifth word and another at the fifteenth, and leaves every other
// word of the block at nothing, so the block reads
//
//     w0 w1 w2 w3 80 00 00 00 00 00 00 00 00 00 80 00
//
// of which the place of 0x80 at word five is the terminator of RFC 1321 and the one at word fifteen is the
// first place of the length field, which for sixteen places of input reads 0x80 in the lowest place. The
// reference never writes the count of the places it read anywhere else.

/** The sine table of RFC 1321, read out of the reference. */
const SINE_TABLE: readonly number[] = [
	0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
	0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
	0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
	0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
	0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
	0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
	0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
	0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
	0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
	0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
	0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/** The shifts of the round, of the four rounds of sixteen steps each. */
const SHIFT_TABLE: readonly (readonly number[])[] = [
	[7, 12, 17, 22],
	[5, 9, 14, 20],
	[4, 11, 16, 23],
	[6, 10, 15, 21],
];

/** The words of the round. */
const ROUND_WORDS = 16;
const STEPS = 64;
const BLOCK_WORDS = 16;
/** The place of the terminator of RFC 1321 within the block, and the place of the length field. */
const TERMINATOR_WORD = 4;
const LENGTH_WORD = 14;
const TERMINATOR = 0x80;

/** The seven keys of the engine. */
export type CmvsMd5Variant =
	| "a"
	| "b"
	| "chrono"
	| "memoria"
	| "natsu"
	| "aoi"
	| "mirai";

/** The state of a key and the mapping of the four words of the round. */
interface CmvsMd5Key {
	readonly state: readonly number[];
	readonly result: (state: readonly number[]) => readonly number[];
}

const STATE_A = [0xc74a2b01, 0xe7c8ab8f, 0xd8bedc4e, 0x7302a4c5];
const STATE_B = [0x53fe9b2c, 0xf2c93ea8, 0xee81ba59, 0xa2c8973e];
const STATE_MEMORIA = [0xa79463f9, 0xb6e755c5, 0xc696af21, 0x6983e978];
const STATE_NATSU = [0x63fe9a7c, 0xc2b93e98, 0xef91ba5c, 0x72c9a82e];
const STATE_AOI = [0xc74a2b02, 0xe7c8ab8f, 0x38bebc4e, 0x7531a4c3];

const KEYS: Readonly<Record<CmvsMd5Variant, CmvsMd5Key>> = {
	// `Md5VariantA`: the third word of the round stands first, then the second and the third again.
	a: {
		state: STATE_A,
		result: (s) => [s[3] ?? 0, s[1] ?? 0, s[2] ?? 0, s[0] ?? 0],
	},
	// `Md5Chrono`, of the same state as `Md5VariantA` and of a mapping of its own.
	chrono: {
		state: STATE_A,
		result: (s) => [
			(s[2] ?? 0) ^ 0x45a76c2f,
			((s[1] ?? 0) - 0x5ba17fcb) >>> 0,
			(s[0] ?? 0) ^ 0x79abe8ad,
			((s[3] ?? 0) - 0x1c08561b) >>> 0,
		],
	},
	b: {
		state: STATE_B,
		result: (s) => [
			(s[1] ?? 0) ^ 0x49875325,
			((s[2] ?? 0) + 0x54f46d7d) >>> 0,
			(s[3] ?? 0) ^ 0xad7948b7,
			((s[0] ?? 0) + 0x1d0638ad) >>> 0,
		],
	},
	memoria: {
		state: STATE_MEMORIA,
		result: (s) => [s[1] ?? 0, s[2] ?? 0, s[3] ?? 0, s[0] ?? 0],
	},
	natsu: {
		state: STATE_NATSU,
		result: (s) => [
			((s[1] ?? 0) + 0x45876329) >>> 0,
			(s[2] ?? 0) ^ 0x54f36d6c,
			((s[3] ?? 0) + 0x4387a749) >>> 0,
			(s[0] ?? 0) ^ 0xe3f9a742,
		],
	},
	aoi: {
		state: STATE_AOI,
		result: (s) => [
			(s[2] ?? 0) ^ 0x53a76d2e,
			((s[1] ?? 0) + 0x5bb17fda) >>> 0,
			((s[0] ?? 0) + 0x6853e14d) >>> 0,
			(s[3] ?? 0) ^ 0xf5c6a9a3,
		],
	},
	// `Md5Mirai`: the state of the standard and the four words of the round as they stand.
	mirai: {
		state: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
		result: (s) => [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0],
	},
};

/** `Binary.RotL`: a rotation of a word of thirty two places, of the lowest five places of the count. */
function rotl(word: number, count: number): number {
	const places = count & 31;
	return ((word << places) | (word >>> (32 - places))) >>> 0;
}

/**
 * `MD5Base.Transform`: the round of RFC 1321 over one block of sixteen words, of the four words of the state
 * it is handed and of the four it leaves behind. The words of the block are the words of the stream from the
 * lowest place of a byte up, which is the order the reference reads them in.
 */
export function md5Transform(
	state: readonly number[],
	block: readonly number[],
): number[] {
	let a = state[0] ?? 0;
	let b = state[1] ?? 0;
	let c = state[2] ?? 0;
	let d = state[3] ?? 0;
	for (let step = 0; step < STEPS; step += 1) {
		let f: number;
		let g: number;
		if (step < ROUND_WORDS) {
			f = d ^ (b & (c ^ d));
			g = step;
		} else if (step < 2 * ROUND_WORDS) {
			f = c ^ (d & (b ^ c));
			g = (5 * step + 1) & 0xf;
		} else if (step < 3 * ROUND_WORDS) {
			f = b ^ c ^ d;
			g = (3 * step + 5) & 0xf;
		} else {
			f = c ^ (b | ~d);
			g = (7 * step) & 0xf;
		}
		const shifts = SHIFT_TABLE[step >> 4] ?? SHIFT_TABLE[0] ?? [];
		const keep = d;
		d = c;
		c = b;
		b =
			(b +
				rotl(
					(a + f + (block[g] ?? 0) + (SINE_TABLE[step] ?? 0)) >>> 0,
					shifts[step & 3] ?? 0,
				)) >>>
			0;
		a = keep;
	}
	return [
		((state[0] ?? 0) + a) >>> 0,
		((state[1] ?? 0) + b) >>> 0,
		((state[2] ?? 0) + c) >>> 0,
		((state[3] ?? 0) + d) >>> 0,
	];
}

/** The block the reference builds of the four words it is handed. */
export function cmvsMd5Block(words: readonly number[]): number[] {
	const block = new Array<number>(BLOCK_WORDS).fill(0);
	for (let index = 0; index < 4; index += 1) {
		block[index] = (words[index] ?? 0) >>> 0;
	}
	block[TERMINATOR_WORD] = TERMINATOR;
	block[LENGTH_WORD] = TERMINATOR;
	return block;
}

/**
 * `MD5.Compute`: the four words the key turns the four words it is handed into. The reference keeps its
 * state in the instance it computes with and adds the round's words onto it, so a second call on the same
 * instance stands of the words the first left behind; the engine of the reference computes once per archive,
 * so this port hands a new set of words over every call.
 */
export function cmvsMd5(
	variant: CmvsMd5Variant,
	words: readonly number[],
): number[] {
	const key = KEYS[variant];
	const state = md5Transform(key.state, cmvsMd5Block(words));
	const mapped = key.result(state);
	return [
		(mapped[0] ?? 0) >>> 0,
		(mapped[1] ?? 0) >>> 0,
		(mapped[2] ?? 0) >>> 0,
		(mapped[3] ?? 0) >>> 0,
	];
}

/** The sine table of the round, of the keys the walk of this module stands of. */
export const CMVS_MD5_SINE_TABLE = SINE_TABLE;
