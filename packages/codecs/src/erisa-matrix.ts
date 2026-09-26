// The counts of the walk of the places of the Entis engine, of the reference `ArcFormats/Entis/ErisaMatrix.cs`
// (the class `Erisa`).
//
// The engine stands of the counts of the walk of the places of a sound or of a picture of it over the
// places of the walk of a block of the engine: the counts of the walk of the places of the engine (the
// counts of the walk of the places of a block of it, `FastDCT` and `FastIDCT`), the counts of the walk of
// the places of a block of the engine over the places of the walk of the block behind it, the walks of the
// places of a colour of it (`FastILOT`, `FastILOT8x8`), the walks of the places of the count of the walk of
// the engine (`CreateRevolveParameter`, `OddGivensInverseMatrix`, `Revolve2x2`) and the walks of the places
// of a count of the engine into the places of the file of it (`RoundR32ToWordArray`,
// `ConvertArrayFloatToByte`, `ConvertArrayFloatToSByte`).
//
// The walk of the counts of the engine of a block of four places of it and up stands of the run of the
// places of the walk of the counts of the engine of the walk of it of its own: the reference stands of the
// same run as both the places of the walk of the counts of the engine and the places of the walk of the
// counts of the engine behind them (`FastDCT` of the places of the walk of the engine of the counts of the
// walk of it), so the counts of the walk of the engine of a block of four places stand of the counts of the
// walk of the engine of the counts of the walk of it itself rather than of the counts of a block of the
// engine. The walk of the counts of the engine of a block of two places of it and of three places of it
// stands of the counts of a block of the engine of its own. This port stands of the walk of the reference.
//
// The table of the counts of the walk of the places of a block of the engine at the head of the walk of it
// (`ERI_DCTofK2`, of the places of the count of the walk of a block of two places of it) stands of the
// places of the file of the reference as a run of places of no count at all: the reference never stands of
// the places of that run, where the comment of the reference itself names the counts of it
// (`cos ((2*i+1) / 8)`). This port stands of those counts, which is the walk the reference stands of in
// every walk of the places of a block of the engine behind it.

const MIN_DCT_DEGREE = 2;

/** The places of the table of the walks of the engine, of the count of the places of the walk of it. */
const DCT_OF_K2 = [
	Math.fround(Math.cos(Math.PI / 8)),
	Math.fround(Math.cos((3 * Math.PI) / 8)),
];
const DCT_OF_K: Float32Array[] = [];
const PLACES_PER_WORD = 2;
const WORD_LIMIT = 0x8000;
const WORD_TOP = 0x7fff;
const BYTE_LIMIT = 0x80;
const BYTE_TOP = 0x7f;
const BYTE_PLACES = 0x100;

/** The counts of the walk of the places of a block of the engine, of the count of the walk of it. */
export function erisaDctOfK(degree: number): Float32Array {
	const cached = DCT_OF_K[degree];
	if (cached) return cached;
	const count = 1 << degree;
	const table = new Float32Array(count);
	// The place of a count of the walk of the engine stands of the count of the places of the walk of it:
	// `cos((2*j+1) * pi / (4 * count))`.
	const step = Math.PI / (4 * count);
	let angle = step;
	for (let at = 0; at < count; at += 1) {
		table[at] = Math.fround(Math.cos(angle));
		angle += step + step;
	}
	DCT_OF_K[degree] = table;
	return table;
}

