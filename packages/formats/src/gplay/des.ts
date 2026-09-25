// Format reference: GARbro "Legacy/GPlay/ArcYSK.cs", class `DesTransform`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	PSHIFT0,
	PSHIFT1,
	PSHIFT2,
	PSHIFT3,
	PSTATE,
	ST0,
	ST1,
	ST2,
	ST3,
	ST4,
	ST5,
	ST6,
	ST7,
	TMASK0,
	TMASK1,
	TSHIFT0,
	TSHIFT1,
	TSHIFT2,
} from "./ysk-tables.js";

/** The places of the file of a block of the cipher of the engine. */
export const YSK_BLOCK_SIZE = 8;
const MBITS = 0x80000000;
const HIGH_PLACES = 0x800000000000n;
const HIGHEST_PLACES = 0x8000000000000000n;

/**
 * The cipher of the GPlay engine, of the places of the file of the walk of the engine itself: the reference
 * stands of a walk of the places of the file at a place of the file of the walk of the place of a colour and
 * of the places of the file of the permutation of them. The places of the file of the walk of the engine
 * stand of the places of the file of the cipher of the *other* way around from the walk of the places of the
 * file of the place of the colour of it: the reference stands of this walk alone (`SetKey` and
 * `TransformQWord`), so it stands of the walk of the places of the file of a picture of the engine itself,
 * of the places of the file of a picture of the walk of the places of the file of it.
 */
export class GplayDes {
	private readonly subkeys: bigint[] = [];
	private readonly state: Uint8Array = new Uint8Array(512);

	constructor(key: bigint) {
		this.setKey(key);
	}

	/** `DesTransform.SetKey`: the places of the file of the walk of the places of the key of the engine. */
	private setKey(key: bigint): void {
		let p = 0;
		let q = 0;
		for (let at = 0; at < 28; at += 1) {
			p >>>= 1;
			q >>>= 1;
			if (0n !== ((key >> BigInt(PSHIFT0[at] ?? 0)) & 1n)) {
				p = (p | 0x8000000) >>> 0;
			}
			if (0n !== ((key >> BigInt(PSHIFT1[at] ?? 0)) & 1n)) {
				q = (q | 0x8000000) >>> 0;
			}
		}
		for (let at = 0; at < 16; at += 1) {
			const shift = PSHIFT2[at] ?? 0;
			const p0 = ((p | ((p << 28) >>> 0)) >>> shift) & 0xfffffff;
			q = (((q | ((p << 28) >>> 0)) >>> 0) >>> shift) & 0xfffffff;
			p = p0 & 0xfffffff;
			const q0 = (p | ((q << 28) >>> 0)) >>> 0;
			const word = (BigInt(q >>> 4) << 32n) | BigInt(q0);
			let places = 0n;
			for (let bit = 0; bit < 48; bit += 1) {
				places >>= 1n;
				if (0n !== ((word >> BigInt(PSHIFT3[bit] ?? 0)) & 1n)) {
					places |= HIGH_PLACES;
				}
			}
			this.subkeys[at] = places;
		}
		let outer = 0;
		for (let at = 0; at < 4; at += 2) {
			let third = outer;
			for (let first = 0; first < 16; ) {
				let second = third;
				for (let _k = 2; _k > 0; _k -= 1) {
					let inner = second;
					for (let _m = 2; _m > 0; _m -= 1) {
						let place = Math.trunc(inner / 4);
						for (let _n = 2; _n > 0; _n -= 1) {
							let src = first + 16 * at;
							this.state[place] = PSTATE[ST0[src] ?? 0] ?? 0;
							this.state[64 + place] = PSTATE[ST1[src] ?? 0] ?? 0;
							this.state[128 + place] = PSTATE[ST2[src] ?? 0] ?? 0;
							this.state[192 + place] = PSTATE[ST3[src] ?? 0] ?? 0;
							this.state[256 + place] = PSTATE[ST4[src] ?? 0] ?? 0;
							this.state[320 + place] = PSTATE[ST5[src] ?? 0] ?? 0;
							this.state[384 + place] = PSTATE[ST6[src] ?? 0] ?? 0;
							this.state[448 + place] = PSTATE[ST7[src] ?? 0] ?? 0;
							src = first + 16 * (at + 1);
							this.state[32 + place] = PSTATE[ST0[src] ?? 0] ?? 0;
							this.state[96 + place] = PSTATE[ST1[src] ?? 0] ?? 0;
							this.state[160 + place] = PSTATE[ST2[src] ?? 0] ?? 0;
							this.state[224 + place] = PSTATE[ST3[src] ?? 0] ?? 0;
							this.state[288 + place] = PSTATE[ST4[src] ?? 0] ?? 0;
							this.state[352 + place] = PSTATE[ST5[src] ?? 0] ?? 0;
							this.state[416 + place] = PSTATE[ST6[src] ?? 0] ?? 0;
							this.state[480 + place] = PSTATE[ST7[src] ?? 0] ?? 0;
							place += 16;
							first += 1;
						}
						inner += 32;
					}
					second += 16;
				}
				third += 8;
			}
			outer += 4;
		}
	}

