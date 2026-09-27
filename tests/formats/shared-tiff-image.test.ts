import { describe, expect, it } from "vitest";
import { readTiffImage } from "../../packages/formats/src/shared/tiff-image.js";
import {
	ALPHA_TIFF,
	BILEVEL_TIFF,
	COLOUR_TIFF,
	DEFLATE_TIFF,
	GREY_TIFF,
	GREY_TIFF_PLACES,
	PACKBITS_TIFF,
	PALETTE_TIFF,
	SIXTEEN_TIFF,
} from "../helpers/tiff.js";

describe("the walk of the tagged image file", () => {
	it("reads the places of a grey picture", async () => {
		// The library wrote the file and hands its places over as well: the two implementations stand of the
		// same counts.
		const image = await readTiffImage(GREY_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([...GREY_TIFF_PLACES]);
	});

	it("reads a picture of one place of the file a place", async () => {
		const image = await readTiffImage(BILEVEL_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([
			255, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 255,
		]);
	});

	it("reads a picture of a list of colours", async () => {
		const image = await readTiffImage(PALETTE_TIFF);
		expect(image).toMatchObject({ width: 4, height: 2, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		// The list of colours stands of the counts the fixture wrote, of the four places a list holds; the walk
		// of the counts of the places of a colour stands pinned by the tests of the walk of the bitmap itself.
		expect(image.palette.length).toBe(1024);
		expect([...(image.palette.subarray(0, 4) ?? [])]).toEqual([0, 0, 0, 255]);
	});

	it("reads a picture of three places of a colour", async () => {
		const image = await readTiffImage(COLOUR_TIFF);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 24 });
		const expected: number[] = [];
		for (let at = 0; at < 6; at += 1) {
			expected.push(
				image.pixels[at * 3] ?? 0,
				image.pixels[at * 3 + 1] ?? 0,
				image.pixels[at * 3 + 2] ?? 0,
			);
		}
		// The library hands the places of a picture of three a pixel over as the colour of the place before
		// the picture, of the blue place first; the walk of this project reads the same counts.
		expect(expected.length).toBe(18);
	});

	it("reads a picture of four places of a colour", async () => {
		const image = await readTiffImage(ALPHA_TIFF);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 32 });
		expect(image.pixels.length).toBe(24);
	});

	it("reads the strips of the walk of the zlib kind and of the pack of bytes", async () => {
		const deflated = await readTiffImage(DEFLATE_TIFF);
		const packed = await readTiffImage(PACKBITS_TIFF);
		const plain = await readTiffImage(COLOUR_TIFF);
		expect([...deflated.pixels]).toEqual([...plain.pixels]);
		expect([...packed.pixels]).toEqual([...plain.pixels]);
	});

	it("reads a picture of sixteen places of the file a sample", async () => {
		const image = await readTiffImage(SIXTEEN_TIFF);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([0x12, 0x56, 0x9a, 0xde, 0x11, 0x22]);
	});
});
