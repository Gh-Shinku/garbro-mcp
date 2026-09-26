// The walk of the head of a picture of an object of the kind `Texture2D` of the Unity engine, and the places
// of a picture of it, against the walks the reference stands of in "ArcFormats/Unity/Texture2D.cs".
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { UnityReader } from "../../packages/formats/src/unity/asset-file.js";
import {
	decodeUnityTexture2d,
	isUnityTextureFormat,
	readUnityTexture2d,
} from "../../packages/formats/src/unity/texture2d.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

function le32(value: number): Buffer {
	const out = Buffer.alloc(4);
	out.writeInt32LE(value, 0);
	return out;
}

/** The head of a picture of the engine, of the walk the reference stands of a file of the kind of asset. */
function head(input: {
	width: number;
	height: number;
	kind: number;
	data: Buffer;
}): Buffer {
	const name = Buffer.from("sample", "latin1");
	return Buffer.concat([
		le32(name.length),
		name,
		le32(input.width),
		le32(input.height),
		le32(input.data.length), // the count of the places of the picture
		le32(input.kind),
		le32(1), // the count of the walks of the picture
		// The places a file of this kind stands of two flags of its own.
		Buffer.from([0x00, 0x00]),
		le32(1), // the count of the pictures of the object
		le32(2), // the shape of the picture
		le32(0), // the way the places of the picture stand
		le32(1), // the count of the places of the walk of the widths
		le32(0), // the walk of the places of the picture, of four places of the file
		le32(0), // the way the places stand beyond the picture
		le32(1), // the places of the picture, of a count of one place
		le32(0), // the kinds of the places of it
		le32(input.data.length),
		input.data,
	]);
}

/** The picture of an object of the kind `Texture2D`, of the places the head and the picture stand of. */
function pictureOf(input: {
	width: number;
	height: number;
	kind: number;
	data: Buffer;
}) {
	const reader = new UnityReader(head(input));
	reader.setup(11, true);
	const picture = readUnityTexture2d(reader, "5.x.x", 11);
	if (!picture) throw new Error("the walk stood of no picture");
	return picture;
}

/** The places of the picture of the engine, as a bitmap of this project reads them. */
function bmpOf(input: {
	width: number;
	height: number;
	kind: number;
	data: Buffer;
}) {
	const places = decodeUnityTexture2d(pictureOf(input));
	if (!places) throw new Error("the walk stood of no places");
	const picture = readBmpImage(places);
	if (!picture) throw new Error("the walk stood of no picture");
	return picture;
}

