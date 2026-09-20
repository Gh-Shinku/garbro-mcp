/** How many places of a picture a place of a colour of it stands in, and how many places stand in every side
 * of that place. */
const PLACES_PER_BLOCK = 64;
const PLACES_PER_SIDE = 8;
const SIDE_STRIDE = 8;
const SIDE_LAST = 7;
const ROTATE = 35467;
const COS_1 = 50159;
const COS_3 = -121094;
const COS_SUM = 77062;
const SIN_1 = 19571;
const SIN_COS_1 = -128553;
const SIN_COS_2 = -58980;
const SIN_COS_3 = 134553;
const SIN_COS_4 = -25570;
const SIN_COS_5 = -167963;
const SIN_COS_6 = 98390;
const SIN_COS_7 = 201373;
const PLACES_BEHIND = 16;
const PLACES_OF_OUTPUT = 3;

export function inverseJbpDct(
	table: Int16Array,
	quant: Int16Array,
	offset = 0,
): void {
	const at = (index: number): number => offset + index;
	for (let place = 0; place < PLACES_PER_SIDE; place += 1) {
		const p = place;
		const q = place;
		if (
			(table[at(p + 0x08)] ?? 0) === 0 &&
			(table[at(p + 0x10)] ?? 0) === 0 &&
			(table[at(p + 0x18)] ?? 0) === 0 &&
			(table[at(p + 0x20)] ?? 0) === 0 &&
			(table[at(p + 0x28)] ?? 0) === 0 &&
			(table[at(p + 0x30)] ?? 0) === 0 &&
			(table[at(p + 0x38)] ?? 0) === 0
		) {
			const value = (table[at(p)] ?? 0) * (quant[q] ?? 0);
			for (let place2 = 0; place2 < PLACES_PER_SIDE; place2 += 1) {
				table[at(p + place2 * SIDE_STRIDE)] = value;
			}
			continue;
		}
		let c = (quant[q + 0x10] ?? 0) * (table[at(p + 0x10)] ?? 0);
		let d = (quant[q + 0x30] ?? 0) * (table[at(p + 0x30)] ?? 0);
		let x = Math.imul(c + d, ROTATE) >> PLACES_BEHIND;
		c = (Math.imul(c, COS_1) >> PLACES_BEHIND) + x;
		d = (Math.imul(d, COS_3) >> PLACES_BEHIND) + x;
		const a = (table[at(p + 0x00)] ?? 0) * (quant[q + 0x00] ?? 0);
		const b = (table[at(p + 0x20)] ?? 0) * (quant[q + 0x20] ?? 0);
		const w = (a + b + c) | 0;
		x = (a + b - c) | 0;
		const y = (a - b + d) | 0;
		const z = (a - b - d) | 0;
		const cc = (table[at(p + 0x38)] ?? 0) * (quant[q + 0x38] ?? 0);
		const dd = (table[at(p + 0x28)] ?? 0) * (quant[q + 0x28] ?? 0);
		const aa = (table[at(p + 0x18)] ?? 0) * (quant[q + 0x18] ?? 0);
		const bb = (table[at(p + 0x08)] ?? 0) * (quant[q + 0x08] ?? 0);
		const n = Math.imul(aa + bb + cc + dd, COS_SUM) >> PLACES_BEHIND;
		const u =
			(n +
				(Math.imul(cc, SIN_1) >> PLACES_BEHIND) +
				(Math.imul(cc + aa, SIN_COS_1) >> PLACES_BEHIND) +
				(Math.imul(cc + bb, SIN_COS_2) >> PLACES_BEHIND)) |
			0;
		const v =
			(n +
				(Math.imul(dd, SIN_COS_3) >> PLACES_BEHIND) +
				(Math.imul(dd + bb, SIN_COS_4) >> PLACES_BEHIND) +
				(Math.imul(dd + aa, SIN_COS_5) >> PLACES_BEHIND)) |
			0;
		const t =
			(n +
				(Math.imul(bb, SIN_COS_6) >> PLACES_BEHIND) +
				(Math.imul(dd + bb, SIN_COS_4) >> PLACES_BEHIND) +
				(Math.imul(cc + bb, SIN_COS_2) >> PLACES_BEHIND)) |
			0;
		const s =
			(n +
				(Math.imul(aa, SIN_COS_7) >> PLACES_BEHIND) +
				(Math.imul(cc + aa, SIN_COS_1) >> PLACES_BEHIND) +
				(Math.imul(dd + aa, SIN_COS_5) >> PLACES_BEHIND)) |
			0;
		table[at(p)] = w + t;
		table[at(p + 0x38)] = w - t;
		table[at(p + 0x08)] = y + s;
		table[at(p + 0x30)] = y - s;
		table[at(p + 0x10)] = z + v;
		table[at(p + 0x28)] = z - v;
		table[at(p + 0x18)] = x + u;
		table[at(p + 0x20)] = x - u;
	}
	let p = 0;
	for (let place = 0; place < PLACES_PER_SIDE; place += 1) {
		const a = table[at(p)] ?? 0;
		let c = table[at(p + 2)] ?? 0;
		const b = table[at(p + 4)] ?? 0;
		let d = table[at(p + 6)] ?? 0;
		let x = Math.imul(c + d, ROTATE) >> PLACES_BEHIND;
		c = (Math.imul(c, COS_1) >> PLACES_BEHIND) + x;
		d = (Math.imul(d, COS_3) >> PLACES_BEHIND) + x;
		const w = (a + b + c) | 0;
		x = (a + b - c) | 0;
		const y = (a - b + d) | 0;
		const z = (a - b - d) | 0;
		d = table[at(p + 5)] ?? 0;
		const b2 = table[at(p + 1)] ?? 0;
		const c2 = table[at(p + 7)] ?? 0;
		const a2 = table[at(p + 3)] ?? 0;
		const n = Math.imul(a2 + b2 + c2 + d, COS_SUM) >> PLACES_BEHIND;
		const s =
			(n +
				(Math.imul(a2, SIN_COS_7) >> PLACES_BEHIND) +
				(Math.imul(a2 + c2, SIN_COS_1) >> PLACES_BEHIND) +
				(Math.imul(a2 + d, SIN_COS_5) >> PLACES_BEHIND)) |
			0;
		const t =
			(n +
				(Math.imul(b2, SIN_COS_6) >> PLACES_BEHIND) +
				(Math.imul(b2 + c2, SIN_COS_2) >> PLACES_BEHIND) +
				(Math.imul(b2 + d, SIN_COS_4) >> PLACES_BEHIND)) |
			0;
		const u =
			(n +
				(Math.imul(c2, SIN_1) >> PLACES_BEHIND) +
				(Math.imul(b2 + c2, SIN_COS_2) >> PLACES_BEHIND) +
				(Math.imul(a2 + c2, SIN_COS_1) >> PLACES_BEHIND)) |
			0;
		const v =
			(n +
				(Math.imul(d, SIN_COS_3) >> PLACES_BEHIND) +
				(Math.imul(b2 + d, SIN_COS_4) >> PLACES_BEHIND) +
				(Math.imul(a2 + d, SIN_COS_5) >> PLACES_BEHIND)) |
			0;
		table[at(p)] = (w + t) >> PLACES_OF_OUTPUT;
		table[at(p + SIDE_LAST)] = (w - t) >> PLACES_OF_OUTPUT;
		table[at(p + 1)] = (y + s) >> PLACES_OF_OUTPUT;
		table[at(p + 6)] = (y - s) >> PLACES_OF_OUTPUT;
		table[at(p + 2)] = (z + v) >> PLACES_OF_OUTPUT;
		table[at(p + 5)] = (z - v) >> PLACES_OF_OUTPUT;
		table[at(p + 3)] = (x + u) >> PLACES_OF_OUTPUT;
		table[at(p + 4)] = (x - u) >> PLACES_OF_OUTPUT;
		p += PLACES_PER_SIDE;
	}
}

export const JBP_PLACES_PER_BLOCK = PLACES_PER_BLOCK;
