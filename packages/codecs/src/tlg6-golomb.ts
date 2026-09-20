// Reference: GARbro "ArcFormats/KiriKiri/ImageTLG.cs", the tables `TVP_Tables` and the walks
// `TVPTLG6DecodeGolombValues` and `TVPTLG6DecodeGolombValuesForFirst` of the places of the picture of the
// walk of the places of the picture of the sixth kind of the places of the picture. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** The places of the picture of the walk of the places of the picture of the sound of the places of the
 * picture of the words of the walk of the picture. */
const GOLOMB_N_COUNT = 4;
const LEADING_ZERO_BITS = 12;
const LEADING_ZERO_SIZE = 1 << LEADING_ZERO_BITS;
const TABLE_ROWS = GOLOMB_N_COUNT * 2 * 128;
/** The places of the picture of the walk of the places of the picture of the sound of the places of the
 * picture of the walk of the places of the picture of the kinds of the walk of the places of the picture of
 * the engine, standing of the places of the picture of the walk of the places of the picture of the
 * reference. */
const GOLOMB_COMPRESSED = [
	[3, 7, 15, 27, 63, 108, 223, 448, 130],
	[3, 5, 13, 24, 51, 95, 192, 384, 257],
	[2, 5, 12, 21, 39, 86, 155, 320, 384],
	[2, 3, 9, 18, 33, 61, 129, 258, 511],
];

/** The places of the picture of the walk of the places of the picture of the place of the picture of the
 * walk of them of the places of the picture of the walk of them stand of the places of the picture of the
 * walk of the places of the picture of the first place of the picture of the walk of the places of the
 * picture of the place of the picture of the walk of them plus one. */
export const TLG6_LEADING_ZERO_TABLE = (() => {
	const table = new Uint8Array(LEADING_ZERO_SIZE);
	for (let i = 0; i < LEADING_ZERO_SIZE; i += 1) {
		let count = 0;
		let bit = 1;
		for (; bit !== LEADING_ZERO_SIZE && (i & bit) === 0; bit <<= 1) count += 1;
		count += 1;
		if (bit === LEADING_ZERO_SIZE) count = 0;
		table[i] = count;
	}
	return table;
})();

/** The places of the picture of the walk of the places of the picture of the picture of the walk of them of
 * every place of the picture of the walk of the places of the picture of the sound, standing of the places
 * of the picture of the walk of the places of the picture of the walk of them of the places of the picture of
 * their own. */
export const TLG6_GOLOMB_BIT_LENGTH_TABLE = (() => {
	const table = new Int8Array(TABLE_ROWS * GOLOMB_N_COUNT);
	for (let n = 0; n < GOLOMB_N_COUNT; n += 1) {
		let at = 0;
		const places = GOLOMB_COMPRESSED[n] ?? [];
		for (let i = 0; i < places.length; i += 1) {
			for (let j = 0; j < (places[i] ?? 0); j += 1) {
				table[at * GOLOMB_N_COUNT + n] = i;
				at += 1;
			}
		}
		if (at !== TABLE_ROWS)
			throw new Error(
				"The places of the picture of the walk of the places of the picture stand of no places of the picture of the walk of them",
			);
	}
	return table;
})();

/**
 * `TVPTLG6DecodeGolombValues`: the places of the picture of the walk of the places of the picture of the
 * sixth kind of the places of the picture stand of the places of the picture of the walk of the places of the
 * picture of the sound of the places of the picture of the words of the walk of the picture: the places of
 * the picture of the walk of the places of the picture stand of the runs of the places of the picture of no
 * places of their own and of the runs of the places of the picture of the sound, the places of the picture of
 * the walk of the places of the picture of the sound standing of the places of the picture of the walk of the
 * places of the picture of the kind of the places of the picture of the walk of them of the places of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture of the
 * places of the picture of the walk of the places of the picture.
 */
