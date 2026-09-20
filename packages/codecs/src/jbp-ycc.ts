const COLOURS_PER_PLACE = 4;
const PLACES_PER_ROW = 4;
const PLACES_PER_COLOUR = 2;
const RED_PLACES = 0x166f0;
const GREEN_BLUE = 0x5810;
const GREEN_RED = 0xb6c0;
const BLUE_PLACES = 0x1c590;
const PLACES_BEHIND = 16;
const COLOUR_CENTRE = 0x180;
const LOWEST_COLOUR = 0x100;
const HIGHEST_COLOUR = 0x200;
const LOWEST_PLACE = 0;
const HIGHEST_PLACE = 0xff;

export function clampJbpColour(value: number): number {
	if (value < LOWEST_COLOUR) return LOWEST_PLACE;
	if (value >= HIGHEST_COLOUR) return HIGHEST_PLACE;
	return value - LOWEST_COLOUR;
}

export interface JbpColourOptions {
	output: Buffer;
	stride: number;
	dc: number;
	ac: number;
	y: Int16Array;
	cb: Int16Array;
	cr: Int16Array;
	cbcrSrc: number;
	ySrc?: number;
}

export function standJbpColours(options: JbpColourOptions): void {
	const { output, stride, y, cb, cr } = options;
	let dc = options.dc;
	let ac = options.ac;
	let ySrc = options.ySrc ?? 0;
	let cbcrSrc = options.cbcrSrc;
	for (let row = 0; row < PLACES_PER_ROW; row += 1) {
		for (let at = 0; at < PLACES_PER_ROW; at += 1) {
			const cbPlace = cb[cbcrSrc] ?? 0;
			const crPlace = cr[cbcrSrc] ?? 0;
			const red = Math.imul(crPlace, RED_PLACES) >> PLACES_BEHIND;
			const green =
				(Math.imul(cbPlace, GREEN_BLUE) >> PLACES_BEHIND) +
				(Math.imul(crPlace, GREEN_RED) >> PLACES_BEHIND);
			const blue = Math.imul(cbPlace, BLUE_PLACES) >> PLACES_BEHIND;
			const c0 = (y[ySrc] ?? 0) + COLOUR_CENTRE;
			const c1 = (y[ySrc + 1] ?? 0) + COLOUR_CENTRE;
			const c8 = (y[ySrc + 8] ?? 0) + COLOUR_CENTRE;
			const c9 = (y[ySrc + 9] ?? 0) + COLOUR_CENTRE;
			output[dc] = clampJbpColour(c0 + blue);
			output[ac + 1 - stride] = clampJbpColour(c0 - green);
			output[ac + 2 - stride] = clampJbpColour(c0 + red);
			output[ac + COLOURS_PER_PLACE - stride] = clampJbpColour(c1 + blue);
			output[ac + 5 - stride] = clampJbpColour(c1 - green);
			output[ac + 6 - stride] = clampJbpColour(c1 + red);
			output[ac] = clampJbpColour(c8 + blue);
			output[ac + 1] = clampJbpColour(c8 - green);
			output[ac + 2] = clampJbpColour(c8 + red);
			output[ac + COLOURS_PER_PLACE] = clampJbpColour(c9 + blue);
			output[ac + 5] = clampJbpColour(c9 - green);
			output[ac + 6] = clampJbpColour(c9 + red);
			ySrc += PLACES_PER_COLOUR;
			dc += 2 * COLOURS_PER_PLACE;
			ac += 2 * COLOURS_PER_PLACE;
			cbcrSrc += 1;
		}
		dc += stride * 2 - 8 * COLOURS_PER_PLACE;
		ac += stride * 2 - 8 * COLOURS_PER_PLACE;
		ySrc += 8;
		cbcrSrc += 4;
	}
}