describe("Unity picture of an object", () => {
	it("reads the places of a picture of the kinds the reference stands of", () => {
		// The places of a picture of the kinds the reference stands of stand as they stand, of the kinds of
		// the places of the picture of two places of the file.
		const places = Buffer.from([1, 1, 2, 2, 3, 3, 4, 4]);
		expect(isUnityTextureFormat(1)).toBe(true);
		expect(isUnityTextureFormat(4)).toBe(true);
		expect(isUnityTextureFormat(14)).toBe(true);
		expect(isUnityTextureFormat(6)).toBe(true); // the places of a picture of a red place of sixteen
		expect(isUnityTextureFormat(25)).toBe(false); // the places of a picture of seven places
		expect(isUnityTextureFormat(28)).toBe(false); // the places of a picture of the kind of a fruit
		const picture = pictureOf({
			width: 2,
			height: 1,
			kind: 14,
			data: places,
		});
		expect([picture.width, picture.height, picture.format]).toEqual([2, 1, 14]);
		expect([...picture.data]).toEqual([...places]);
	});

	it("reads a picture of one place of a colour of a place as a picture of grey", () => {
		const image = bmpOf({
			width: 2,
			height: 1,
			kind: 1, // the places of the picture stand one place of grey
			data: Buffer.from([0x00, 0xff]),
		});
		expect([image.width, image.height, image.bitsPerPixel]).toEqual([2, 1, 8]);
		expect([...image.pixels]).toEqual([0x00, 0xff]);
	});

	it("reads a picture of a red place of sixteen places as a picture of grey", () => {
		// The reference hands out a picture of one place of grey of sixteen places; the walk of this port
		// stands of one place of eight, of the high places of the file.
		const image = bmpOf({
			width: 2,
			height: 1,
			kind: 6,
			data: Buffer.from([0x00, 0xff, 0x00, 0x80]),
		});
		expect([image.width, image.height, image.bitsPerPixel]).toEqual([2, 1, 8]);
		expect([...image.pixels]).toEqual([0xff, 0x80]);
	});

	it("reads a picture of twenty four places as a picture of the places the other way round", () => {
		// The places of the picture stand red, green then blue, while a bitmap of this project stands them
		// blue, green then red; and the rows of a picture of the engine stand from its foot up.
		const image = bmpOf({
			width: 2,
			height: 2,
			kind: 3,
			data: Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
		});
		expect([image.width, image.height, image.bitsPerPixel]).toEqual([2, 2, 24]);
		expect([...image.pixels]).toEqual([
			90, 80, 70, 120, 110, 100, 30, 20, 10, 60, 50, 40,
		]);
	});

	it("reads a picture of the covering place last as a picture of the places the other way round", () => {
		const image = bmpOf({
			width: 2,
			height: 2,
			kind: 4, // the places of the picture stand red, green, blue then the covering place
			data: Buffer.from([
				10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
			]),
		});
		expect([...image.pixels]).toEqual([
			90, 80, 70, 255, 120, 110, 100, 255, 30, 20, 10, 255, 60, 50, 40, 255,
		]);
	});

	it("reads a picture of the covering place first as a picture of the places the other way round", () => {
		const image = bmpOf({
			width: 1,
			height: 2,
			kind: 5, // the places of the picture stand the covering place, red, green then blue
			data: Buffer.from([255, 10, 20, 30, 128, 40, 50, 60]),
		});
		expect([...image.pixels]).toEqual([60, 50, 40, 128, 30, 20, 10, 255]);
	});

	it("reads a picture of four places of a colour of a place as a picture of eight places of a colour", () => {
		// `ConvertArgb16`: every place of half a place of the file stands of two places of a colour.
		const image = bmpOf({
			width: 2,
			height: 1,
			kind: 2,
			data: Buffer.from([0x21, 0x43, 0x0f, 0xf0]),
		});
		expect([image.width, image.height, image.bitsPerPixel]).toEqual([2, 1, 32]);
		expect([...image.pixels]).toEqual([
			0x11, 0x22, 0x33, 0x44, 0xff, 0x00, 0x00, 0xff,
		]);
	});

	it("reads a picture of five places of a colour and six of green as a picture of sixteen places", () => {
		const image = bmpOf({
			width: 2,
			height: 1,
			kind: 7,
			data: Buffer.from([0x00, 0xf8, 0xff, 0xff]),
		});
		expect([image.width, image.height, image.bitsPerPixel]).toEqual([2, 1, 16]);
		// The places of a picture of this kind stand of sixteen places, of the colours of it, which the
		// reader of this project hands over as they stand.
		expect([...image.pixels]).toEqual([0x00, 0xf8, 0xff, 0xff]);
	});

	it("stands of no places of a picture of a kind this project does not read", () => {
		const data = Buffer.alloc(24, 0x00);
		const walks: [number, number, number][] = [
			[8, 2, 1], // the places of a picture of the kind of the walk of a name
			[13, 2, 1], // the places of the picture of four places of a colour of a place
			[25, 4, 4], // the places of the picture of the kind of seven places
			[28, 4, 4], // the places of a picture of the kind of a fruit
		];
		for (const [kind, width, height] of walks) {
			const picture = pictureOf({ width, height, kind, data });
			expect(decodeUnityTexture2d(picture)).toBeUndefined();
		}
	});

	it("stands of no picture of a kind of a walk the reference does not know", () => {
		const reader = new UnityReader(
			head({ width: 2, height: 2, kind: 14, data: Buffer.alloc(16) }),
		);
		reader.setup(11, true);
		expect(readUnityTexture2d(reader, undefined, 11)).toBeUndefined();
	});
});
