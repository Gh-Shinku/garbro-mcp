import { SEGMENT_COUNT } from "./webp-vp8.js";
import type { Vp8PartitionHeader } from "./webp-vp8.js";

/** The filtering strength of one segment and one macroblock kind (`VP8FInfo` of libwebp). */
export interface Vp8FilterStrength {
	readonly limit: number;
	readonly ilevel: number;
	readonly hevThreshold: number;
	readonly inner: boolean;
}

/** Precomputes the filtering strength of each segment and each macroblock kind (`PrecomputeFilterStrengths`).
 *
 * The reference adds the frame level deltas to the level only when the header carries them and the reader that
 * follows them asks for an update; the deltas stay zero in every other case, so this walk adds them always, which
 * comes to the same counts.
 *
 * A level of zero anywhere (the frame level, or a level that the deltas bring down to zero) turns the filter off for
 * that macroblock: `limit` stays zero and the walk below skips it. */
export function buildVp8FilterStrengths(
	header: Vp8PartitionHeader,
): Vp8FilterStrength[][] {
	const strengths: Vp8FilterStrength[][] = [];
	for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
		const base = header.segmentation.use
			? (header.segmentation.filterStrengths[segment] ?? 0) +
				(header.segmentation.absolute ? 0 : header.filter.level)
			: header.filter.level;
		const row: Vp8FilterStrength[] = [];
		for (let fourByFour = 0; fourByFour <= 1; fourByFour += 1) {
			let level = base + (header.filter.referenceDeltas[0] ?? 0);
			if (0 !== fourByFour) level += header.filter.modeDeltas[0] ?? 0;
			level = level < 0 ? 0 : level > 63 ? 63 : level;
			let limit = 0;
			let ilevel = 0;
			let hevThreshold = 0;
			if (level > 0) {
				ilevel = level;
				if (header.filter.sharpness > 0) {
					ilevel = header.filter.sharpness > 4 ? ilevel >> 2 : ilevel >> 1;
					if (ilevel > 9 - header.filter.sharpness)
						ilevel = 9 - header.filter.sharpness;
				}
				if (ilevel < 1) ilevel = 1;
				limit = 2 * level + ilevel;
				hevThreshold = level >= 40 ? 2 : level >= 15 ? 1 : 0;
			}
			row.push({ limit, ilevel, hevThreshold, inner: 0 !== fourByFour });
		}
		strengths.push(row);
	}
	return strengths;
}

/** The counts of the head of the format of the picture of the places of the file of one macroblock of a row. */
export interface Vp8MacroblockFilter {
	readonly segment: number;
	readonly fourByFour: boolean;
	readonly skip: boolean;
}

/** The planes of a picture and the counts of the head of the format of the picture of the places of the file of one
 * row of the places of the file square. */
export interface Vp8FilterRow {
	readonly y: Uint8Array;
	readonly u: Uint8Array;
	readonly v: Uint8Array;
	readonly yStride: number;
	readonly uvStride: number;
	readonly mbY: number;
	readonly simple: boolean;
	readonly strengths: readonly (readonly Vp8FilterStrength[])[];
	readonly macroblocks: readonly Vp8MacroblockFilter[];
}

