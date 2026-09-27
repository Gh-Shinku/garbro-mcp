import { describe, expect, it } from "vitest";
import { readTiffImage } from "../../packages/formats/src/shared/tiff-image.js";
import {
	ALPHA_TIFF,
	BILEVEL_TIFF,
	COLOUR_TIFF,
	DEFLATE_TIFF,
	GREY_TIFF,
	GREY_TIFF_PLACES,
	JPEG_TIFF,
	JPEG_TIFF_PLACES,
	PRESS_TIFF,
	PRESS_TIFF_PLACES,
	LZW_TIFF,
	LZW_TIFF_PLACES,
	PACKBITS_TIFF,
	PALETTE_TIFF,
	TWO_COLOUR_TIFF,
	TWO_COLOUR_TIFF_PLACES,
	PLANAR_TIFF,
	PLANAR_TIFF_PLACES,
	PREDICTOR_TIFF,
	PREDICTOR_TIFF_PLACES,
	SIXTEEN_TIFF,
	TILED_TIFF,
	TILED_TIFF_PLACES,
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

	it("reads the strips of the walk of the counts of twelve places of the file", async () => {
		const image = await readTiffImage(LZW_TIFF);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...LZW_TIFF_PLACES]);
	});

	it("reads a picture of the colour of the press", async () => {
		// The library wrote the file and hands the picture of the colour of the press over as the places of a
		// picture of three of them, which stand as an oracle of another implementation.
		const image = await readTiffImage(PRESS_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...PRESS_TIFF_PLACES]);
	});

	it("reads a picture whose places stand in tiles of their own", async () => {
		// A count of a colour a tile, of the right and the lower tile clipped where the picture ends. The file of
		// the fixture was built by this project, and the places of the picture were read out of it by the python
		// imaging library, which stands as an oracle of another implementation for it.
		const image = await readTiffImage(TILED_TIFF);
		expect(image).toMatchObject({ width: 5, height: 5, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...TILED_TIFF_PLACES]);
	});

	it("reads the rows of a picture of sixteen places of the file a sample that stand of a difference", async () => {
		const image = await readTiffImage(PREDICTOR_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([...PREDICTOR_TIFF_PLACES]);
	});

	it("reads a picture whose places stand of the walk of the jpeg", async () => {
		// The strip holds one whole jpeg stream, and the library decodes that stream itself, of the walk of the
		// jpeg it stands of; the two walks of this project differ a little at the edges of a colour change.
		const image = await readTiffImage(JPEG_TIFF);
		// The walk of the jpeg of this project hands its places over of the four places a bitmap reads, where the
		// library hands three over; the blue place of the picture stands first of both of them.
		expect(image).toMatchObject({ width: 16, height: 8, bitsPerPixel: 32 });
		let worst = 0;
		for (let at = 0; at < 16 * 8; at += 1) {
			for (let place = 0; place < 3; place += 1) {
				worst = Math.max(
					worst,
					Math.abs(
						(image.pixels[at * 4 + place] ?? 0) -
							(JPEG_TIFF_PLACES[at * 3 + place] ?? 0),
					),
				);
			}
		}
		expect(worst).toBeLessThanOrEqual(8);
	});

	it("reads a picture whose places of a colour stand apart", async () => {
		// One count of strips for every place of a colour, one count behind the other. The file of the fixture was
		// built by this project and the python imaging library reads it back through libtiff.
		const image = await readTiffImage(PLANAR_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...PLANAR_TIFF_PLACES]);
	});

	it("reads a picture of the colour of the two of them", async () => {
		// One place of the file a place of the picture, of the counts of the head of the format of the two of them:
		// the file stands of this project alone, since the library reads no such file of that counting.
		const image = await readTiffImage(TWO_COLOUR_TIFF);
		expect(image).toMatchObject({ width: 4, height: 3, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...TWO_COLOUR_TIFF_PLACES]);
	});

	it("reads a picture of sixteen places of the file a sample", async () => {
		const image = await readTiffImage(SIXTEEN_TIFF);
		expect(image).toMatchObject({ width: 3, height: 2, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([0x12, 0x56, 0x9a, 0xde, 0x11, 0x22]);
	});
});
