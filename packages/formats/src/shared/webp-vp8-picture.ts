// The counts of the head of the format of the picture of the colour of the places of the picture of the web of the
// colour of the places of the picture (VP8): the walk of the counts of the head of the format of the picture of the
// places of the file of the picture of the format of the picture of the format of four places of the file square, of
// the places of the file of the picture of the format of sixteen places of the file square and of the places of the
// file of the picture of the format of the colour of the picture, of the counts of the head of the format of the
// picture of the places of the file of the picture of the format of the picture and of the walk of the places of the
// file of the picture of the format. The walk of this project stands of the walk of the library of the picture of the
// web (`src/dsp/dec.c`: the counts of the head of the format of the picture of the places of the file of the picture
// of the format of four places of the file square and of the colour of the picture, `TransformOne_C`,
// `TransformAC3_C`, `TransformDC_C`, `TransformUV_C`, `TransformDCUV_C`, of the counts of the head of the format of
// the picture of the places of the file of `src/dsp/dsp.h`; `src/dec/frame_dec.c`: `CheckMode`, `kScan`,
// `DoTransform`, `DoUVTransform`, `ReconstructRow`; BSD 3-Clause).

import { GarbroError } from "@garbro-mcp/core";
import {
	B_DC_PRED,
	B_HD_PRED,
	B_HE_PRED,
	B_HU_PRED,
	B_LD_PRED,
	B_RD_PRED,
	B_TM_PRED,
	B_VE_PRED,
	B_VL_PRED,
	B_VR_PRED,
	buildVp8Quantisers,
	createVp8MacroblockState,
	resetVp8Scanline,
	type Vp8MacroblockCoefficients,
	type Vp8MacroblockModes,
	type Vp8MacroblockState,
	readVp8MacroblockModes,
	readVp8MacroblockResiduals,
} from "./webp-vp8-macroblock.js";
import {
	readVp8FrameHeader,
	readVp8PartitionHeader,
	Vp8BooleanDecoder,
} from "./webp-vp8.js";

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * places of the file square of a count of the head of the format of the picture of the places of the file, of the
 * counts of the head of the format of the picture of the places of the file of the picture of the format of the count
 * of the head of the format of the picture of the format of the picture of the format of the places of the file square
 * (the walk of the library of the picture of the web keeps the counts of the head of the format of the picture of the
 * places of the file of its own step, of the counts of the head of the format of the picture of the places of the file
 * of the picture of the format of the place of the length of the picture of the format itself of that walk; the walk
 * of this project stands of the count of the head of the format of the picture of the places of the file of the
 * picture of the format of the places of the file of the picture of the format itself). */
