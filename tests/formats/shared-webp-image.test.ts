import { describe, expect, it } from "vitest";
import { GarbroError } from "@garbro-mcp/core";
import { readWebpHeader } from "../../packages/formats/src/shared/webp-image.js";
import {
	ALPHA_WEBP,
	LOSSY_WEBP,
	PLACES_WEBP,
	PLAIN_WEBP,
} from "../helpers/webp.js";

describe("the walk of the picture of the web", () => {
	it("reads the counts of the head of the picture of the counts of the head of the format of the picture of the web", () => {
		expect(readWebpHeader(ALPHA_WEBP)).toEqual({
			width: 4,
			height: 3,
			alpha: true,
			lossless: true,
			version: 0,
		});
	});

	it("reads the counts of the head of the picture of the colour of the picture", () => {
		expect(readWebpHeader(LOSSY_WEBP)).toEqual({
			width: 4,
			height: 3,
			alpha: false,
			lossless: false,
			version: 0,
		});
	});

	it("reads the counts of the head of the picture of the places of the file of the places of the colour of the picture", () => {
		// The counts of the head of the format of the picture of the web of the places of the file, of the counts of
		// the head of the format of the picture of the web of the places of the picture of the head of the format.
		expect(readWebpHeader(PLACES_WEBP)).toEqual({
			width: 4,
			height: 3,
			alpha: true,
			lossless: false,
			version: 0,
		});
	});

	it("reads the counts of the head of a picture of no colour of the places of the file", () => {
		expect(readWebpHeader(PLAIN_WEBP)).toEqual({
			width: 4,
			height: 3,
			alpha: false,
			lossless: true,
			version: 0,
		});
	});

	it("turns away the places of the file of the picture of the colour of the picture", () => {
		const moved = Buffer.from(PLAIN_WEBP);
		moved.write("ANIM", 12, "latin1");
		expect(() => readWebpHeader(moved)).toThrow(GarbroError);
		try {
			readWebpHeader(moved);
		} catch (error) {
			expect((error as GarbroError).code).toBe("UNSUPPORTED_FEATURE");
		}
	});

	it("turns away a picture of the web of no head of the format of the picture of the web", () => {
		const moved = Buffer.from(PLAIN_WEBP);
		moved.write("XIFF", 0, "latin1");
		expect(() => readWebpHeader(moved)).toThrow(GarbroError);
		expect(() => readWebpHeader(PLAIN_WEBP.subarray(0, 10))).toThrow(
			GarbroError,
		);
	});
});
