// The counts of the head of the format of the picture of the places of the file of the picture of the format of the
// web of the colour of the places of the picture (VP8): the walk of the counts of the head of the format of the
// picture of the places of the file of the walk of the picture of the format of the picture of the format of four
// places of the file square and of the counts of the head of the format of the picture of the places of the file. The
// walk of this project stands of the walk of the library of the picture of the web (`src/dec/tree_dec.c`:
// `ParseIntraMode`; `src/dec/vp8_dec.c`: `GetCoeffsFast`, `GetLargeValue`, `ParseResiduals`, `VP8DecodeMB`;
// `src/dec/quant_dec.c`: `VP8ParseQuant`; `src/dsp/dec.c`: `TransformWHT_C`; BSD 3-Clause).

import { GarbroError } from "@garbro-mcp/core";
import {
	COEFFICIENT_BANDS,
	FOUR_PLACE_MODE_PROBABILITIES,
	QUANTISER_AC_TABLE,
	QUANTISER_DC_TABLE,
} from "./webp-vp8-tables.js";
import {
	SEGMENT_COUNT,
	type Vp8BooleanDecoder,
	type Vp8PartitionHeader,
	type Vp8Segmentation,
} from "./webp-vp8.js";

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * places of the file square, of the count of the head of the format of the picture of the colour of the picture. */
export const B_DC_PRED = 0;
export const B_TM_PRED = 1;
export const B_VE_PRED = 2;
export const B_HE_PRED = 3;
export const B_RD_PRED = 4;
export const B_VR_PRED = 5;
export const B_LD_PRED = 6;
export const B_VL_PRED = 7;
export const B_HD_PRED = 8;
export const B_HU_PRED = 9;
const DC_PRED = B_DC_PRED;
const V_PRED = B_VE_PRED;
const H_PRED = B_HE_PRED;
const TM_PRED = B_TM_PRED;

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * counts of the places of the file of the picture of the format of four places of the file square (RFC 6386). */
const Y_MODE_TREE = [
	-B_DC_PRED,
	1,
	-B_TM_PRED,
	2,
	-B_VE_PRED,
	3,
	4,
	6,
	-B_HE_PRED,
	5,
	-B_RD_PRED,
	-B_VR_PRED,
	-B_LD_PRED,
	7,
	-B_VL_PRED,
	8,
	-B_HD_PRED,
	-B_HU_PRED,
];

/** The counts of the head of the format of the picture of the places of the file of the picture of the colour of the
 * picture of the picture of the format of the two places of the file. */
const ZIGZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];

/** The counts of the head of the format of the picture of the two places of the file of the counts of the head of the
 * format of the picture of the places of the file of the picture of the format of the two of them. */
const LARGE_VALUES = [
	[173, 148, 140, 0],
	[176, 155, 140, 135, 0],
	[180, 157, 141, 134, 130, 0],
	[254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129, 0],
];

/** The counts of the head of the format of the picture of the colours of the picture of the picture of the format of
 * the places of the file of the walk of the picture of the format of the places of the file square. */