function fourPlaceOrigin(
	block: number,
	rowOrigin: number,
	stride: number,
): number {
	return rowOrigin + (block >> 2) * 4 * stride + (block & 3) * 4;
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * colour of the picture and of the colour of the picture of the other, of the counts of the head of the format of the
 * picture of the places of the file of the picture of the format of the picture of the colour of the picture. */
export interface Vp8Picture {
	readonly width: number;
	readonly height: number;
	readonly y: Uint8Array;
	readonly u: Uint8Array;
	readonly v: Uint8Array;
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * two places of the file of the picture of the format (the counts of the head of the format of the picture of the
 * places of the file of the picture of the format of the picture of the format of the two places of the file). */
const AC3_MULTIPLIER = 20091;
const AC3_MULTIPLIER_TWO = 35468;

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

function clip(value: number): number {
	if (value < 0) return 0;
	return value > 255 ? 255 : value;
}

function average3(a: number, b: number, c: number): number {
	return (a + 2 * b + c + 2) >> 2;
}

function average2(a: number, b: number): number {
	return (a + b + 1) >> 1;
}

/** Stands the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the colour of the picture of the count of the head of the format of the picture of the format of the picture of
 * the format of four places of the file square and of the picture of the format of sixteen places of the file square
 * (`VP8PredLuma16`, `VP8PredChroma8`, of the counts of the head of the format of the picture of the places of the
 * file of the picture of the format of the picture of the format of the colour of the picture). */
function predictBig(
	plane: Uint8Array,
	stride: number,
	origin: number,
	mode: number,
	noTop: boolean,
	noLeft: boolean,
	size: number,
): void {
	if (B_VE_PRED === mode) {
		for (let y = 0; y < size; y += 1)
			for (let x = 0; x < size; x += 1)
				plane[origin + y * stride + x] = plane[origin - stride + x] ?? 0;
		return;
	}
	if (B_HE_PRED === mode) {
		for (let y = 0; y < size; y += 1)
			for (let x = 0; x < size; x += 1)
				plane[origin + y * stride + x] = plane[origin + y * stride - 1] ?? 0;
		return;
	}
	if (B_TM_PRED === mode) {
		const corner = plane[origin - stride - 1] ?? 0;
		for (let y = 0; y < size; y += 1)
			for (let x = 0; x < size; x += 1) {
				const left = plane[origin + y * stride - 1] ?? 0;
				const top = plane[origin - stride + x] ?? 0;
				plane[origin + y * stride + x] = clip(top + left - corner);
			}
		return;
	}
	let weighted = 0;
	let samples = 0;
	if (!noTop) {
		for (let x = 0; x < size; x += 1)
			weighted += plane[origin - stride + x] ?? 0;
		samples += size;
	}
	if (!noLeft) {
		for (let y = 0; y < size; y += 1)
			weighted += plane[origin + y * stride - 1] ?? 0;
		samples += size;
	}
	if (0 === samples) {
		for (let y = 0; y < size; y += 1)
			for (let x = 0; x < size; x += 1) plane[origin + y * stride + x] = 128;
		return;
	}
	const divisor =
		16 === size ? (32 === samples ? 5 : 4) : 16 === samples ? 4 : 3;
	const value = (weighted + (samples >> 1)) >> divisor;
	for (let y = 0; y < size; y += 1)
		for (let x = 0; x < size; x += 1) plane[origin + y * stride + x] = value;
}

/** Stands the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the places of the file square (`VP8PredLuma4`), of the counts of the head of the format of the picture of the
 * places of the file of the picture of the format of the picture of the format of four places of the file standing of
 * the count of the head of the format of the picture of the format. */
function predictFour(
	plane: Uint8Array,
	stride: number,
	origin: number,
	mode: number,
): void {
	const top = (index: number): number => plane[origin - stride + index] ?? 0;
	const left = (index: number): number =>
		plane[origin + index * stride - 1] ?? 0;
	const corner = top(-1);
	const set = (x: number, y: number, value: number): void => {
		plane[origin + y * stride + x] = value;
	};
	if (B_DC_PRED === mode) {
		let sum = 4;
		for (let i = 0; i < 4; i += 1) sum += top(i) + left(i);
		const value = sum >> 3;
		for (let y = 0; y < 4; y += 1)
			for (let x = 0; x < 4; x += 1) set(x, y, value);
		return;
	}
	if (B_TM_PRED === mode) {
		for (let y = 0; y < 4; y += 1)
			for (let x = 0; x < 4; x += 1) set(x, y, clip(top(x) + left(y) - corner));
		return;
	}
	if (B_VE_PRED === mode) {
		const values = [
			average3(top(-1), top(0), top(1)),
			average3(top(0), top(1), top(2)),
			average3(top(1), top(2), top(3)),
			average3(top(2), top(3), top(4)),
		];
		for (let y = 0; y < 4; y += 1)
			for (let x = 0; x < 4; x += 1) set(x, y, values[x] ?? 0);
		return;
	}
	if (B_HE_PRED === mode) {
		const a = corner;
		const b = left(0);
		const c = left(1);
		const d = left(2);
		const e = left(3);
		const values = [
			average3(a, b, c),
			average3(b, c, d),
			average3(c, d, e),
			average3(d, e, e),
		];
		for (let y = 0; y < 4; y += 1)
			for (let x = 0; x < 4; x += 1) set(x, y, values[y] ?? 0);
		return;
	}
	if (B_RD_PRED === mode) {
		const i = left(0);
		const j = left(1);
		const k = left(2);
		const l = left(3);
		const x = corner;
		const a = top(0);
		const b = top(1);
		const c = top(2);
		const d = top(3);
		set(0, 3, average3(j, k, l));
		set(1, 3, average3(i, j, k));
		set(0, 2, average3(i, j, k));
		set(2, 3, average3(x, i, j));
		set(1, 2, average3(x, i, j));
		set(0, 1, average3(x, i, j));
		set(3, 3, average3(a, x, i));
		set(2, 2, average3(a, x, i));
		set(1, 1, average3(a, x, i));
		set(0, 0, average3(a, x, i));
		set(3, 2, average3(b, a, x));
		set(2, 1, average3(b, a, x));
		set(1, 0, average3(b, a, x));
		set(3, 1, average3(c, b, a));
		set(2, 0, average3(c, b, a));
		set(3, 0, average3(d, c, b));
		return;
	}
	if (B_VR_PRED === mode) {
		const i = left(0);
		const j = left(1);
		const k = left(2);
		const x = corner;
		const a = top(0);
		const b = top(1);
		const c = top(2);
		const d = top(3);
		set(0, 0, average2(x, a));
		set(1, 2, average2(x, a));
		set(1, 0, average2(a, b));
		set(2, 2, average2(a, b));
		set(2, 0, average2(b, c));
		set(3, 2, average2(b, c));
		set(3, 0, average2(c, d));
		set(0, 3, average3(k, j, i));
		set(0, 2, average3(j, i, x));
		set(0, 1, average3(i, x, a));
		set(1, 3, average3(i, x, a));
		set(1, 1, average3(x, a, b));
		set(2, 3, average3(x, a, b));
		set(2, 1, average3(a, b, c));
		set(3, 3, average3(a, b, c));
		set(3, 1, average3(b, c, d));
		return;
	}
	if (B_LD_PRED === mode) {
		const values = [
			top(0),
			top(1),
			top(2),
			top(3),
			top(4),
			top(5),
			top(6),
			top(7),
		];
		set(0, 0, average3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0));
		set(1, 0, average3(values[1] ?? 0, values[2] ?? 0, values[3] ?? 0));
		set(0, 1, average3(values[1] ?? 0, values[2] ?? 0, values[3] ?? 0));
		set(2, 0, average3(values[2] ?? 0, values[3] ?? 0, values[4] ?? 0));
		set(1, 1, average3(values[2] ?? 0, values[3] ?? 0, values[4] ?? 0));
		set(0, 2, average3(values[2] ?? 0, values[3] ?? 0, values[4] ?? 0));
		set(3, 0, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(2, 1, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(1, 2, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(0, 3, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(3, 1, average3(values[4] ?? 0, values[5] ?? 0, values[6] ?? 0));
		set(2, 2, average3(values[4] ?? 0, values[5] ?? 0, values[6] ?? 0));
		set(1, 3, average3(values[4] ?? 0, values[5] ?? 0, values[6] ?? 0));
		set(3, 2, average3(values[5] ?? 0, values[6] ?? 0, values[7] ?? 0));
		set(2, 3, average3(values[5] ?? 0, values[6] ?? 0, values[7] ?? 0));
		set(3, 3, average3(values[6] ?? 0, values[7] ?? 0, values[7] ?? 0));
		return;
	}
	if (B_VL_PRED === mode) {
		const values = [
			top(0),
			top(1),
			top(2),
			top(3),
			top(4),
			top(5),
			top(6),
			top(7),
		];
		set(0, 0, average2(values[0] ?? 0, values[1] ?? 0));
		set(1, 0, average2(values[1] ?? 0, values[2] ?? 0));
		set(0, 2, average2(values[1] ?? 0, values[2] ?? 0));
		set(2, 0, average2(values[2] ?? 0, values[3] ?? 0));
		set(1, 2, average2(values[2] ?? 0, values[3] ?? 0));
		set(3, 0, average2(values[3] ?? 0, values[4] ?? 0));
		set(2, 2, average2(values[3] ?? 0, values[4] ?? 0));
		set(0, 1, average3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0));
		set(1, 1, average3(values[1] ?? 0, values[2] ?? 0, values[3] ?? 0));
		set(0, 3, average3(values[1] ?? 0, values[2] ?? 0, values[3] ?? 0));
		set(2, 1, average3(values[2] ?? 0, values[3] ?? 0, values[4] ?? 0));
		set(1, 3, average3(values[2] ?? 0, values[3] ?? 0, values[4] ?? 0));
		set(3, 1, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(2, 3, average3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0));
		set(3, 2, average3(values[4] ?? 0, values[5] ?? 0, values[6] ?? 0));
		set(3, 3, average3(values[5] ?? 0, values[6] ?? 0, values[7] ?? 0));
		return;
	}
	if (B_HD_PRED === mode) {
		const i = left(0);
		const j = left(1);
		const k = left(2);
		const l = left(3);
		const x = corner;
		const a = top(0);
		const b = top(1);
		const c = top(2);
		set(0, 0, average2(i, x));
		set(2, 1, average2(i, x));
		set(0, 1, average2(j, i));
		set(2, 2, average2(j, i));
		set(0, 2, average2(k, j));
		set(2, 3, average2(k, j));
		set(0, 3, average2(l, k));
		set(3, 0, average3(a, b, c));
		set(2, 0, average3(x, a, b));
		set(1, 0, average3(i, x, a));
		set(3, 1, average3(i, x, a));
		set(1, 1, average3(j, i, x));
		set(3, 2, average3(j, i, x));
		set(1, 2, average3(k, j, i));
		set(3, 3, average3(k, j, i));
		set(1, 3, average3(l, k, j));
		return;
	}
	if (B_HU_PRED === mode) {
		const i = left(0);
		const j = left(1);
		const k = left(2);
		const l = left(3);
		set(0, 0, average2(i, j));
		set(2, 0, average2(j, k));
		set(0, 1, average2(j, k));
		set(2, 1, average2(k, l));
		set(0, 2, average2(k, l));
		set(1, 0, average3(i, j, k));
		set(3, 0, average3(j, k, l));
		set(1, 1, average3(j, k, l));
		set(3, 1, average3(k, l, l));
		set(1, 2, average3(k, l, l));
		set(3, 2, l);
		set(2, 2, l);
		set(0, 3, l);
		set(1, 3, l);
		set(2, 3, l);
		set(3, 3, l);
		return;
	}
	throw invalid(
		"The counts of the head of the format of the picture of the places of the file of the picture of the format of the places of the file square stand of counts of their own",
	);
}

function ac3MulOne(value: number): number {
	return ((value * AC3_MULTIPLIER) >> 16) + value;
}

function ac3MulTwo(value: number): number {
	return (value * AC3_MULTIPLIER_TWO) >> 16;
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the counts of the head of the format of the picture of the format of four places of the file square into the
 * places of the file of the picture of the format, of the counts of the head of the format of the picture of the
 * places of the file of the picture of the format standing in front of them (`TransformOne_C`, of the counts of the
 * head of the format of the picture of the places of the file of the picture of the format of the picture of the
 * format of four places of the file square standing of the count of the head of the format of the picture of the
 * format of the two of them). */
function transformOne(
	inAt: number,
	coefficients: Int16Array,
	plane: Uint8Array,
	stride: number,
	origin: number,
	doTwo: boolean,
): void {
	for (let half = 0; half < (doTwo ? 2 : 1); half += 1) {
		const input = inAt + 16 * half;
		const at = origin + 4 * half;
		const temporary = new Int32Array(16);
		for (let i = 0; i < 4; i += 1) {
			const a =
				(coefficients[input + i] ?? 0) + (coefficients[input + 8 + i] ?? 0);
			const b =
				(coefficients[input + i] ?? 0) - (coefficients[input + 8 + i] ?? 0);
			const c =
				ac3MulTwo(coefficients[input + 4 + i] ?? 0) -
				ac3MulOne(coefficients[input + 12 + i] ?? 0);
			const d =
				ac3MulOne(coefficients[input + 4 + i] ?? 0) +
				ac3MulTwo(coefficients[input + 12 + i] ?? 0);
			temporary[4 * i + 0] = a + d;
			temporary[4 * i + 1] = b + c;
			temporary[4 * i + 2] = b - c;
			temporary[4 * i + 3] = a - d;
		}
		for (let i = 0; i < 4; i += 1) {
			const dc = (temporary[i] ?? 0) + 4;
			const a = dc + (temporary[8 + i] ?? 0);
			const b = dc - (temporary[8 + i] ?? 0);
			const c =
				ac3MulTwo(temporary[4 + i] ?? 0) - ac3MulOne(temporary[12 + i] ?? 0);
			const d =
				ac3MulOne(temporary[4 + i] ?? 0) + ac3MulTwo(temporary[12 + i] ?? 0);
			const store = (x: number, value: number): void => {
				const index = at + i * stride + x;
				plane[index] = clip((plane[index] ?? 0) + (value >> 3));
			};
			store(0, a + d);
			store(1, b + c);
			store(2, b - c);
			store(3, a - d);
		}
	}
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the count of the head of the format of the picture of the format of four places of the file square of the picture
 * of the format of the count of the head of the format of the picture of the places of the file of the picture of the
 * format of the two of them (`TransformAC3_C`). */
function transformAc3(
	inAt: number,
	coefficients: Int16Array,
	plane: Uint8Array,
	stride: number,
	origin: number,
): void {
	const a = (coefficients[inAt + 0] ?? 0) + 4;
	const c4 = ac3MulTwo(coefficients[inAt + 4] ?? 0);
	const d4 = ac3MulOne(coefficients[inAt + 4] ?? 0);
	const c1 = ac3MulTwo(coefficients[inAt + 1] ?? 0);
	const d1 = ac3MulOne(coefficients[inAt + 1] ?? 0);
	const rows = [a + d4, a + c4, a - c4, a - d4];
	for (let y = 0; y < 4; y += 1) {
		const dc = rows[y] ?? 0;
		const values = [dc + d1, dc + c1, dc - c1, dc - d1];
		for (let x = 0; x < 4; x += 1)
			plane[origin + y * stride + x] = clip(
				(plane[origin + y * stride + x] ?? 0) + ((values[x] ?? 0) >> 3),
			);
	}
}

/** Walks the count of the head of the format of the picture of the colour of the picture of the picture of the format
 * of four places of the file square into the places of the file of the picture of the format (`TransformDC_C`). */
function transformDc(
	inAt: number,
	coefficients: Int16Array,
	plane: Uint8Array,
	stride: number,
	origin: number,
): void {
	const dc = (coefficients[inAt] ?? 0) + 4;
	for (let y = 0; y < 4; y += 1)
		for (let x = 0; x < 4; x += 1)
			plane[origin + y * stride + x] = clip(
				(plane[origin + y * stride + x] ?? 0) + (dc >> 3),
			);
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the counts of the head of the format of the picture of the format of four places of the file square of the
 * picture of the format of the count of the head of the format of the picture of the places of the file of the picture
 * of the format of the two of them (`DoTransform`). */
function doTransform(
	bits: number,
	coefficients: Int16Array,
	inAt: number,
	plane: Uint8Array,
	stride: number,
	origin: number,
): void {
	const kind = bits >>> 30;
	if (3 === kind)
		transformOne(inAt, coefficients, plane, stride, origin, false);
	else if (2 === kind) transformAc3(inAt, coefficients, plane, stride, origin);
	else if (1 === kind) transformDc(inAt, coefficients, plane, stride, origin);
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of the places of the file of the picture of the format of the colour of the picture (`DoUVTransform`). */
function doUvTransform(
	bits: number,
	coefficients: Int16Array,
	inAt: number,
	plane: Uint8Array,
	stride: number,
	origin: number,
): void {
	if (0 === (bits & 0xff)) return;
	if (0 !== (bits & 0xaa)) {
		transformOne(inAt, coefficients, plane, stride, origin, true);
		transformOne(
			inAt + 32,
			coefficients,
			plane,
			stride,
			origin + 4 * stride,
			true,
		);
		return;
	}
	for (let block = 0; block < 4; block += 1) {
		if (0 === (coefficients[inAt + 16 * block] ?? 0)) continue;
		transformDc(
			inAt + 16 * block,
			coefficients,
			plane,
			stride,
			origin + (block >> 1) * 4 * stride + (block & 1) * 4,
		);
	}
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * places of the file of the picture of the format of the colour of the picture, of the counts of the head of the
 * format of the picture of the places of the file of the picture of the format of the picture of the format of the
 * colour of the picture. */
function predictColourMode(
	mode: number,
	noTop: boolean,
	noLeft: boolean,
): number {
	if (B_DC_PRED !== mode) return mode;
	if (noTop && noLeft) return 6;
	if (noTop) return 4;
	if (noLeft) return 5;
	return mode;
}

/** Reads the places of the file of the picture of the format of the colour of the places of the picture of the web of
 * the colour of the places of the picture (VP8) of a picture of the format of the picture of the format itself.
 *
 * The counts of the head of the format of the picture of the places of the file of the picture of the format of the
 * walk of the places of the file of the picture of the format itself stands of no walk of this project yet, so the
 * places of the file of the picture of the format stand of the counts of the head of the format of the picture of the
 * places of the file of the picture of the format of the walk of the picture of the format of the places of the file
 * square alone (of the counts of the head of the format of the picture of the places of the file of the picture of the
 * format of the walk of the places of the file of the picture of the format of the picture of the format of the two
 * places of the file of the picture of the format). */
export function decodeVp8KeyFrame(payload: Buffer): Vp8Picture {
	const frame = readVp8FrameHeader(payload);
	if (!frame.keyFrame)
		throw unsupported(
			"The picture of the format of the web of the colour of the places of the picture stands of the counts of the head of the format of the picture of the format of the two places of the file of the picture of the format",
		);
	const header = readVp8PartitionHeader(frame.partition);
	if (1 !== header.tokenPartitions)
		throw unsupported(
			"The picture of the format of the web of the colour of the places of the picture stands of counts of the head of the format of the picture of the places of the file of their own",
		);
	const quantisers = buildVp8Quantisers(header);
	const mbWidth = Math.ceil(frame.width / 16);
	const mbHeight = Math.ceil(frame.height / 16);
	const yStride = 16 * mbWidth + 5;
	const uvStride = 8 * mbWidth + 5;
	const yPlane = new Uint8Array((16 * mbHeight + 1) * yStride);
	const uPlane = new Uint8Array((8 * mbHeight + 1) * uvStride);
	const vPlane = new Uint8Array((8 * mbHeight + 1) * uvStride);
	for (let row = 0; row <= 16 * mbHeight; row += 1) yPlane[row * yStride] = 129;
	for (let row = 0; row <= 8 * mbHeight; row += 1) {
		uPlane[row * uvStride] = 129;
		vPlane[row * uvStride] = 129;
	}
	yPlane.fill(127, 0, yStride);
	uPlane.fill(127, 0, uvStride);
	vPlane.fill(127, 0, uvStride);

	const first = header.decoder;
	const tokens = new Vp8BooleanDecoder(
		frame.payload.subarray(frame.firstPartSize),
	);
	const state: Vp8MacroblockState = createVp8MacroblockState(mbWidth);
	for (let mbY = 0; mbY < mbHeight; mbY += 1) {
		// The walk of the library of the picture of the web stands of the counts of the head of the format of the
		// places of the file of the picture of the format back to their standing places of the file at the head of
		// each row of the places of the file square (`VP8InitScanline`).
		resetVp8Scanline(state);
		const modes: Vp8MacroblockModes[] = [];
		for (let mbX = 0; mbX < mbWidth; mbX += 1)
			modes.push(
				readVp8MacroblockModes(
					first,
					state,
					mbX,
					header.segmentation,
					header.useSkipProbability,
					header.skipProbability,
				),
			);
		for (let mbX = 0; mbX < mbWidth; mbX += 1) {
			const mode = modes[mbX];
			if (!mode) throw invalid("no counts of the head of the format");
			const residuals: Vp8MacroblockCoefficients = readVp8MacroblockResiduals(
				tokens,
				state,
				mbX,
				mode,
				quantisers[mode.segment] ?? (quantisers[0] as never),
				header.probabilities,
			);
			const yOrigin = (16 * mbY + 1) * yStride + (16 * mbX + 1);
			if (mode.fourByFour) {
				// The four samples above and to the right of the macroblock (`ReconstructRow`, `top_right`). libwebp
				// keeps them in the macroblock cache, filled from the row above the macroblock (`top_yuv`): the four
				// samples following the macroblock in that row, or the last sample of that row repeated for the
				// rightmost macroblock. The same four values are then copied into the following three 4x4 block rows,
				// so every block row sees the samples of the row above the macroblock and not the samples above its
				// own row. For the first macroblock row the cache still holds the frame border value (127) and libwebp
				// leaves it alone, which is what the border row of the padded plane already holds.
				const above = yOrigin - yStride;
				const last = mbX >= mbWidth - 1;
				const held =
					0 === mbY ? 127 : last ? (yPlane[above + 15] ?? 0) : undefined;
				const adjacent = [0, 1, 2, 3].map((i) => yPlane[above + 16 + i] ?? 0);
				for (let row = 0; row < 16; row += 4) {
					const cells = above + row * yStride + 16;
					for (let i = 0; i < 4; i += 1)
						yPlane[cells + i] = undefined === held ? (adjacent[i] ?? 0) : held;
				}
			}
			if (mode.fourByFour) {
				let bits = residuals.nonZeroY;
				for (let block = 0; block < 16; block += 1) {
					const origin = fourPlaceOrigin(block, yOrigin, yStride);
					// The counts of the head of the format of the picture of the places of the file of the picture of
					// the format of the places of the file of the picture of the format of the count of the head of the
					// format of the picture of the format of the count of the head of the format itself stand of the
					// count of the head of the format of the picture of the places of the file of the picture of the
					// format of the picture of the format standing in front of them: of the counts of the places of
					// the file of the picture of the format of the count of the head of the format of the picture of
					// the places of the file of the picture of the format of the two of them the walk of this project
					// stands of the counts of the head of the format of the picture of the places of the file of the
					// picture of the format of the picture of the format of the count of the head of the format
					// standing of the places of the file of the picture of the format, of the places of the file of
					// the picture of the format of the picture of the format of the count of the head of the format of
					predictFour(yPlane, yStride, origin, mode.modes[block] ?? B_DC_PRED);
					doTransform(
						bits,
						residuals.coefficients,
						16 * block,
						yPlane,
						yStride,
						origin,
					);
					bits = (bits << 2) >>> 0;
				}
			} else {
				predictBig(
					yPlane,
					yStride,
					yOrigin,
					predictColourMode(mode.modes[0] ?? B_DC_PRED, 0 === mbY, 0 === mbX),
					0 === mbY,
					0 === mbX,
					16,
				);
				let bits = residuals.nonZeroY;
				if (0 !== bits) {
					for (let block = 0; block < 16; block += 1) {
						const origin = fourPlaceOrigin(block, yOrigin, yStride);
						doTransform(
							bits,
							residuals.coefficients,
							16 * block,
							yPlane,
							yStride,
							origin,
						);
						bits = (bits << 2) >>> 0;
					}
				}
			}
			const uOrigin = (8 * mbY + 1) * uvStride + (8 * mbX + 1);
			const vOrigin = uOrigin;
			const colourMode = predictColourMode(
				mode.colourMode,
				0 === mbY,
				0 === mbX,
			);
			predictBig(
				uPlane,
				uvStride,
				uOrigin,
				colourMode,
				0 === mbY,
				0 === mbX,
				8,
			);
			predictBig(
				vPlane,
				uvStride,
				vOrigin,
				colourMode,
				0 === mbY,
				0 === mbX,
				8,
			);
			doUvTransform(
				residuals.nonZeroUv & 0xff,
				residuals.coefficients,
				256,
				uPlane,
				uvStride,
				uOrigin,
			);
			doUvTransform(
				(residuals.nonZeroUv >>> 8) & 0xff,
				residuals.coefficients,
				320,
				vPlane,
				uvStride,
				vOrigin,
			);
		}
	}

	const y = new Uint8Array(frame.width * frame.height);
	const u = new Uint8Array(
		Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2),
	);
	const v = new Uint8Array(u.length);
	for (let row = 0; row < frame.height; row += 1)
		for (let column = 0; column < frame.width; column += 1)
			y[row * frame.width + column] =
				yPlane[(row + 1) * yStride + column + 1] ?? 0;
	const uvWidth = Math.ceil(frame.width / 2);
	const uvHeight = Math.ceil(frame.height / 2);
	for (let row = 0; row < uvHeight; row += 1)
		for (let column = 0; column < uvWidth; column += 1) {
			u[row * uvWidth + column] =
				uPlane[(row + 1) * uvStride + column + 1] ?? 0;
			v[row * uvWidth + column] =
				vPlane[(row + 1) * uvStride + column + 1] ?? 0;
		}
	return { width: frame.width, height: frame.height, y, u, v };
}
