import { describe, expect, it } from "vitest";
import { decodeVp8KeyFrame } from "../../packages/formats/src/shared/webp-vp8-picture.js";
import {
	CHECK_WEBP,
	CHECK_WEBP_PLANES,
	GRAD_WEBP,
	GRAD_WEBP_PLANES,
	LOSSY_HIGH_WEBP,
	LOSSY_HIGH_WEBP_PLANES,
	LOSSY_WEBP,
	LOSSY_WEBP_PLANES,
	NOISE_BIG_WEBP,
	NOISE_BIG_WEBP_PLANES,
	NOISE_TALL_WEBP,
	NOISE_TALL_WEBP_PLANES,
	NOISE_WEBP,
	NOISE_WEBP_PLANES,
	PILLAR_PLAIN_WEBP,
	PILLAR_PLAIN_WEBP_PLANES,
	RAMP_BIG_WEBP,
	RAMP_BIG_WEBP_PLANES,
	SOLID_WEBP,
	SOLID_WEBP_PLANES,
	T16_32_WEBP,
	T16_32_WEBP_PLANES,
	T16_64_WEBP,
	T16_64_WEBP_PLANES,
	TALL_WEBP,
	TALL_WEBP_PLANES,
	WIDE_WEBP,
	WIDE_WEBP_PLANES,
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

/** Joins the three planes of a decoded picture the way `ffmpeg -pix_fmt yuv420p` writes them. */
function planes(decoded: {
	y: Uint8Array;
	u: Uint8Array;
	v: Uint8Array;
}): Buffer {
	return Buffer.concat([
		Buffer.from(decoded.y),
		Buffer.from(decoded.u),
		Buffer.from(decoded.v),
	]);
}

/** The fixtures whose filtered reconstruction is compared byte for byte with the decoder. The expected planes come
 * from `ffmpeg -f rawvideo -pix_fmt yuv420p`, that is from a decoder library other than this one, so the expectation
 * is not written by the code under test; libwebp on the machine this was written on (the library the reference
 * delegates to, read through `WebPDecodeYUV`) writes the same bytes for every one of these fixtures.
 *
 * `SOLID`, `CHECK`, `GRAD`, `LOSSY` (4x3) and `WIDE` (48x16) cover one macroblock row; `TALL` (16x48), `T16_32`,
 * `T16_64`, `NOISE_TALL`, `PILLAR_PLAIN` (64x48) and `RAMP_BIG` (48x32) cover two to four macroblock rows;
 * `NOISE_BIG` (32x48) and `RAMP_BIG` mix several macroblock columns with several rows; `NOISE` (16x16) and
 * `NOISE_BIG` are noise, whose macroblocks the encoder codes as 4x4 blocks, so they exercise the 4x4 predictors in
 * later columns and rows. */
const CASES: [string, Buffer, Buffer][] = [
	["16x16 solid", SOLID_WEBP, SOLID_WEBP_PLANES],
	["16x16 chequerboard", CHECK_WEBP, CHECK_WEBP_PLANES],
	["16x16 vertical gradient", GRAD_WEBP, GRAD_WEBP_PLANES],
	["4x3 lossy", LOSSY_WEBP, LOSSY_WEBP_PLANES],
	["16x16 lossy at quality 90", LOSSY_HIGH_WEBP, LOSSY_HIGH_WEBP_PLANES],
	["16x16 noise", NOISE_WEBP, NOISE_WEBP_PLANES],
	["48x16 (three macroblocks wide)", WIDE_WEBP, WIDE_WEBP_PLANES],
	["16x48 (three macroblock rows)", TALL_WEBP, TALL_WEBP_PLANES],
	["16x32 (two macroblock rows)", T16_32_WEBP, T16_32_WEBP_PLANES],
	["16x64 (four macroblock rows)", T16_64_WEBP, T16_64_WEBP_PLANES],
	["16x32 noise", NOISE_TALL_WEBP, NOISE_TALL_WEBP_PLANES],
	["32x48 noise", NOISE_BIG_WEBP, NOISE_BIG_WEBP_PLANES],
	["64x48", PILLAR_PLAIN_WEBP, PILLAR_PLAIN_WEBP_PLANES],
	["48x32", RAMP_BIG_WEBP, RAMP_BIG_WEBP_PLANES],
];

describe("the key frame picture of the format of the web of the colour of the places of the picture", () => {
	for (const [name, data, expected] of CASES)
		it(`reconstructs ${name} byte for byte`, () => {
			expect(planes(decodeVp8KeyFrame(pictureOf(data))).toString("hex")).toBe(
				expected.toString("hex"),
			);
		});

	it("refuses a picture that is not a key frame", () => {
		const picture = Buffer.from(pictureOf(SOLID_WEBP));
		picture[0] = (picture[0] ?? 0) | 1;
		expect(() => decodeVp8KeyFrame(picture)).toThrow(
			/stands of no count of the head of the picture/,
		);
	});
});
