import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { gameresTiffImageFormat } from "../../packages/formats/src/gameres/tiff-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	COLOUR_TIFF,
	GREY_TIFF,
	GREY_TIFF_PLACES,
	PALETTE_TIFF,
	SIXTEEN_TIFF,
} from "../helpers/tiff.js";

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const archive = await gameresTiffImageFormat.open(
		sourceOf(data),
		"CG_01.tif",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("the tagged image file of the resource list", () => {
	it("names the two heads of the format and its two names", () => {
		expect(gameresTiffImageFormat.descriptor.id).toBe("gameres-tiff-image");
		expect(gameresTiffImageFormat.descriptor.extensions).toEqual([
			"tif",
			"tiff",
		]);
		expect(gameresTiffImageFormat.detection?.signatures?.length).toBe(2);
	});

	it("finds a picture by either of the two heads", async () => {
		expect(
			await gameresTiffImageFormat.detect(sourceOf(GREY_TIFF), "A.tif"),
		).toBe(true);
		expect(
			await gameresTiffImageFormat.detect(
				sourceOf(Buffer.from("not a picture", "latin1")),
				"A.tif",
			),
		).toBe(false);
	});

	it("reads the head of the picture and lists it", async () => {
		const archive = await gameresTiffImageFormat.open(
			sourceOf(GREY_TIFF),
			"CG_01.tif",
		);
		try {
			expect(archive.entries[0]?.path).toBe("image.bmp");
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 4,
				height: 3,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
	});

	it("reads the places of the picture of every kind of its own", async () => {
		const grey = readBmpImage(await extract(GREY_TIFF));
		expect(grey).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8 });
		expect([...(grey?.pixels ?? [])]).toEqual([...GREY_TIFF_PLACES]);
		const colour = readBmpImage(await extract(COLOUR_TIFF));
		expect(colour).toMatchObject({ width: 3, height: 2, bitsPerPixel: 24 });
		const palette = readBmpImage(await extract(PALETTE_TIFF));
		expect(palette).toMatchObject({ width: 4, height: 2, bitsPerPixel: 8 });
		expect([...(palette?.pixels ?? [])]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		const sixteen = readBmpImage(await extract(SIXTEEN_TIFF));
		expect([...(sixteen?.pixels ?? [])]).toEqual([
			0x12, 0x56, 0x9a, 0xde, 0x11, 0x22,
		]);
	});

	it("turns a file whose counts stand outside it away", async () => {
		const broken = Buffer.from(GREY_TIFF);
		broken.writeUInt32LE(0xffff, 4);
		expect(await gameresTiffImageFormat.detect(sourceOf(broken), "A.tif")).toBe(
			false,
		);
		await expect(
			gameresTiffImageFormat.open(sourceOf(broken), "A.tif"),
		).rejects.toThrow();
	});
});
