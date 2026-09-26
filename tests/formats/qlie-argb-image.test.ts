// The QLIE picture of an alpha and colours, against streams written here: the colours are the recorded JPEG
// of `tests/helpers/jpeg.ts` and the alpha is a portable network graphic written by `tests/helpers/png.ts`,
// so the places the port hands out are the places those two name rather than a recording of a decode.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { qlieArgbImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { readArgbLayout } from "../../packages/formats/src/qlie/argb-image.js";
import {
	COLOUR_JPEG,
	COLOUR_PIXELS,
	GREY_JPEG,
	GREY_PIXELS,
} from "../helpers/jpeg.js";
import { pngFile } from "../helpers/png.js";

const IMAGE_AT = 0x19;

/** The picture of the engine: the head, the JPEG of the colours and the graphic of the alpha. */
function argbFile(input: {
	image: Buffer;
	mask: Buffer;
	kind?: number;
	imageLength?: number;
	maskLength?: number;
}): Buffer {
	const head = Buffer.alloc(IMAGE_AT, 0);
	head.write("ARGBSaveData1\0", 0, "latin1");
	head[0x10] = input.kind ?? 3;
	head.writeUInt32LE(input.imageLength ?? input.image.length, 0x11);
	head.writeUInt32LE(input.maskLength ?? input.mask.length, 0x15);
	return Buffer.concat([head, input.image, input.mask]);
}

/** The places of the grey picture of the fixture, with the alpha the test names. */
function greyWithAlpha(alphas: readonly (readonly number[])[]): Buffer {
	const pixels = Buffer.alloc(GREY_PIXELS.length);
	for (let place = 0; place < GREY_PIXELS.length / 4; place += 1) {
		const at = place * 4;
		pixels[at] = GREY_PIXELS[at] ?? 0;
		pixels[at + 1] = GREY_PIXELS[at + 1] ?? 0;
		pixels[at + 2] = GREY_PIXELS[at + 2] ?? 0;
		pixels[at + 3] = alphas[Math.floor(place / 8)]?.[place % 8] ?? 0;
	}
	return pixels;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await qlieArgbImageFormat.open(
		new BufferByteSource(data),
		"image.argb",
	);
	try {
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		return await consumeBuffer(await handle.openEntry(entry.id));
	} finally {
		await handle.close();
	}
}

describe("QLIE picture of an alpha and colours", () => {
	it("reads the head of the picture", () => {
		const data = argbFile({
			image: GREY_JPEG,
			mask: pngFile({ width: 8, height: 8, colourType: 0, rows: [] }),
		});
		expect(readArgbLayout(data)).toMatchObject({ width: 8, height: 8 });
		// The kind the mark stands over is three.
		expect(
			readArgbLayout(
				argbFile({ image: GREY_JPEG, mask: Buffer.alloc(0), kind: 2 }),
			),
		).toBeUndefined();
		// A head that reaches past the end of the file is turned away, as is one over no JPEG.
		expect(
			readArgbLayout(
				argbFile({
					image: GREY_JPEG,
					mask: Buffer.alloc(0),
					imageLength: 0x1000,
				}),
			),
		).toBeUndefined();
		expect(
			readArgbLayout(
				argbFile({ image: Buffer.alloc(0x40, 0x20), mask: Buffer.alloc(0) }),
			),
		).toBeUndefined();
		expect(readArgbLayout(Buffer.alloc(4, 0))).toBeUndefined();
	});

	it("names the box of the picture and lists one picture", async () => {
		const data = argbFile({
			image: GREY_JPEG,
			mask: pngFile({ width: 8, height: 8, colourType: 0, rows: [] }),
		});
		expect(
			await qlieArgbImageFormat.detect(
				new BufferByteSource(data),
				"image.argb",
			),
		).toBe(true);
		const wrong = argbFile({
			image: GREY_JPEG,
			mask: Buffer.alloc(0),
			kind: 1,
		});
		expect(
			await qlieArgbImageFormat.detect(
				new BufferByteSource(wrong),
				"image.argb",
			),
		).toBe(false);
		const handle = await qlieArgbImageFormat.open(
			new BufferByteSource(data),
			"image.argb",
		);
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual(["image.bmp"]);
			expect(handle.metadata).toMatchObject({
				width: 8,
				height: 8,
				bitsPerPixel: 32,
			});
		} finally {
			await handle.close();
		}
	});

	it("joins the grey places of the colours with the grey places of the graphic", async () => {
		const rows = [
			[0, 1, 2, 3, 4, 5, 6, 7],
			[8, 9, 10, 11, 12, 13, 14, 15],
			[16, 17, 18, 19, 20, 21, 22, 23],
			[24, 25, 26, 27, 28, 29, 30, 31],
			[32, 33, 34, 35, 36, 37, 38, 39],
			[40, 41, 42, 43, 44, 45, 46, 47],
			[48, 49, 50, 51, 52, 53, 54, 55],
			[56, 57, 58, 59, 60, 61, 62, 63],
		];
		const data = argbFile({
			image: GREY_JPEG,
			mask: pngFile({ width: 8, height: 8, colourType: 0, rows }),
		});
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		expect(image).toMatchObject({ width: 8, height: 8, bitsPerPixel: 32 });
		expect([...image.pixels]).toEqual([...greyWithAlpha(rows)]);
	});

	it("takes the alpha of a colour graphic as its brightness", async () => {
		// The reference reads such a graphic as a picture of one grey place a pixel, which this port takes as
		// the brightness of the place: a fifth of the red, three fifths of the green and a tenth of the blue.
		const colours = [
			[0, 0, 255],
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[255, 255, 255],
		];
		const rows = Array.from({ length: 8 }, () => colours.flat());
		const data = argbFile({
			image: GREY_JPEG,
			mask: pngFile({ width: 8, height: 8, colourType: 2, rows }),
		});
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		const alphas = rows.map(() =>
			colours.map(([red, green, blue]) =>
				Math.round(
					0.299 * (red ?? 0) + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0),
				),
			),
		);
		expect([...image.pixels]).toEqual([...greyWithAlpha(alphas)]);
	});

	it("joins the colours of a picture of three components within a place", async () => {
		const rows = Array.from({ length: 16 }, () => new Array(16).fill(0xc0));
		const data = argbFile({
			image: COLOUR_JPEG,
			mask: pngFile({ width: 16, height: 16, colourType: 0, rows }),
		});
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		let worst = 0;
		for (let at = 0; at < COLOUR_PIXELS.length; at += 1) {
			if (3 === at % 4) {
				expect(image.pixels[at]).toBe(0xc0);
				continue;
			}
			worst = Math.max(
				worst,
				Math.abs((COLOUR_PIXELS[at] ?? 0) - (image.pixels[at] ?? 0)),
			);
		}
		expect(worst).toBeLessThanOrEqual(2);
	});

	it("turns away a graphic of another box than the colours", async () => {
		const data = argbFile({
			image: GREY_JPEG,
			mask: pngFile({ width: 4, height: 4, colourType: 0, rows: [] }),
		});
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("turns away a graphic that is no graphic", async () => {
		const data = argbFile({
			image: GREY_JPEG,
			mask: Buffer.from("not a graphic", "latin1"),
		});
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("turns away a picture whose colours stand in no JPEG", async () => {
		// The head names a picture, but the stream behind it is no stream of the format.
		const data = argbFile({
			image: Buffer.alloc(0x100, 0x11),
			mask: pngFile({ width: 8, height: 8, colourType: 0, rows: [] }),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
	});
});
