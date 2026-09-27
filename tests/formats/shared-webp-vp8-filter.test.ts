import { describe, expect, it } from "vitest";
import {
	buildVp8FilterStrengths,
	filterVp8MacroblockRow,
} from "../../packages/formats/src/shared/webp-vp8-filter.js";
import {
	readVp8FrameHeader,
	readVp8PartitionHeader,
} from "../../packages/formats/src/shared/webp-vp8.js";
import { SOLID_WEBP } from "../helpers/webp.js";

/** Extracts the `VP8 ` chunk of a WebP file. */
function pictureOf(data: Buffer): Buffer {
	let at = 12;
	while (at + 8 <= data.length) {
		const type = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		if ("VP8 " === type) return data.subarray(at + 8, at + 8 + size);
		at += 8 + size + (size & 1);
	}
	throw new Error("no VP8 chunk");
}

/** A header with the fields the strength walk reads; everything else stands as in a plain key frame. */
function headerWith(
	values: {
		level?: number;
		sharpness?: number;
		simple?: boolean;
		referenceDelta?: number;
		modeDelta?: number;
		useSegmentation?: boolean;
		absolute?: boolean;
		segmentLevels?: number[];
	} = {},
): Parameters<typeof buildVp8FilterStrengths>[0] {
	return {
		filter: {
			simple: values.simple ?? false,
			level: values.level ?? 0,
			sharpness: values.sharpness ?? 0,
			referenceDeltas: [values.referenceDelta ?? 0, 0, 0, 0],
			modeDeltas: [values.modeDelta ?? 0, 0, 0, 0],
		},
		segmentation: {
			use: values.useSegmentation ?? false,
			updateMap: false,
			absolute: values.absolute ?? true,
			filterStrengths: values.segmentLevels ?? [0, 0, 0, 0],
		},
	} as unknown as Parameters<typeof buildVp8FilterStrengths>[0];
}

describe("the strengths of the in-loop filter of the lossy stage", () => {
	it("reads the strength of a picture of the fixtures", () => {
		const header = readVp8PartitionHeader(
			readVp8FrameHeader(pictureOf(SOLID_WEBP)).partition,
		);
		expect(header.filter.level).toBe(8);
		expect(buildVp8FilterStrengths(header)[0]).toEqual([
			{ limit: 24, ilevel: 8, hevThreshold: 0, inner: false },
			{ limit: 24, ilevel: 8, hevThreshold: 0, inner: true },
		]);
	});

	it("turns the filter off at level zero", () => {
		for (const row of buildVp8FilterStrengths(headerWith({ level: 0 })))
			for (const strength of row) expect(strength.limit).toBe(0);
	});

	it("lifts the strength bands at levels 15 and 40", () => {
		expect(buildVp8FilterStrengths(headerWith({ level: 14 }))[0]?.[0]).toEqual({
			limit: 42,
			ilevel: 14,
			hevThreshold: 0,
			inner: false,
		});
		expect(buildVp8FilterStrengths(headerWith({ level: 15 }))[0]?.[0]).toEqual({
			limit: 45,
			ilevel: 15,
			hevThreshold: 1,
			inner: false,
		});
		expect(buildVp8FilterStrengths(headerWith({ level: 40 }))[0]?.[0]).toEqual({
			limit: 120,
			ilevel: 40,
			hevThreshold: 2,
			inner: false,
		});
	});

	it("caps the inner level by the sharpness", () => {
		expect(
			buildVp8FilterStrengths(headerWith({ level: 30, sharpness: 3 }))[0]?.[0],
		).toEqual({ limit: 66, ilevel: 6, hevThreshold: 1, inner: false });
		expect(
			buildVp8FilterStrengths(headerWith({ level: 30, sharpness: 6 }))[0]?.[0],
		).toEqual({ limit: 63, ilevel: 3, hevThreshold: 1, inner: false });
	});

	it("clamps the level after the deltas", () => {
		expect(
			buildVp8FilterStrengths(
				headerWith({ level: 63, referenceDelta: 6, modeDelta: 6 }),
			)[0],
		).toEqual([
			{ limit: 189, ilevel: 63, hevThreshold: 2, inner: false },
			{ limit: 189, ilevel: 63, hevThreshold: 2, inner: true },
		]);
		expect(
			buildVp8FilterStrengths(
				headerWith({ level: 3, referenceDelta: -6 }),
			)[0]?.[0],
		).toEqual({ limit: 0, ilevel: 0, hevThreshold: 0, inner: false });
	});

	it("adds the frame level to a relative segment level", () => {
		const relative = buildVp8FilterStrengths(
			headerWith({
				level: 10,
				useSegmentation: true,
				absolute: false,
				segmentLevels: [0, 5, 0, 0],
			}),
		);
		expect(relative[0]?.[0]?.limit).toBe(30);
		expect(relative[1]?.[0]?.limit).toBe(45);
		const absolute = buildVp8FilterStrengths(
			headerWith({
				level: 10,
				useSegmentation: true,
				absolute: true,
				segmentLevels: [0, 5, 0, 0],
			}),
		);
		expect(absolute[0]?.[0]?.limit).toBe(0);
		expect(absolute[1]?.[0]?.limit).toBe(15);
	});

	it("leaves a plane alone when the frame level is zero", () => {
		const y = new Uint8Array(32 * 32);
		for (let i = 0; i < y.length; i += 1) y[i] = i & 0xff;
		const before = Uint8Array.from(y);
		filterVp8MacroblockRow({
			y,
			u: new Uint8Array(0),
			v: new Uint8Array(0),
			yStride: 32,
			uvStride: 32,
			mbY: 1,
			simple: false,
			strengths: buildVp8FilterStrengths(headerWith({ level: 0 })),
			macroblocks: [{ segment: 0, fourByFour: true, skip: false }],
		});
		expect(Buffer.from(y).toString("hex")).toBe(
			Buffer.from(before).toString("hex"),
		);
	});
});