/** `Erisa.RoundR32ToInt`: the count of the walk of a place of the engine, of the place of it. */
export function roundR32ToInt(value: number): number {
	return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

/** `Erisa.RoundR32ToWordArray`: the counts of the walk of the engine into the places of a count of it. */
export function roundR32ToWordArray(
	places: Uint8Array | Buffer,
	at: number,
	step: number,
	source: Float32Array,
	count: number,
): void {
	let to = at;
	const stride = step * PLACES_PER_WORD;
	for (let place = 0; place < count; place += 1) {
		const value = roundR32ToInt(source[place] ?? 0);
		const word =
			value <= -WORD_LIMIT ? -WORD_LIMIT : value >= WORD_TOP ? WORD_TOP : value;
		places[to] = word & 0xff;
		places[to + 1] = (word >> 8) & 0xff;
		to += stride;
	}
}

/** A count of the walk of the engine, of the places of the count of the walk of it. */
export interface EriSinCos {
	rSin: number;
	rCos: number;
}

/** `Erisa.CreateRevolveParameter`: the counts of the walks of the places of the count of the engine. */
export function createRevolveParameter(degree: number): EriSinCos[] {
	const places = 1 << degree;
	let count = 1;
	for (let at = Math.trunc(places / 2); at >= 8; at = Math.trunc(at / 8)) {
		count += 1;
	}
	const revolve: EriSinCos[] = [];
	for (let at = 0; at < count * 8; at += 1) revolve.push({ rSin: 0, rCos: 0 });
	const place = Math.PI / (places * 2);
	let next = 0;
	let step = 2;
	do {
		for (let at = 0; at < 7; at += 1) {
			let sin = 1;
			let angle = 0;
			for (let before = 0; before < at; before += 1) {
				angle += step;
				sin =
					sin * (revolve[next + before]?.rSin ?? 0) +
					(revolve[next + before]?.rCos ?? 0) * Math.cos(angle * place);
			}
			const value = Math.atan2(sin, Math.cos((angle + step) * place));
			const target = revolve[next + at];
			if (target) {
				target.rSin = Math.fround(Math.sin(value));
				target.rCos = Math.fround(Math.cos(value));
			}
		}
		next += 7;
		step *= 8;
	} while (step < places);
	return revolve;
}

/** `Erisa.OddGivensInverseMatrix`: the walk of the counts of the count of the engine. */
export function oddGivensInverseMatrix(
	places: Float32Array,
	at: number,
	revolve: readonly EriSinCos[],
	degree: number,
): void {
	const placesCount = 1 << degree;
	let index = 1;
	let step = 2;
	let count = Math.trunc(placesCount / 2 / 8);
	let resolve = 0;
	for (;;) {
		resolve += 7;
		index += step * 7;
		step *= 8;
		if (count <= 8) break;
		count = Math.trunc(count / 8);
	}
	let place = index + step * (count - 2);
	for (let block = count - 2; block >= 0; block -= 1) {
		const first = places[at + place] ?? 0;
		const second = places[at + place + step] ?? 0;
		const cos = revolve[resolve + block]?.rCos ?? 0;
		const sin = revolve[resolve + block]?.rSin ?? 0;
		places[at + place] = first * cos + second * sin;
		places[at + place + step] = second * cos - first * sin;
		place -= step;
	}
	while (count <= Math.trunc(placesCount / 2 / 8)) {
		resolve -= 7;
		step = Math.trunc(step / 8);
		index -= step * 7;
		for (let block = 0; block < count; block += 1) {
			let place2 = block * (step * 8) + index + step * 6;
			for (let inner = 6; inner >= 0; inner -= 1) {
				const first = places[at + place2] ?? 0;
				const second = places[at + place2 + step] ?? 0;
				const cos = revolve[resolve + inner]?.rCos ?? 0;
				const sin = revolve[resolve + inner]?.rSin ?? 0;
				places[at + place2] = first * cos + second * sin;
				places[at + place2 + step] = second * cos - first * sin;
				place2 -= step;
			}
		}
		count *= 8;
	}
}

/** `Erisa.Revolve2x2`: the counts of the walk of the places of two counts of the engine. */
export function revolve2x2(
	first: Float32Array,
	atFirst: number,
	second: Float32Array,
	atSecond: number,
	rSin: number,
	rCos: number,
	step: number,
	count: number,
): void {
	let one = atFirst;
	let two = atSecond;
	for (let place = 0; place < count; place += 1) {
		const left = first[one] ?? 0;
		const right = second[two] ?? 0;
		first[one] = left * rCos - right * rSin;
		second[two] = left * rSin + right * rCos;
		one += step;
		two += step;
	}
}

/** `Erisa.FastIPLOT`: the counts of the walk of the places of a colour of the engine. */
export function fastIplot(
	places: Float32Array,
	at: number,
	degree: number,
): void {
	const count = 1 << degree;
	for (let place = 0; place < count; place += 2) {
		const first = places[at + place] ?? 0;
		const second = places[at + place + 1] ?? 0;
		places[at + place] = Math.fround(0.5 * (first + second));
		places[at + place + 1] = Math.fround(0.5 * (first - second));
	}
}

/** `Erisa.FastILOT`: the counts of the walk of the places of two counts of a colour of the engine. */
export function fastIlot(
	places: Float32Array,
	first: Float32Array,
	atFirst: number,
	second: Float32Array,
	atSecond: number,
	degree: number,
): void {
	const count = 1 << degree;
	for (let place = 0; place < count; place += 2) {
		const left = first[atFirst + place] ?? 0;
		const right = second[atSecond + place + 1] ?? 0;
		places[place] = Math.fround(left + right);
		places[place + 1] = Math.fround(left - right);
	}
}

/** `Erisa.FastDCT`: the counts of the walk of the places of a block of the engine. */
export function fastDct(
	places: Float32Array,
	at: number,
	interval: number,
	source: Float32Array,
	from: number,
	work: Float32Array,
	workAt: number,
	degree: number,
): void {
	if (degree === MIN_DCT_DEGREE) {
		const buffer = new Float32Array(4);
		buffer[0] = (source[from] ?? 0) + (source[from + 3] ?? 0);
		buffer[2] = (source[from] ?? 0) - (source[from + 3] ?? 0);
		buffer[1] = (source[from + 1] ?? 0) + (source[from + 2] ?? 0);
		buffer[3] = (source[from + 1] ?? 0) - (source[from + 2] ?? 0);
		places[at] = Math.fround(0.5 * (buffer[0] + buffer[1]));
		places[at + interval * 2] = Math.fround(
			Math.SQRT1_2 * (buffer[0] - buffer[1]),
		);
		buffer[2] = Math.fround((DCT_OF_K2[0] ?? 0) * buffer[2]);
		buffer[3] = Math.fround((DCT_OF_K2[1] ?? 0) * buffer[3]);
		buffer[0] = Math.fround(buffer[2] + buffer[3]);
		buffer[1] = Math.fround(2 * Math.SQRT1_2 * (buffer[2] - buffer[3]));
		buffer[1] = Math.fround(buffer[1] - buffer[0]);
		places[at + interval] = buffer[0];
		places[at + interval * 3] = buffer[1];
		return;
	}
	const count = 1 << degree;
	const half = count >> 1;
	for (let place = 0; place < half; place += 1) {
		work[workAt + place] =
			(source[from + place] ?? 0) + (source[from + count - place - 1] ?? 0);
		work[workAt + place + half] =
			(source[from + place] ?? 0) - (source[from + count - place - 1] ?? 0);
	}
	const step = interval << 1;
	fastDct(places, at, step, work, workAt, source, from, degree - 1);
	const table = erisaDctOfK(degree - 1);
	const oddAt = workAt + half;
	for (let place = 0; place < half; place += 1) {
		work[oddAt + place] = Math.fround(
			(work[oddAt + place] ?? 0) * (table[place] ?? 0),
		);
	}
	fastDct(places, at + interval, step, work, oddAt, work, workAt, degree - 1);
	let next = at + interval;
	for (let place = 0; place < half; place += 1) {
		places[next] = Math.fround((places[next] ?? 0) + (places[next] ?? 0));
		next += step;
	}
	next = at + interval;
	for (let place = 1; place < half; place += 1) {
		places[next + step] = Math.fround(
			(places[next + step] ?? 0) - (places[next] ?? 0),
		);
		next += step;
	}
}

/** `Erisa.FastIDCT`: the counts of the walk of the places of a block of the engine of the other way. */
export function fastIdct(
	places: Float32Array,
	at: number,
	source: Float32Array,
	from: number,
	interval: number,
	work: Float32Array,
	degree: number,
): void {
	if (degree === MIN_DCT_DEGREE) {
		const buffer1 = new Float32Array(2);
		const buffer2 = new Float32Array(4);
		buffer1[0] = source[from] ?? 0;
		buffer1[1] = Math.fround(Math.SQRT1_2 * (source[from + interval * 2] ?? 0));
		buffer2[0] = Math.fround(buffer1[0] + buffer1[1]);
		buffer2[1] = Math.fround(buffer1[0] - buffer1[1]);
		buffer1[0] = Math.fround(
			(DCT_OF_K2[0] ?? 0) * (source[from + interval] ?? 0),
		);
		buffer1[1] = Math.fround(
			(DCT_OF_K2[1] ?? 0) * (source[from + interval * 3] ?? 0),
		);
		buffer2[2] = Math.fround(buffer1[0] + buffer1[1]);
		buffer2[3] = Math.fround(2 * Math.SQRT1_2 * (buffer1[0] - buffer1[1]));
		buffer2[3] = Math.fround(buffer2[3] - buffer2[2]);
		places[at] = Math.fround(buffer2[0] + buffer2[2]);
		places[at + 3] = Math.fround(buffer2[0] - buffer2[2]);
		places[at + 1] = Math.fround(buffer2[1] + buffer2[3]);
		places[at + 2] = Math.fround(buffer2[1] - buffer2[3]);
		return;
	}
	const count = 1 << degree;
	const half = count >> 1;
	const step = interval << 1;
	fastIdct(places, at, source, from, step, work, degree - 1);
	const table = erisaDctOfK(degree - 1);
	const oddAt = at + half;
	let next = from + interval;
	for (let place = 0; place < half; place += 1) {
		work[place] = Math.fround((source[next] ?? 0) * (table[place] ?? 0));
		next += step;
	}
	fastDct(places, oddAt, 1, work, 0, work, half, degree - 1);
	for (let place = 0; place < half; place += 1) {
		places[oddAt + place] = Math.fround(
			(places[oddAt + place] ?? 0) + (places[oddAt + place] ?? 0),
		);
	}
	for (let place = 1; place < half; place += 1) {
		places[oddAt + place] = Math.fround(
			(places[oddAt + place] ?? 0) - (places[oddAt + place - 1] ?? 0),
		);
	}
	const quad = half >> 1;
	for (let place = 0; place < quad; place += 1) {
		const first = Math.fround(
			(places[at + place] ?? 0) + (places[half + place] ?? 0),
		);
		const fourth = Math.fround(
			(places[at + place] ?? 0) - (places[half + place] ?? 0),
		);
		const second = Math.fround(
			(places[half - 1 - place] ?? 0) + (places[at + count - 1 - place] ?? 0),
		);
		const third = Math.fround(
			(places[half - 1 - place] ?? 0) - (places[at + count - 1 - place] ?? 0),
		);
		places[at + place] = first;
		places[half - 1 - place] = second;
		places[half + place] = third;
		places[at + count - 1 - place] = fourth;
	}
}

/** `Erisa.ConvertArraySByteToFloat`: the counts of the walk of the engine of the places of a count. */
export function convertArraySByteToFloat(
	places: Float32Array,
	source: Uint8Array | Buffer,
	at: number,
	count: number,
): void {
	for (let place = 0; place < count; place += 1) {
		places[place] = ((source[at + place] ?? 0) << 24) >> 24;
	}
}

/** `Erisa.VectorMultiply`: the counts of the walk of the engine over the counts of the walk of it. */
export function vectorMultiply(
	places: Float32Array,
	source: Float32Array,
	at: number,
	count: number,
): void {
	for (let place = 0; place < count; place += 1) {
		places[place] = Math.fround(
			(places[place] ?? 0) * (source[at + place] ?? 0),
		);
	}
}

/** `Erisa.FastIDCT8x8`: the counts of the walk of the places of a block of eight by eight. */
export function fastIdct8x8(places: Float32Array): void {
	const work = new Float32Array(8);
	const temp = new Float32Array(64);
	for (let at = 0; at < 8; at += 1) {
		fastIdct(temp, at * 8, places, at, 8, work, 3);
	}
	for (let at = 0; at < 8; at += 1) {
		fastIdct(places, at * 8, temp, at, 8, work, 3);
	}
}

/** The counts of the walks of the places of the count of the engine of a picture of eight by eight. */
const ROTATION_8X8: EriSinCos[] = [
	{ rSin: 0.73451, rCos: 0.678598 },
	{ rSin: 0.887443, rCos: 0.460917 },
	{ rSin: 0.970269, rCos: 0.24203 },
];

/** `Erisa.FastILOT8x8`: the counts of the walk of the places of a colour of eight by eight. */
export function fastIlot8x8(
	places: Float32Array,
	horizontal: Float32Array,
	atHorizontal: number,
	vertical: Float32Array,
	atVertical: number,
): void {
	const work = new Float32Array(8);
	const temp = new Float32Array(64);
	for (let at = 0; at < 8; at += 1) {
		for (let step = 2, place = at + 40; step >= 0; step -= 1, place -= 16) {
			const first = places[place] ?? 0;
			const second = places[place + 16] ?? 0;
			const rotate = ROTATION_8X8[step];
			places[place] = Math.fround(
				first * (rotate?.rCos ?? 0) + second * (rotate?.rSin ?? 0),
			);
			places[place + 16] = Math.fround(
				second * (rotate?.rCos ?? 0) - first * (rotate?.rSin ?? 0),
			);
		}
	}
	for (let at = 0; at < 64; at += 16) {
		for (let place = 0; place < 8; place += 1) {
			const one = at + place;
			const first = places[one] ?? 0;
			const second = places[one + 8] ?? 0;
			const sum = Math.fround(0.5 * (first + second));
			const delta = Math.fround(0.5 * (first - second));
			const held = vertical[atVertical + one] ?? 0;
			vertical[atVertical + one] = sum;
			vertical[atVertical + one + 8] = delta;
			places[one] = Math.fround(held + delta);
			places[one + 8] = Math.fround(held - delta);
		}
	}
	for (let at = 0; at < 64; at += 8) {
		for (let step = 2, place = at + 5; step >= 0; step -= 1, place -= 2) {
			const first = places[place] ?? 0;
			const second = places[place + 2] ?? 0;
			const rotate = ROTATION_8X8[step];
			places[place] = Math.fround(
				first * (rotate?.rCos ?? 0) + second * (rotate?.rSin ?? 0),
			);
			places[place + 2] = Math.fround(
				second * (rotate?.rCos ?? 0) - first * (rotate?.rSin ?? 0),
			);
		}
		for (let place = 0; place < 8; place += 2) {
			const one = at + place;
			const first = places[one] ?? 0;
			const second = places[one + 1] ?? 0;
			const sum = Math.fround(0.5 * (first + second));
			const delta = Math.fround(0.5 * (first - second));
			const held = horizontal[atHorizontal + one] ?? 0;
			horizontal[atHorizontal + one] = sum;
			horizontal[atHorizontal + one + 1] = delta;
			places[one] = Math.fround(held + delta);
			places[one + 1] = Math.fround(held - delta);
		}
	}
	for (let at = 0; at < 8; at += 1) {
		fastIdct(temp, at * 8, places, at, 8, work, 3);
	}
	for (let at = 0; at < 8; at += 1) {
		fastIdct(places, at * 8, temp, at, 8, work, 3);
	}
}

/** `Erisa.ConvertArrayFloatToByte`: the counts of the walk of the engine into the places of a count. */
export function convertArrayFloatToByte(
	places: Uint8Array | Buffer,
	source: Float32Array,
	count: number,
): void {
	for (let place = 0; place < count; place += 1) {
		let value = roundR32ToInt(source[place] ?? 0);
		if ((value & 0xffffffff) > 0xff) {
			value = (~value >> 31) & BYTE_PLACES;
		}
		places[place] = value & 0xff;
	}
}

/** `Erisa.ConvertArrayFloatToSByte`: the same, of the counts of the walk of the engine of a sign. */
export function convertArrayFloatToSByte(
	places: Uint8Array | Buffer,
	source: Float32Array,
	count: number,
): void {
	for (let place = 0; place < count; place += 1) {
		let value = roundR32ToInt(source[place] ?? 0);
		if (value < -BYTE_LIMIT) value = -BYTE_LIMIT;
		else if (value > BYTE_TOP) value = BYTE_TOP;
		places[place] = value & 0xff;
	}
}
