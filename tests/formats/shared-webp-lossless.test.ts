import { describe, expect, it } from "vitest";
import { GarbroError } from "@garbro-mcp/core";
import { readWebpImage } from "../../packages/formats/src/shared/webp-image.js";
import {
	GRADIENT_WEBP,
	LOSSY_WEBP,
	GRADIENT_WEBP_PLACES,
	PATTERN_WEBP,
	PLACES_WEBP,
} from "../helpers/webp.js";

describe("the walk of the places of the picture of the web", () => {
	it("reads the places of a picture of the colour of the picture of the counts of the head of the format of the picture of the web", () => {
		const image = readWebpImage(GRADIENT_WEBP);
		expect(image).toMatchObject({ width: 16, height: 12, bitsPerPixel: 32 });
		expect([...image.pixels]).toEqual([...GRADIENT_WEBP_PLACES]);
	});

	it("turns away a picture of the counts of the head of the format of the picture of the web of the list of the colours of the picture", () => {
		// The counts of the head of the format of the picture of the web of the list of the colours of the picture of
		// the picture of the counts of the head of the format of the picture of the web stand turned away, which the
		// record names.
		expect(() => readWebpImage(PATTERN_WEBP)).toThrow(GarbroError);
	});

	it("turns away the places of the picture of the colour of the places of the picture", () => {
		expect(() => readWebpImage(LOSSY_WEBP)).toThrow(GarbroError);
		expect(() => readWebpImage(PLACES_WEBP)).toThrow(GarbroError);
	});
});