/** Clips a sample to the range of a place of the file (`VP8kclip1`). */
function clip(value: number): number {
	return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** Clips a difference to the range of the two tap filter (`VP8ksclip1`). */
function clipWide(value: number): number {
	return value < -128 ? -128 : value > 127 ? 127 : value;
}

/** Clips a difference to the range of the four tap filter (`VP8ksclip2`). */
function clipNarrow(value: number): number {
	return value < -16 ? -16 : value > 15 ? 15 : value;
}

function place(pixels: Uint8Array, at: number): number {
	return pixels[at] ?? 0;
}

/** The two tap filter (`DoFilter2`). */
function filterTwo(pixels: Uint8Array, at: number, step: number): void {
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	const a = 3 * (q0 - p0) + clipWide(p1 - q1);
	const a1 = clipNarrow((a + 4) >> 3);
	const a2 = clipNarrow((a + 3) >> 3);
	pixels[at - step] = clip(p0 + a2);
	pixels[at] = clip(q0 - a1);
}

/** The four tap filter (`DoFilter4`). */
function filterFour(pixels: Uint8Array, at: number, step: number): void {
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	const a = 3 * (q0 - p0);
	const a1 = clipNarrow((a + 4) >> 3);
	const a2 = clipNarrow((a + 3) >> 3);
	const a3 = (a1 + 1) >> 1;
	pixels[at - 2 * step] = clip(p1 + a3);
	pixels[at - step] = clip(p0 + a2);
	pixels[at] = clip(q0 - a1);
	pixels[at + step] = clip(q1 - a3);
}

/** The six tap filter (`DoFilter6`). */
function filterSix(pixels: Uint8Array, at: number, step: number): void {
	const p2 = place(pixels, at - 3 * step);
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	const q2 = place(pixels, at + 2 * step);
	const a = clipWide(3 * (q0 - p0) + clipWide(p1 - q1));
	const a1 = (27 * a + 63) >> 7;
	const a2 = (18 * a + 63) >> 7;
	const a3 = (9 * a + 63) >> 7;
	pixels[at - 3 * step] = clip(p2 + a3);
	pixels[at - 2 * step] = clip(p1 + a2);
	pixels[at - step] = clip(p0 + a1);
	pixels[at] = clip(q0 - a1);
	pixels[at + step] = clip(q1 - a2);
	pixels[at + 2 * step] = clip(q2 - a3);
}

/** Whether the count of the head of the format of the places of the file of a count of the head of the format of the
 * picture of the places of the file stands of the two tap filter (`NeedsFilter`). */
function needsFilter(
	pixels: Uint8Array,
	at: number,
	step: number,
	threshold: number,
): boolean {
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	return 4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) <= threshold;
}

/** Whether the count of the head of the format of the places of the file of a count of the head of the format of the
 * picture of the places of the file stands of the four or six tap filter (`NeedsFilter2`). */
function needsFilterTwo(
	pixels: Uint8Array,
	at: number,
	step: number,
	threshold: number,
	innerThreshold: number,
): boolean {
	const p3 = place(pixels, at - 4 * step);
	const p2 = place(pixels, at - 3 * step);
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	const q2 = place(pixels, at + 2 * step);
	const q3 = place(pixels, at + 3 * step);
	if (4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) > threshold) return false;
	return (
		Math.abs(p3 - p2) <= innerThreshold &&
		Math.abs(p2 - p1) <= innerThreshold &&
		Math.abs(p1 - p0) <= innerThreshold &&
		Math.abs(q3 - q2) <= innerThreshold &&
		Math.abs(q2 - q1) <= innerThreshold &&
		Math.abs(q1 - q0) <= innerThreshold
	);
}

/** Whether the count of the head of the format of the places of the file of a count of the head of the format of the
 * picture of the places of the file stands of the two tap filter of a strong count of the head of the format
 * (`Hev`). */
function needsShortFilter(
	pixels: Uint8Array,
	at: number,
	step: number,
	threshold: number,
): boolean {
	const p1 = place(pixels, at - 2 * step);
	const p0 = place(pixels, at - step);
	const q0 = place(pixels, at);
	const q1 = place(pixels, at + step);
	return Math.abs(p1 - p0) > threshold || Math.abs(q1 - q0) > threshold;
}

/** The walk of the two tap filter over one count of the head of the format of the places of the file
 * (`SimpleVFilter16`, `SimpleHFilter16`): `along` is the step between the lines of the count of the head of the
 * format and `across` the step across it. */
function simpleFilter(
	pixels: Uint8Array,
	at: number,
	along: number,
	across: number,
	size: number,
	threshold: number,
): void {
	const limit = 2 * threshold + 1;
	for (let line = 0; line < size; line += 1) {
		const start = at + line * along;
		if (needsFilter(pixels, start, across, limit))
			filterTwo(pixels, start, across);
	}
}

/** The walk of the four or six tap filter over one count of the head of the format of the places of the file
 * (`FilterLoop26`, `FilterLoop24`). */
function complexFilter(
	pixels: Uint8Array,
	at: number,
	along: number,
	across: number,
	size: number,
	threshold: number,
	innerThreshold: number,
	hevThreshold: number,
	six: boolean,
): void {
	const limit = 2 * threshold + 1;
	for (let line = 0; line < size; line += 1) {
		const start = at + line * along;
		if (!needsFilterTwo(pixels, start, across, limit, innerThreshold)) continue;
		if (needsShortFilter(pixels, start, across, hevThreshold))
			filterTwo(pixels, start, across);
		else if (six) filterSix(pixels, start, across);
		else filterFour(pixels, start, across);
	}
}

