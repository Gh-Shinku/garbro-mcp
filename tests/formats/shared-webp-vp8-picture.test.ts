import { describe, expect, it } from "vitest";
import { decodeVp8KeyFrame } from "../../packages/formats/src/shared/webp-vp8-picture.js";
import {
	CHECK_WEBP,
	CHECK_WEBP_PLANES,
	GRAD_WEBP,
	GRAD_WEBP_PLANES,
	LOSSY_WEBP,
	LOSSY_WEBP_PLANES,
	NOISE_WEBP,
	NOISE_WEBP_PLANES,
	PILLAR_PLAIN_WEBP,
	SOLID_WEBP,
	SOLID_WEBP_PLANES,
	TALL_WEBP,
	WIDE_WEBP,
	WIDE_WEBP_PLANES,
} from "../helpers/webp.js";

/** The places of the file of the picture of the format of the colour of the places of the picture of a picture of the
 * format of the web. */
function pictureOf(data: Buffer): Buffer {
	let at = 12;
	while (at + 8 <= data.length) {
		const type = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		if ("VP8 " === type) return data.subarray(at + 8, at + 8 + size);
		at += 8 + size + (size & 1);
	}
	throw new Error(
		"no picture of the colour of the places of the picture of the format",
	);
}

/** The places of the file of the picture of the format of the counts of the head of the format of the places of the
 * file of the colour of the places of the picture. */
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

describe("the walk of the picture of the format itself of the picture of the web of the colour of the places of the picture", () => {
	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of sixteen places of the file square of no count of the head of the format", () => {
		expect(
			planes(decodeVp8KeyFrame(pictureOf(SOLID_WEBP))).toString("hex"),
		).toBe(SOLID_WEBP_PLANES.toString("hex"));
	});

	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of sixteen places of the file square of the counts of the places of the file", () => {
		expect(
			planes(decodeVp8KeyFrame(pictureOf(CHECK_WEBP))).toString("hex"),
		).toBe(CHECK_WEBP_PLANES.toString("hex"));
	});

	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of sixteen places of the file square of the counts of the head of the format", () => {
		expect(
			planes(decodeVp8KeyFrame(pictureOf(GRAD_WEBP))).toString("hex"),
		).toBe(GRAD_WEBP_PLANES.toString("hex"));
	});

	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of four places of the file", () => {
		expect(
			planes(decodeVp8KeyFrame(pictureOf(LOSSY_WEBP))).toString("hex"),
		).toBe(LOSSY_WEBP_PLANES.toString("hex"));
	});

	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of the counts of the head of the format of the places of the file of their own", () => {
		expect(
			planes(decodeVp8KeyFrame(pictureOf(WIDE_WEBP))).toString("hex"),
		).toBe(WIDE_WEBP_PLANES.toString("hex"));
	});
	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of the counts of the head of the format of the picture of the places of the file of their own", () => {
		// The counts of the head of the format of the picture of the places of the file of the picture of the format
		// of the places of the file square of the counts of the head of the format of the picture of the places of the
		// file: the counts of the head of the format of the picture of the places of the file of the picture of the
		// format of the places of the file of the colour of the picture of the last block of a count of the head of
		// the format of the picture of the places of the file of a picture of the format stand of the counts of the
		// head of the format of the picture of the places of the file of the picture of the format of the count of the
		// head of the format of the picture of the format itself (the walk of the library of the picture of the web
		// makes them stand of the same counts of the head of the format).
		expect(
			planes(decodeVp8KeyFrame(pictureOf(NOISE_WEBP))).toString("hex"),
		).toBe(NOISE_WEBP_PLANES.toString("hex"));
	});

	it("stands of the counts of the head of the format of the picture of the places of the file of the picture of the format of the counts of the places of the file of their own of no walk", () => {
		// The counts of the head of the format of the picture of the places of the file of the picture of the format
		// standing in front of the picture of the format of the counts of the places of the file of the picture of the
		// format stand of counts of their own of this walk of the places of the file yet.
		expect(() => decodeVp8KeyFrame(pictureOf(TALL_WEBP))).toThrow(
			/the counts of the places of the file of their own/,
		);
		expect(() => decodeVp8KeyFrame(pictureOf(PILLAR_PLAIN_WEBP))).toThrow(
			/the counts of the places of the file of their own/,
		);
	});
});