export function decodeTlg6GolombValues(
	pixels: Uint32Array,
	/** The places of the picture of the walk of the places of the picture of the place of the picture of the
	 * walk of them that stand of the places of the picture of the walk of the places of the picture of the
	 * sound of the places of the picture of the walk of the places of the picture of the eight places of the
	 * picture of their own. */
	offset: number,
	pixelCount: number,
	bitPool: Uint8Array,
	first: boolean,
): void {
	// The reference stands the places of the picture of the walk of the places of the picture of the words of
	// the walk of the picture of the places of the picture of the walk of them beyond the places of the
	// picture of the walk of the places of the picture of the sound, so a picture of this project stands the
	// places of the picture of the walk of the places of the picture of the last places of the picture of the
	// walk of them of no places of the picture of their own.
	const pool = Buffer.alloc(bitPool.length + 16);
	Buffer.from(bitPool).copy(pool);
	// The reference stands the places of the picture of the walk of the places of the picture of the words of
	// the walk of the picture of the places of the picture of the walk of them of the places of the picture
	// behind them, so a picture of this project stands the places of the picture of the walk of the places of
	// the picture of the places of the picture of the walk of the places of the picture of the walk of them
	// where the places of the picture of the walk of the places of the picture of the sound stand past the
	// places of the picture of the walk of the places of the picture.
	const readPool = (place: number): number => {
		if (place + 4 > pool.length)
			throw new RangeError(
				"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand past the places of the picture of the walk of the places of the picture",
			);
		return pool.readUInt32LE(place);
	};
	const mask = ~(0xff << offset) >>> 0;
	let poolPlace = 0;
	let n = GOLOMB_N_COUNT - 1;
	let sum = 0;
	let bitPlace = 1;
	let zero = (pool[0] ?? 0) % 2 === 0;
	let pixel = 0;
	while (pixel < pixelCount) {
		let count: number;
		{
			let window = readPool(poolPlace) >>> bitPlace;
			let zeros =
				TLG6_LEADING_ZERO_TABLE[window & (LEADING_ZERO_SIZE - 1)] ?? 0;
			let bits = zeros;
			while (zeros === 0) {
				bits += LEADING_ZERO_BITS;
				bitPlace += LEADING_ZERO_BITS;
				poolPlace += bitPlace >> 3;
				bitPlace &= 7;
				window = readPool(poolPlace) >>> bitPlace;
				zeros = TLG6_LEADING_ZERO_TABLE[window & (LEADING_ZERO_SIZE - 1)] ?? 0;
				bits += zeros;
			}
			bitPlace += zeros;
			poolPlace += bitPlace >> 3;
			bitPlace &= 7;
			bits -= 1;
			count = 1 << bits;
			count += (readPool(poolPlace) >>> bitPlace) & (count - 1);
			bitPlace += bits;
			poolPlace += bitPlace >> 3;
			bitPlace &= 7;
		}
		if (zero) {
			for (let i = 0; i < count && pixel < pixelCount; i += 1) {
				if (first) pixels[pixel] = 0;
				else pixels[pixel] = (pixels[pixel] ?? 0) & mask;
				pixel += 1;
			}
			zero = false;
		} else {
			for (let i = 0; i < count && pixel < pixelCount; i += 1) {
				const k = TLG6_GOLOMB_BIT_LENGTH_TABLE[sum * GOLOMB_N_COUNT + n] ?? 0;
				let window = readPool(poolPlace) >>> bitPlace;
				let bits: number;
				let zeros: number;
				if (window !== 0) {
					zeros =
						TLG6_LEADING_ZERO_TABLE[window & (LEADING_ZERO_SIZE - 1)] ?? 0;
					bits = zeros;
					while (zeros === 0) {
						bits += LEADING_ZERO_BITS;
						bitPlace += LEADING_ZERO_BITS;
						poolPlace += bitPlace >> 3;
						bitPlace &= 7;
						window = readPool(poolPlace) >>> bitPlace;
						zeros =
							TLG6_LEADING_ZERO_TABLE[window & (LEADING_ZERO_SIZE - 1)] ?? 0;
						bits += zeros;
					}
					bits -= 1;
				} else {
					// The reference stands the places of the picture of the walk of the places of the picture
					// of the words of the walk of the picture of the places of the picture of the walk of them
					// of the places of the picture behind them where the places of the picture of the walk of
					// the places of the picture of the sound stand of no places of the picture of the walk of
					// the places of the picture of the places of the picture of the walk of them.
					poolPlace += 5;
					bits = pool[poolPlace - 1] ?? 0;
					bitPlace = 0;
					window = readPool(poolPlace);
					zeros = 0;
				}
				const value = ((bits << k) + ((window >>> zeros) & ((1 << k) - 1))) | 0;
				const sign = (value & 1) - 1;
				const magnitude = value >> 1;
				sum += magnitude;
				const placed = (magnitude ^ sign) + sign + 1;
				if (first) pixels[pixel] = placed & 0xff;
				else {
					pixels[pixel] =
						((pixels[pixel] ?? 0) & mask) | (((placed & 0xff) << offset) >>> 0);
				}
				pixel += 1;
				bitPlace += zeros;
				bitPlace += k;
				poolPlace += bitPlace >> 3;
				bitPlace &= 7;
				n -= 1;
				if (n < 0) {
					sum >>= 1;
					n = GOLOMB_N_COUNT - 1;
				}
			}
			zero = true;
		}
	}
}
