import { describe, expect, it } from "vitest";
import { readWebpImage } from "../../packages/formats/src/shared/webp-image.js";
import {
	FLAT_WEBP,
	FLAT_WEBP_PLACES,
	GRADIENT_WEBP,
	GRADIENT_WEBP_PLACES,
	PATTERN_WEBP,
	PATTERN_WEBP_PLACES,
} from "../helpers/webp.js";

describe("the walk of the places of the picture of the web", () => {
	it("reads the places of a picture of the colour of the picture of the counts of the head of the format of the picture of the web", () => {
		const image = readWebpImage(GRADIENT_WEBP);
		expect(image).toMatchObject({ width: 16, height: 12, bitsPerPixel: 32 });
		expect([...image.pixels]).toEqual([...GRADIENT_WEBP_PLACES]);
	});

	it("reads the places of a picture of the counts of the head of the format of the picture of the web of the list of the colours of the picture, of the colour of the picture of the places of the file", () => {
		// The counts of the head of the format of the picture of the web of the list of the colours of the picture of
		// the counts of the head of the format of the picture of the web of the colour of the picture of the places of
		// the file, of the counts of the head of the format of the picture of the web of the colour of the picture of
		// the places of the file of the picture.
		const flat = readWebpImage(FLAT_WEBP);
		expect(flat).toMatchObject({ width: 8, height: 8, bitsPerPixel: 32 });
		expect([...flat.pixels]).toEqual([...FLAT_WEBP_PLACES]);
		const pattern = readWebpImage(PATTERN_WEBP);
		expect(pattern).toMatchObject({ width: 12, height: 6, bitsPerPixel: 32 });
		expect([...pattern.pixels]).toEqual([...PATTERN_WEBP_PLACES]);
	});
});