/** Filters the edges of one macroblock row, left to right (`DoFilter` and `FilterRow` of libwebp).
 *
 * The edges it walks are: the vertical edges between this macroblock and the one before it in the same row, the
 * three inner vertical edges of the macroblock when the macroblock keeps its own filtering (`f_inner`), the
 * horizontal edge between the row above and this macroblock when it is not in the first row, and the three inner
 * horizontal edges under the same condition. The vertical edge of the first macroblock of a row and the horizontal
 * edge of the first macroblock row are the frame border, so they are left alone, and so are the right and bottom
 * frame borders.
 *
 * `f_inner` of libwebp is the 4x4 flag of the macroblock if its coefficients are skipped and one otherwise, so a
 * macroblock that carries coefficients always has its inner edges filtered.
 *
 * This walk must not write into the planes the predictors read: libwebp predicts from the unfiltered reconstruction
 * of the row above (`top_yuv`, stashed in `ReconstructRow` before `FilterRow` runs) and filters its own row cache.
 * The caller therefore passes the filtered planes here. */
export function filterVp8MacroblockRow(row: Vp8FilterRow): void {
	const { y, u, v, yStride, uvStride, mbY, simple, strengths, macroblocks } =
		row;
	for (let mbX = 0; mbX < macroblocks.length; mbX += 1) {
		const macroblock = macroblocks[mbX];
		if (!macroblock) continue;
		const strength =
			strengths[macroblock.segment]?.[macroblock.fourByFour ? 1 : 0];
		if (!strength || 0 === strength.limit) continue;
		const inner = strength.inner || !macroblock.skip;
		const limit = strength.limit;
		const yAt = (16 * mbY + 1) * yStride + 16 * mbX + 1;
		const uvAt = (8 * mbY + 1) * uvStride + 8 * mbX + 1;
		if (simple) {
			if (mbX > 0) simpleFilter(y, yAt, yStride, 1, 16, limit + 4);
			if (inner)
				for (let edge = 1; edge < 4; edge += 1)
					simpleFilter(y, yAt + 4 * edge, yStride, 1, 16, limit);
			if (mbY > 0) simpleFilter(y, yAt, 1, yStride, 16, limit + 4);
			if (inner)
				for (let edge = 1; edge < 4; edge += 1)
					simpleFilter(y, yAt + 4 * edge * yStride, 1, yStride, 16, limit);
			continue;
		}
		const { ilevel, hevThreshold } = strength;
		if (mbX > 0) {
			complexFilter(
				y,
				yAt,
				yStride,
				1,
				16,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
			complexFilter(
				u,
				uvAt,
				uvStride,
				1,
				8,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
			complexFilter(
				v,
				uvAt,
				uvStride,
				1,
				8,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
		}
		if (inner) {
			for (let edge = 1; edge < 4; edge += 1)
				complexFilter(
					y,
					yAt + 4 * edge,
					yStride,
					1,
					16,
					limit,
					ilevel,
					hevThreshold,
					false,
				);
			complexFilter(
				u,
				uvAt + 4,
				uvStride,
				1,
				8,
				limit,
				ilevel,
				hevThreshold,
				false,
			);
			complexFilter(
				v,
				uvAt + 4,
				uvStride,
				1,
				8,
				limit,
				ilevel,
				hevThreshold,
				false,
			);
		}
		if (mbY > 0) {
			complexFilter(
				y,
				yAt,
				1,
				yStride,
				16,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
			complexFilter(
				u,
				uvAt,
				1,
				uvStride,
				8,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
			complexFilter(
				v,
				uvAt,
				1,
				uvStride,
				8,
				limit + 4,
				ilevel,
				hevThreshold,
				true,
			);
		}
		if (inner) {
			for (let edge = 1; edge < 4; edge += 1)
				complexFilter(
					y,
					yAt + 4 * edge * yStride,
					1,
					yStride,
					16,
					limit,
					ilevel,
					hevThreshold,
					false,
				);
			complexFilter(
				u,
				uvAt + 4 * uvStride,
				1,
				uvStride,
				8,
				limit,
				ilevel,
				hevThreshold,
				false,
			);
			complexFilter(
				v,
				uvAt + 4 * uvStride,
				1,
				uvStride,
				8,
				limit,
				ilevel,
				hevThreshold,
				false,
			);
		}
	}
}
