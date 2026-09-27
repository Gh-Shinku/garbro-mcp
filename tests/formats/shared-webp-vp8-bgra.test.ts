import { describe, expect, it } from "vitest";
import { walkVp8Bgra } from "../../packages/formats/src/shared/webp-vp8-bgra.js";
import { decodeVp8KeyFrame } from "../../packages/formats/src/shared/webp-vp8-picture.js";
import {
	CHECK_BGRA,
	CHECK_WEBP,
	GRAD_BGRA,
	GRAD_WEBP,
	LOSSY_BGRA,
	LOSSY_WEBP,
	MULTI_PARTITION_BGRA,
	MULTI_PARTITION_WEBP,
	NOISE_BGRA,
	NOISE_WEBP,
	ODD_BGRA,
	ODD_WEBP,
	SOLID_BGRA,
	SOLID_WEBP,
	T16_32_BGRA,
	T16_32_WEBP,
	TALL_BGRA,
	TALL_WEBP,
	WIDE_BGRA,
	WIDE_WEBP,
} from "../helpers/webp.js";

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

/** The expected BGRA of the reference: the bytes `WebPDecodeBGRAInto` writes, which is the call the reference of
 * this row makes, read through the platform library of the machine this was written on. So the expectation comes from
 * the very library the reference delegates to and not from the code under test. `ODD_WEBP` is 5x7 and `LOSSY_WEBP` is
 * 4x3, so the odd width and the odd height tails of the chroma upsampling are covered. */
const CASES: [string, Buffer, Buffer][] = [
	["16x16 solid", SOLID_WEBP, SOLID_BGRA],
	["16x16 chequerboard", CHECK_WEBP, CHECK_BGRA],
	["16x16 gradient", GRAD_WEBP, GRAD_BGRA],
	["16x16 noise", NOISE_WEBP, NOISE_BGRA],
	["4x3", LOSSY_WEBP, LOSSY_BGRA],
	["5x7", ODD_WEBP, ODD_BGRA],
	["16x48", TALL_WEBP, TALL_BGRA],
	["48x16", WIDE_WEBP, WIDE_BGRA],
	["16x32", T16_32_WEBP, T16_32_BGRA],
	[
		"64x48 with four token partitions",
		MULTI_PARTITION_WEBP,
		MULTI_PARTITION_BGRA,
	],
];

describe("the colours of the lossy picture of the web", () => {
	for (const [name, data, expected] of CASES)
		it(`converts ${name} to the BGRA places of the file of the reference`, () => {
			expect(
				walkVp8Bgra(decodeVp8KeyFrame(pictureOf(data))).toString("hex"),
			).toBe(expected.toString("hex"));
		});
});
