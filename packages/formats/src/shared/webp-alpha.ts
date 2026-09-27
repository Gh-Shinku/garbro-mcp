import { GarbroError } from "@garbro-mcp/core";
import { readVp8lStream } from "./webp-lossless.js";

/** The size of the alpha chunk head (`ALPHA_HEADER_LEN` of libwebp). */
const HEAD_SIZE = 1;

/** The alpha plane is stored as it stands (`ALPHA_NO_COMPRESSION`). */
const NO_COMPRESSION = 0;

/** The alpha plane is stored as a lossless bit stream of its own (`ALPHA_LOSSLESS_COMPRESSION`). */
const LOSSLESS_COMPRESSION = 1;

/** The predictor of the gradient alpha filter (`GradientPredictor` of `src/dsp/filters.c`). */
function predictor(left: number, top: number, topLeft: number): number {
	const value = left + top - topLeft;
	return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** Undoes the alpha filter the chunk names (`WebPUnfilters` of `src/dsp/filters.c`).
 *
 * The first row of the plane stands for the horizontal filter whatever the chunk asks for, because the reference
 * falls back to the horizontal filter whenever there is no row above (its `prev` row is null). */
function unfilter(
	plane: Uint8Array,
	filter: number,
	width: number,
	height: number,
): void {
	if (0 === filter) return;
	for (let row = 0; row < height; row += 1) {
		const at = row * width;
		const above = at - width;
		if (0 === row) {
			let left = 0;
			for (let column = 0; column < width; column += 1) {
				left = ((plane[at + column] ?? 0) + left) & 0xff;
				plane[at + column] = left;
			}
			continue;
		}
		if (1 === filter) {
			let left = plane[above] ?? 0;
			for (let column = 0; column < width; column += 1) {
				left = ((plane[at + column] ?? 0) + left) & 0xff;
				plane[at + column] = left;
			}
			continue;
		}
		if (2 === filter) {
			for (let column = 0; column < width; column += 1)
				plane[at + column] =
					((plane[at + column] ?? 0) + (plane[above + column] ?? 0)) & 0xff;
			continue;
		}
		let top = plane[above] ?? 0;
		let topLeft = top;
		let left = top;
		for (let column = 0; column < width; column += 1) {
			top = plane[above + column] ?? 0;
			left = ((plane[at + column] ?? 0) + predictor(left, top, topLeft)) & 0xff;
			topLeft = top;
			plane[at + column] = left;
		}
	}
}

/** Reads the alpha plane that a lossy picture carries in its own chunk (the `ALPH` chunk; `ALPHInit` and
 * `ALPHDecode` of `src/dec/alpha_dec.c`).
 *
 * The chunk head names the storage of the plane (raw or a lossless bit stream), the alpha filter, the preprocessing
 * of the levels and two reserved bits that must be clear. The lossless storage is a VP8L bit stream with its own
 * five byte head, which `readVp8lPicture` reads; the alpha value of a place of the file is the alpha channel of the
 * decoded ARGB value. `readWebpAlpha` then undoes the filter.
 *
 * The preprocessing flag only tells the decoder that the levels of the plane were quantised when the picture was
 * written. libwebp spreads them again only when the caller asks for alpha dithering, which the reference does not,
 * so this walk leaves the levels as they stand, exactly like the reference library does. */
export function readWebpAlpha(
	chunk: Buffer,
	width: number,
	height: number,
): Uint8Array {
	if (chunk.length <= HEAD_SIZE)
		throw invalid(
			"The places of the file of the colour of the picture of the places of the line stand short of their head of the format",
		);
	const flags = chunk[0] ?? 0;
	const method = flags & 0x03;
	const filter = (flags >> 2) & 0x03;
	const preprocessing = (flags >> 4) & 0x03;
	const reserved = (flags >> 6) & 0x03;
	if (method > LOSSLESS_COMPRESSION || preprocessing > 1 || 0 !== reserved)
		throw invalid(
			"The places of the file of the colour of the picture of the places of the line stand of counts of the head of the format of the picture of the places of the file this walk does not read",
		);
	const plane = new Uint8Array(width * height);
	const data = chunk.subarray(HEAD_SIZE);
	if (NO_COMPRESSION === method) {
		if (data.length < plane.length)
			throw invalid(
				"The places of the file of the colour of the picture of the places of the line stand short of the counts of the places of the file of the picture",
			);
		plane.set(data.subarray(0, plane.length));
	} else {
		// The lossless alpha plane is a lossless bit stream without a head of its own, and libwebp takes the alpha
		// value of a place of the file from the green channel of the decoded pixel (`WebPExtractGreen`: the values of
		// an alpha only stream live in the green plane).
		const pixels = readVp8lStream(data, width, height);
		for (let place = 0; place < plane.length; place += 1)
			plane[place] = ((pixels[place] ?? 0) >>> 8) & 0xff;
	}
	unfilter(plane, filter, width, height);
	return plane;
}

/** The counts of the head of the format of the picture of the web of the picture of the colour of the picture that
 * stand of no counts of the head of the format of the picture of the web of the picture of the web itself. */
function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