export interface Vp8SegmentQuantiser {
	/** The counts of the head of the format of the picture of the two places of the file of the places of the file of
	 * the picture of the format of the colour of the picture of the picture of the format of four places of the file
	 * square: the count of the head of the format of the picture of the colour standing in front of them and the count
	 * of the head of the format of the picture of the picture of the format of the two places of the file. */
	readonly picture: readonly [number, number];
	/** The counts of the head of the format of the picture of the two places of the file of the places of the file of
	 * the picture of the format of the count of the head of the format of the picture of the format of the two places
	 * of the file. */
	readonly secondOrder: readonly [number, number];
	/** The counts of the head of the format of the picture of the two places of the file of the places of the file of
	 * the picture of the format of the colour of the picture. */
	readonly colour: readonly [number, number];
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * walk of the picture of the format of the places of the file square: the counts of the head of the format of the
 * picture of the places of the file of the picture of the format of four places of the file square standing in front
 * of the picture of the format and the counts of the head of the format of the picture of the places of the file
 * standing of the count of the head of the format itself. */
export interface Vp8MacroblockState {
	readonly topModes: Int32Array;
	readonly leftModes: Int32Array;
	readonly topNonZero: Int32Array;
	readonly topNonZeroDc: Int32Array;
	leftNonZero: number;
	leftNonZeroDc: number;
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * walk of the picture of the format of the places of the file square. */
export interface Vp8MacroblockModes {
	readonly segment: number;
	readonly skip: boolean;
	readonly fourByFour: boolean;
	/** The counts of the head of the format of the picture of the places of the file of the picture of the format of
	 * the picture of the format of four places of the file square, of the count of one place of the file standing of
	 * the count of the head of the format of the picture of the format itself. */
	readonly modes: Uint8Array;
	readonly colourMode: number;
}

/** The counts of the head of the format of the picture of the places of the file of the walk of the picture of the
 * format of the places of the file square. */
export interface Vp8MacroblockCoefficients {
	readonly skipped: boolean;
	readonly secondOrder: Int16Array;
	readonly coefficients: Int16Array;
	readonly nonZeroY: number;
	readonly nonZeroUv: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function clip(value: number, limit: number): number {
	if (value < 0) return 0;
	return value > limit ? limit : value;
}

/** The counts of the head of the format of the picture of the colours of the picture of the picture of the format of
 * the places of the file, one count of the head of the format of the picture of the places of the file of the picture
 * of the format of four places of the file square (the walk of the library of the picture of the web,
 * `VP8ParseQuant`). The count of the head of the format of the picture of the places of the file of the colour of the
 * picture stands of the count of the head of the format of the picture of the places of the file of the picture of the
 * format itself of that walk: the walk of the library of the picture of the web does not walk it of its own. */
export function buildVp8Quantisers(
	header: Vp8PartitionHeader,
): Vp8SegmentQuantiser[] {
	const quantisers: Vp8SegmentQuantiser[] = [];
	for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
		let base = header.quantiser.base;
		if (header.segmentation.use) {
			base = header.segmentation.quantisers[segment] ?? 0;
			if (!header.segmentation.absolute) base += header.quantiser.base;
		} else if (segment > 0) {
			quantisers.push(quantisers[0] as Vp8SegmentQuantiser);
			continue;
		}
		const pictureDc =
			QUANTISER_DC_TABLE[clip(base + header.quantiser.y1dc, 127)] ?? 4;
		const pictureAc = QUANTISER_AC_TABLE[clip(base, 127)] ?? 4;
		const secondOrderDc =
			(QUANTISER_DC_TABLE[clip(base + header.quantiser.y2dc, 127)] ?? 4) * 2;
		let secondOrderAc =
			((QUANTISER_AC_TABLE[clip(base + header.quantiser.y2ac, 127)] ?? 4) *
				101581) >>
			16;
		if (secondOrderAc < 8) secondOrderAc = 8;
		const colourDc =
			QUANTISER_DC_TABLE[clip(base + header.quantiser.uvdc, 117)] ?? 4;
		const colourAc =
			QUANTISER_AC_TABLE[clip(base + header.quantiser.uvac, 127)] ?? 4;
		quantisers.push({
			picture: [pictureDc, pictureAc],
			secondOrder: [secondOrderDc, secondOrderAc],
			colour: [colourDc, colourAc],
		});
	}
	return quantisers;
}

/** Stands the counts of the head of the format of the picture of the places of the file of the picture of the format,
 * of no count of the head of the format of the picture of the places of the file of the picture of the format of the
 * walk of the picture of the format. */
export function createVp8MacroblockState(mbWidth: number): Vp8MacroblockState {
	return {
		topModes: new Int32Array(4 * mbWidth),
		leftModes: new Int32Array(4),
		topNonZero: new Int32Array(mbWidth),
		topNonZeroDc: new Int32Array(mbWidth),
		leftNonZero: 0,
		leftNonZeroDc: 0,
	};
}

/** Resets the left neighbours and the left modes at the start of a macroblock row (`VP8InitScanline`): the values to
 * the left of the first macroblock of a row are the frame border values, not the values left behind by the last
 * macroblock of the row above. */
export function resetVp8Scanline(state: Vp8MacroblockState): void {
	state.leftNonZero = 0;
	state.leftNonZeroDc = 0;
	state.leftModes.fill(B_DC_PRED);
}

/** Reads the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the walk of the picture of the format of the places of the file square of a place of the file of the picture of
 * the format of four places of the file, of the counts of the head of the format of the picture of the places of the
 * file of the picture of the format of the colour of the picture (`ParseIntraMode`). */
export function readVp8MacroblockModes(
	decoder: Vp8BooleanDecoder,
	state: Vp8MacroblockState,
	mbX: number,
	segmentation: Vp8Segmentation,
	useSkipProbability: boolean,
	skipProbability: number,
): Vp8MacroblockModes {
	let segment = 0;
	if (segmentation.updateMap) {
		const tree = segmentation.treeProbabilities;
		segment =
			0 === decoder.read(tree[0] ?? 255)
				? decoder.read(tree[1] ?? 255)
				: decoder.read(tree[2] ?? 255) + 2;
	}
	if (segment >= SEGMENT_COUNT)
		throw invalid(
			"The counts of the head of the format of the picture of the places of the file of the picture of the format of the places of the file square stand of counts of their own",
		);
	const skip = useSkipProbability && 1 === decoder.read(skipProbability);

	const top = state.topModes.subarray(4 * mbX, 4 * mbX + 4);
	const left = state.leftModes;
	const modes = new Uint8Array(16);
	const fourByFour = 0 === decoder.read(145);
	if (!fourByFour) {
		const mode = decoder.read(156)
			? decoder.read(128)
				? TM_PRED
				: H_PRED
			: decoder.read(163)
				? V_PRED
				: DC_PRED;
		modes.fill(mode);
		top.fill(mode);
		left.fill(mode);
	} else {
		for (let y = 0; y < 4; y += 1) {
			let mode: number = left[y] ?? DC_PRED;
			for (let x = 0; x < 4; x += 1) {
				const row = (top[x] ?? DC_PRED) * 10 * 9 + (mode % 10) * 9;
				let index: number =
					Y_MODE_TREE[
						decoder.read(FOUR_PLACE_MODE_PROBABILITIES[row] ?? 128)
					] ?? -B_DC_PRED;
				let depth = 0;
				while (index > 0) {
					index =
						Y_MODE_TREE[
							2 * index +
								decoder.read(FOUR_PLACE_MODE_PROBABILITIES[row + index] ?? 128)
						] ?? -B_DC_PRED;
					depth += 1;
					if (depth > 8)
						throw invalid(
							"The counts of the head of the format of the picture of the places of the file of the picture of the format of the places of the file square stand of counts of their own",
						);
				}
				mode = -index;
				top[x] = mode;
			}
			modes.set(top.subarray(0, 4), 4 * y);
			left[y] = mode;
		}
	}

	const colourMode =
		0 === decoder.read(142)
			? DC_PRED
			: 0 === decoder.read(114)
				? V_PRED
				: 1 === decoder.read(183)
					? TM_PRED
					: H_PRED;
	return { segment, skip, fourByFour, modes, colourMode };
}

/** The counts of the head of the format of the picture of the two places of the file of the count of the head of the
 * format of the picture of the places of the file of the picture of the format of the picture of the format of four
 * places of the file square. */
function coefficient(
	probabilities: Uint8Array,
	kind: number,
	place: number,
	context: number,
	index: number,
): number {
	return (
		probabilities[
			((kind * 8 + (COEFFICIENT_BANDS[place] ?? 0)) * 3 + context) * 11 + index
		] ?? 128
	);
}

/** Reads the counts of the head of the format of the picture of the two places of the file of one place of the file
 * of the picture of the format of four places of the file square (`GetCoeffsFast`, of the counts of the head of the
 * format of the picture of the places of the file of `GetLargeValue`). */
function readCoefficients(
	decoder: Vp8BooleanDecoder,
	probabilities: Uint8Array,
	kind: number,
	context: number,
	quantiser: readonly [number, number],
	start: number,
	out: Int16Array,
	at: number,
): number {
	let place = start;
	let local = context;
	for (; place < 16; place += 1) {
		const row = (index: number): number =>
			coefficient(probabilities, kind, place, local, index);
		if (0 === decoder.read(row(0))) return place;
		while (0 === decoder.read(row(1))) {
			place += 1;
			if (16 === place) return 16;
			local = 0;
		}
		let value: number;
		if (0 === decoder.read(coefficient(probabilities, kind, place, local, 2))) {
			value = 1;
			local = 1;
		} else {
			value = readLargeValue(decoder, (index) =>
				coefficient(probabilities, kind, place, local, index),
			);
			local = 2;
		}
		const magnitude = 0 === decoder.read(128) ? value : -value;
		out[at + (ZIGZAG[place] ?? 0)] =
			magnitude * (place > 0 ? quantiser[1] : quantiser[0]);
	}
	return 16;
}

/** Reads the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the count of the head of the format of the picture of the two places of the file of the places of the file of
 * the picture of the format (`GetLargeValue`). */
function readLargeValue(
	decoder: Vp8BooleanDecoder,
	row: (index: number) => number,
): number {
	if (0 === decoder.read(row(3))) {
		if (0 === decoder.read(row(4))) return 2;
		return 3 + decoder.read(row(5));
	}
	if (0 === decoder.read(row(6))) {
		if (0 === decoder.read(row(7))) return 5 + decoder.read(159);
		return 7 + 2 * decoder.read(165) + decoder.read(145);
	}
	const high = decoder.read(row(8));
	const low = decoder.read(row(9 + high));
	const category = 2 * high + low;
	let value = 0;
	for (const probability of LARGE_VALUES[category] ?? []) {
		if (0 === probability) break;
		value = value + value + decoder.read(probability);
	}
	return value + 3 + (8 << category);
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the count of the head of the format of the picture of the format of the two places of the file into the places
 * of the file of the picture of the format of four places of the file square of the picture of the format of sixteen
 * places of the file square (`TransformWHT_C`; the count of the head of the format of the picture of the places of
 * the file of the picture of the format of no count of the head of the format of the picture of the places of the
 * file of the picture of the format of the format itself stands of the walk of the library of the picture of the
 * web). */
export function walkVp8SecondOrder(
	secondOrder: Int16Array,
	out: Int16Array,
): void {
	const temporary = new Int32Array(16);
	for (let i = 0; i < 4; i += 1) {
		const a0 = (secondOrder[0 + i] ?? 0) + (secondOrder[12 + i] ?? 0);
		const a1 = (secondOrder[4 + i] ?? 0) + (secondOrder[8 + i] ?? 0);
		const a2 = (secondOrder[4 + i] ?? 0) - (secondOrder[8 + i] ?? 0);
		const a3 = (secondOrder[0 + i] ?? 0) - (secondOrder[12 + i] ?? 0);
		temporary[0 + i] = a0 + a1;
		temporary[8 + i] = a0 - a1;
		temporary[4 + i] = a3 + a2;
		temporary[12 + i] = a3 - a2;
	}
	let at = 0;
	for (let i = 0; i < 4; i += 1) {
		const dc = (temporary[0 + i * 4] ?? 0) + 3;
		const a0 = dc + (temporary[3 + i * 4] ?? 0);
		const a1 = (temporary[1 + i * 4] ?? 0) + (temporary[2 + i * 4] ?? 0);
		const a2 = (temporary[1 + i * 4] ?? 0) - (temporary[2 + i * 4] ?? 0);
		const a3 = dc - (temporary[3 + i * 4] ?? 0);
		out[at] = (a0 + a1) >> 3;
		out[at + 16] = (a3 + a2) >> 3;
		out[at + 32] = (a0 - a1) >> 3;
		out[at + 48] = (a3 - a2) >> 3;
		at += 64;
	}
}

/** Reads the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the picture of the format of four places of the file square (`ParseResiduals`, of the counts of the head of the
 * format of the picture of the places of the file of `VP8DecodeMB`: a place of the file of the picture of the format
 * whose counts of the head of the format of the picture of the places of the file stand of their own stands of no
 * walk of the counts of the head of the format of the picture of the places of the file of the picture of the format
 * itself, and the counts of the head of the format of the picture of the places of the file of the picture of the
 * format of the colour of the picture and of the picture of the format of four places of the file square are kept for
 * the picture of the format standing next to them). */
export function readVp8MacroblockResiduals(
	decoder: Vp8BooleanDecoder,
	state: Vp8MacroblockState,
	mbX: number,
	modes: Vp8MacroblockModes,
	quantiser: Vp8SegmentQuantiser,
	probabilities: Uint8Array,
): Vp8MacroblockCoefficients {
	const secondOrder = new Int16Array(16);
	const coefficients = new Int16Array(384);
	const skip = modes.skip;
	if (skip) {
		state.topNonZero[mbX] = 0;
		state.leftNonZero = 0;
		if (!modes.fourByFour) {
			state.topNonZeroDc[mbX] = 0;
			state.leftNonZeroDc = 0;
		}
		return {
			skipped: true,
			secondOrder,
			coefficients,
			nonZeroY: 0,
			nonZeroUv: 0,
		};
	}

	const first = modes.fourByFour ? 0 : 1;
	if (!modes.fourByFour) {
		const context = (state.topNonZeroDc[mbX] ?? 0) + state.leftNonZeroDc;
		const count = readCoefficients(
			decoder,
			probabilities,
			1,
			context,
			quantiser.secondOrder,
			0,
			secondOrder,
			0,
		);
		const nonzero = count > 0 ? 1 : 0;
		state.topNonZeroDc[mbX] = nonzero;
		state.leftNonZeroDc = nonzero;
		if (count > 1) {
			walkVp8SecondOrder(secondOrder, coefficients);
		} else {
			const dc = ((secondOrder[0] ?? 0) + 3) >> 3;
			for (let i = 0; i < 256; i += 16) coefficients[i] = dc;
		}
	}

	const kind = modes.fourByFour ? 3 : 0;
	// The counts of the head of the format of the picture of the places of the file of the picture of the format of
	// the picture of the format standing in front of the picture of the format stand of the counts of the head of the
	// format of the picture of the places of the file of the picture of the format of the pictures of the format
	// themselves, and the walk of this project stands of the counts of the head of the format of the picture of the
	// places of the file of the picture of the format of the picture of the format of the picture of the format
	// standing next to it of its own: the count of the head of the format of the picture of the places of the file of
	// the picture of the format of the picture of the format itself stands of the count of the head of the format of
	// the picture of the places of the file of the picture of the format of the picture of the format standing in
	// front of it (the walk of the library of the picture of the web stands of one count of the head of the format of
	// the picture of the places of the file of the picture of the format for the two of them).
	let tnz = (state.topNonZero[mbX] ?? 0) & 0x0f;
	const left = state.leftNonZero;
	let lnz = left & 0x0f;
	let nonZeroY = 0;
	for (let y = 0; y < 4; y += 1) {
		let l = lnz & 1;
		let codes = 0;
		for (let x = 0; x < 4; x += 1) {
			const context = l + (tnz & 1);
			const at = 16 * (4 * y + x);
			const count = readCoefficients(
				decoder,
				probabilities,
				kind,
				context,
				quantiser.picture,
				first,
				coefficients,
				at,
			);
			l = count > first ? 1 : 0;
			tnz = (tnz >> 1) | (l << 7);
			codes =
				((codes << 2) |
					(count > 3 ? 3 : count > 1 ? 2 : 0 !== coefficients[at] ? 1 : 0)) >>>
				0;
		}
		tnz >>= 4;
		lnz = (lnz >> 1) | (l << 7);
		nonZeroY = ((nonZeroY << 8) | codes) >>> 0;
	}
	const topNonZero = tnz;
	const leftNonZero = lnz >> 4;

	let nonZeroUv = 0;
	let topColour = 0;
	let leftColour = 0;
	for (let channel = 0; channel < 4; channel += 2) {
		let codes = 0;
		let t = (state.topNonZero[mbX] ?? 0) >> (4 + channel);
		let l = state.leftNonZero >> (4 + channel);
		for (let y = 0; y < 2; y += 1) {
			let local = l & 1;
			for (let x = 0; x < 2; x += 1) {
				// The counts of the head of the format of the picture of the places of the file of the picture of the
				// colour of the picture stand of the places of the file of the picture of the format of the two places of
				// the file of the places of the file: the counts of the head of the format of the picture of the places of
				// the file of the picture of the format of the colour of the picture stand of the count of the head of
				// the format of the picture of the places of the file of the picture of the format of the colour of the
				// picture of the count of the head of the format itself.
				const at = 256 + 16 * ((channel >> 1) * 4 + 2 * y + x);
				const count = readCoefficients(
					decoder,
					probabilities,
					2,
					local + (t & 1),
					quantiser.colour,
					0,
					coefficients,
					at,
				);
				local = count > 0 ? 1 : 0;
				t = (t >> 1) | (local << 3);
				codes =
					((codes << 2) |
						(count > 3
							? 3
							: count > 1
								? 2
								: 0 !== coefficients[at]
									? 1
									: 0)) >>>
					0;
			}
			t >>= 2;
			l = (l >> 1) | (local << 5);
		}
		nonZeroUv |= codes << (4 * channel);
		topColour |= (t << 4) << channel;
		leftColour |= (l & 0xf0) << channel;
	}
	state.topNonZero[mbX] = topColour | (topNonZero & 0x0f);
	state.leftNonZero = leftColour | (leftNonZero & 0x0f);
	return {
		skipped: false,
		secondOrder,
		coefficients,
		nonZeroY,
		nonZeroUv,
	};
}
