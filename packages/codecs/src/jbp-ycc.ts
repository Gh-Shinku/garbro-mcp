// Format reference: GARbro "ArcFormats/Cmvs/ImagePB3.cs", the walk of the places of a picture inside
// `JbpReader.Ycc2Rgb`, which stands the places of the colours of a picture beside the places of the picture
// itself. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** Every place of a picture of this kind stands as the places of the colours of the picture beside the places
 * of the kinds of the picture that stand for the places of the colours, which stand as the places of three
 * colours apiece. */
const COLOURS_PER_PLACE = 4;
/** Every place of the picture stands as the places of the colours of the picture without the places of the
 * kind of the picture, which stand as the places of the picture itself. */
const PLACES_PER_ROW = 4;
const PLACES_PER_COLOUR = 2;
/** The places the walk stands the places of the colours of the picture with. */
const RED_PLACES = 0x166f0;
const GREEN_BLUE = 0x5810;
const GREEN_RED = 0xb6c0;
const BLUE_PLACES = 0x1c590;
const PLACES_BEHIND = 16;
/** The place every place of a picture of this kind stands behind, so that the places of the colours of the
 * picture stand beside the places of the picture itself. */
const COLOUR_CENTRE = 0x180;
/** The places of the file stand for the places of the colours of the picture as the places of one place of a
 * byte, so a place of a colour that stands below the lowest place of a colour stands as the lowest place of a
 * colour and one that stands above the highest stands as the highest. */
const LOWEST_COLOUR = 0x100;
const HIGHEST_COLOUR = 0x200;
const LOWEST_PLACE = 0;
const HIGHEST_PLACE = 0xff;

/** `JbpReader.Clamp`: the places of a picture of this kind stand as the places of a colour of the picture
 * itself, which stand as the places of one place of a byte behind the places of the colour. */
export function clampJbpColour(value: number): number {
	if (value < LOWEST_COLOUR) return LOWEST_PLACE;
	if (value >= HIGHEST_COLOUR) return HIGHEST_PLACE;
	return value - LOWEST_COLOUR;
}

/** How the places of a picture of this kind stand, and which of the places of the walk of the places of the
 * colours of the picture every place of the picture stands for. */
export interface JbpColourOptions {
	/** The places of the picture, which stand as the places of four colours apiece. */
	output: Buffer;
	/** How many places of the picture stand in a row of them. */
	stride: number;
	/** Where the places of the picture of the first kind of the row stand. */
	dc: number;
	/** Where the places of the picture of the second kind of the row stand. */
	ac: number;
	y: Int16Array;
	cb: Int16Array;
	cr: Int16Array;
	cbcrSrc: number;
	/** Where the places of the picture of the kind of the picture itself stand in the walk of those places. */
	ySrc?: number;
}

/**
 * `JbpReader.Ycc2Rgb`: the places of the colours of a picture stand beside the places of the picture itself,
 * every place of the picture of the first kind standing for the places of the colours of the places of the
 * picture of the two kinds of the row, and the places of the colours standing for the places of the picture of
 * the kinds of the picture itself that stand in the walk of those places.
 */
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
			// The places of the picture stand as the places of the colours of the picture beside the places of
			// the picture itself: every place of the picture of the first kind stands as the places of the
			// colours of the picture that stand before the places of the picture itself, and every place of the
			// picture of the second kind stands as the places of the picture itself.
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