	/** `DesTransform.TransformQWord`: the places of the file of a block of the walk of the cipher. */
	transformQWord(word: bigint): bigint {
		let high = 0;
		let low = 0;
		for (let at = 0; at < 32; at += 1) {
			high >>>= 1;
			low >>>= 1;
			if (0n !== ((word >> BigInt(TSHIFT0[at] ?? 0)) & 1n)) {
				high = (high | MBITS) >>> 0;
			}
			if (0n !== ((word >> BigInt(TSHIFT1[at] ?? 0)) & 1n)) {
				low = (low | MBITS) >>> 0;
			}
		}
		let side = low;
		for (let round = 15; round >= 0; round -= 1) {
			let value = 0n;
			for (let bit = 0; bit < 48; bit += 1) {
				value >>= 1n;
				if (0 !== ((TMASK0[bit] ?? 0) & low)) {
					value |= HIGH_PLACES;
				}
			}
			value ^= this.subkeys[round] ?? 0n;
			const places: number[] = [];
			for (let at = 0; at < 8; at += 1) {
				places.push(Number((value >> BigInt(6 * at)) & 0xffn));
			}
			// The places of the file of the walk of the engine stand of the places of the file of the walk of
			// the places of the colour of a place of the picture, of the places of the file of the eight places
			// of the walk of the engine itself: the places of the file of the table of the walk of the engine
			// stand of the places of the file of the walk of the eight S tables of the engine, of the four
			// places of the file of a place of the table of a colour of the picture.
			const tables = [320, 448, 192, 128, 256, 0, 64, 384];
			let packed = 0;
			for (let at = 0; at < 8; at += 1) {
				const place = ((places[at] ?? 0) & 0x3f) + (tables[at] ?? 0);
				packed = (packed * 16 + (this.state[place] ?? 0)) >>> 0;
			}
			let swapped = 0;
			for (let bit = 0; bit < 32; bit += 1) {
				swapped >>>= 1;
				if (0 !== ((TMASK1[bit] ?? 0) & packed)) {
					swapped = (swapped | MBITS) >>> 0;
				}
			}
			side = low;
			low = (high ^ swapped) >>> 0;
			high = side;
		}
		const places = (BigInt(side) << 32n) | BigInt(low);
		let result = 0n;
		for (let bit = 0; bit < 64; bit += 1) {
			result >>= 1n;
			if (0n !== ((places >> BigInt(TSHIFT2[bit] ?? 0)) & 1n)) {
				result |= HIGHEST_PLACES;
			}
		}
		return result;
	}

	/**
	 * `DesTransform.TransformBlock`: the places of the file of a picture, of the walks of the places of the
	 * file of the cipher of the engine, of the places of the file of a block of eight of them at a time.
	 */
	transform(data: Buffer, at: number, count: number): void {
		for (let placed = 0; placed < count; placed += YSK_BLOCK_SIZE) {
			const size = Math.min(YSK_BLOCK_SIZE, count - placed);
			let word = 0n;
			for (let byte = 0; byte < size; byte += 1) {
				word |= BigInt(data[at + placed + byte] ?? 0) << BigInt(byte * 8);
			}
			word = this.transformQWord(word);
			for (let byte = 0; byte < size; byte += 1) {
				data[at + placed + byte] = Number(word & 0xffn);
				word >>= 8n;
			}
		}
	}
}

/** `DesTransform.TransformBlock` of a picture: the places of the file of the cipher, of the places of it. */
export function gplayDecrypt(data: Buffer): Buffer {
	const output = Buffer.from(data);
	const des = new GplayDes(0x1234567812345678n);
	des.transform(output, 0, output.length);
	return output;
}
