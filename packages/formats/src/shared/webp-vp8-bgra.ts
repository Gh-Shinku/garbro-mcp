import type { Vp8Picture } from "./webp-vp8-picture.js";

/** The fixed point places of the colour walk of libwebp (`YUV_FIX2` and `YUV_MASK2` of `src/dsp/yuv.h`). */
const COLOUR_PLACES = 6;

/** The mask of the samples that fit in the fixed point range. */
const COLOUR_MASK = (256 << COLOUR_PLACES) - 1;

/** The high multiply of the colour walk (`MultHi` of `src/dsp/yuv.h`). */
function multiplyHigh(value: number, coefficient: number): number {
	return (value * coefficient) >> 8;
}

/** Clips a fixed point sample to a byte (`VP8Clip8` of `src/dsp/yuv.h`). */
function clipColour(value: number): number {
	if (0 === (value & ~COLOUR_MASK)) return value >> COLOUR_PLACES;
	return value < 0 ? 0 : 255;
}

/** The red channel of a sample (`VP8YUVToR`). */
function toRed(luma: number, colour: number): number {
	return clipColour(
		multiplyHigh(luma, 19077) + multiplyHigh(colour, 26149) - 14234,
	);
}

/** The green channel of a sample (`VP8YUVToG`). */
function toGreen(luma: number, u: number, v: number): number {
	return clipColour(
		multiplyHigh(luma, 19077) -
			multiplyHigh(u, 6419) -
			multiplyHigh(v, 13320) +
			8708,
	);
}

/** The blue channel of a sample (`VP8YUVToB`). */
function toBlue(luma: number, u: number): number {
	return clipColour(multiplyHigh(luma, 19077) + multiplyHigh(u, 33050) - 17685);
}

/** Everything the chroma upsampling walk reads: the planes of the picture, the width and the destination. */
interface ColourPair {
	readonly u: Uint8Array;
	readonly v: Uint8Array;
	readonly uvStride: number;
	readonly out: Buffer;
	readonly width: number;
	readonly luma: Uint8Array;
}

/** Packs the two chroma samples of one place into one count (`LOAD_UV`). */
function loadColour(pair: ColourPair, row: number, column: number): number {
	const at = row * pair.uvStride + column;
	return (pair.u[at] ?? 0) | ((pair.v[at] ?? 0) << 16);
}

/** Writes one BGRA place of the file from its luma sample and its packed chroma samples (`VP8YuvToBgra`). */
function keepColour(
	pair: ColourPair,
	row: number,
	column: number,
	colour: number,
): void {
	const luma = pair.luma[row * pair.width + column] ?? 0;
	const u = colour & 0xff;
	const v = (colour >>> 16) & 0xff;
	const at = (row * pair.width + column) * 4;
	pair.out[at] = toBlue(luma, u);
	pair.out[at + 1] = toGreen(luma, u, v);
	pair.out[at + 2] = toRed(luma, v);
	pair.out[at + 3] = 255;
}

/** Writes one pair of output rows from two neighbouring chroma rows (`UpsampleBgraLinePair` of libwebp).
 *
 * The two chroma rows stand for a square of four chroma places and the four output places of the file inside it are
 * the `([9a+3b+3c+d, 3a+9b+3c+d; 3a+b+9c+3d, a+3b+3c+9d] + [8 8]) / 16` interpolations of the reference, walked on the
 * packed chroma counts. */
function walkColourPair(
	pair: ColourPair,
	topRow: number,
	bottomRow: number | undefined,
	topChroma: number,
	curChroma: number,
): void {
	const { width } = pair;
	const lastPlace = (width - 1) >> 1;
	let top = loadColour(pair, topChroma, 0);
	let left = loadColour(pair, curChroma, 0);
	keepColour(pair, topRow, 0, (3 * top + left + 0x00020002) >>> 2);
	if (undefined !== bottomRow)
		keepColour(pair, bottomRow, 0, (3 * left + top + 0x00020002) >>> 2);
	for (let column = 1; column <= lastPlace; column += 1) {
		const above = loadColour(pair, topChroma, column);
		const colour = loadColour(pair, curChroma, column);
		const average = (top + above + left + colour + 0x00080008) >>> 0;
		const first = (average + 2 * (above + left)) >>> 3;
		const second = (average + 2 * (top + colour)) >>> 3;
		keepColour(pair, topRow, 2 * column - 1, (first + top) >>> 1);
		keepColour(pair, topRow, 2 * column, (second + above) >>> 1);
		if (undefined !== bottomRow) {
			keepColour(pair, bottomRow, 2 * column - 1, (second + left) >>> 1);
			keepColour(pair, bottomRow, 2 * column, (first + colour) >>> 1);
		}
		top = above;
		left = colour;
	}
	if (0 === (width & 1)) {
		keepColour(pair, topRow, width - 1, (3 * top + left + 0x00020002) >>> 2);
		if (undefined !== bottomRow)
			keepColour(
				pair,
				bottomRow,
				width - 1,
				(3 * left + top + 0x00020002) >>> 2,
			);
	}
}

/** Converts the planes of a lossy picture to BGRA, the way the reference asks libwebp for them
 * (`WebPDecodeBGRAInto`).
 *
 * The two chroma planes are upsampled with the fancy walk of the reference (`UpsampleBgraLinePair`) and every place
 * of the file is converted with the fixed point BT.601 rules of `src/dsp/yuv.h`. A picture without an alpha plane
 * gets an opaque alpha channel, which is what the reference library writes as well. */
export function walkVp8Bgra(picture: Vp8Picture): Buffer {
	const { width, height, y, u, v } = picture;
	const out = Buffer.alloc(width * height * 4);
	if (0 === width || 0 === height) return out;
	const pair: ColourPair = {
		u,
		v,
		uvStride: Math.ceil(width / 2),
		out,
		width,
		luma: y,
	};
	// The first row mirrors the first chroma row, as the reference does (`EmitFancyRGB`).
	walkColourPair(pair, 0, undefined, 0, 0);
	for (let row = 0; row + 2 < height; row += 2)
		walkColourPair(pair, row + 1, row + 2, row >> 1, (row >> 1) + 1);
	if (0 === (height & 1)) {
		const last = (height >> 1) - 1;
		walkColourPair(pair, height - 1, undefined, last, last);
	}
	return out;
}
