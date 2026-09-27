import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { gameresWebpImageFormat } from "../../packages/formats/src/gameres/webp-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	ALPHA_FILTER_BGRA,
	ALPHA_FILTER_WEBP,
	ALPHA_GRADIENT_BGRA,
	ALPHA_GRADIENT_WEBP,
	ALPHA_LEVEL_BGRA,
	ALPHA_LEVEL_WEBP,
	ALPHA_LOSSLESS_BGRA,
	ALPHA_LOSSLESS_WEBP,
	ALPHA_ODD_BGRA,
	ALPHA_ODD_WEBP,
	ALPHA_VERTICAL_BGRA,
	ALPHA_VERTICAL_WEBP,
	GRADIENT_WEBP,
	GRADIENT_WEBP_PLACES,
	MULTI_PARTITION_BGRA,
	MULTI_PARTITION_WEBP,
	PLACES_BGRA,
	PLACES_WEBP,
	SOLID_BGRA,
	SOLID_WEBP,
} from "../helpers/webp.js";

/** Opens a WebP file through the format, writes the bitmap and reads back its places of the file. */
async function pictureOf(
	file: Buffer,
): Promise<{ width: number; height: number; pixels: Buffer; path: string }> {
	const source = new BufferByteSource(file);
	expect(await gameresWebpImageFormat.detect(source, "image.webp")).toBe(true);
	const archive = await gameresWebpImageFormat.open(source, "image.webp");
	const entry = archive.entries[0];
	if (!entry) throw new Error("no entry");
	const output = await consumeBuffer(await archive.openEntry(entry.id));
	const image = readBmpImage(output);
	if (!image) throw new Error("no bitmap");
	return {
		width: image.width,
		height: image.height,
		pixels: image.pixels,
		path: entry.path,
	};
}

describe("the picture of the web of the walk of the places of the picture", () => {
	it("stands of the counts of the head of the format of the picture of the web of the head of the format", async () => {
		expect(
			await gameresWebpImageFormat.detect(
				new BufferByteSource(Buffer.from("RIFF....WEBQ")),
				"image.webp",
			),
		).toBe(false);
		expect(
			await gameresWebpImageFormat.detect(
				new BufferByteSource(Buffer.alloc(4)),
				"image.webp",
			),
		).toBe(false);
	});

	it("names one bitmap of the size of the picture of no counts of the places of the file", async () => {
		const picture = await pictureOf(GRADIENT_WEBP);
		expect(picture.path).toBe("image.bmp");
		expect(picture.width).toBe(16);
		expect(picture.height).toBe(12);
		expect([...picture.pixels]).toEqual(GRADIENT_WEBP_PLACES);
	});

	it("writes the places of the file of a picture of the colour of the picture", async () => {
		const picture = await pictureOf(SOLID_WEBP);
		expect(picture.width).toBe(16);
		expect(picture.height).toBe(16);
		expect(picture.pixels.toString("hex")).toBe(SOLID_BGRA.toString("hex"));
	});

	it("writes the places of the file of a picture of the counts of the head of the format of the places of the file of four of them", async () => {
		const picture = await pictureOf(MULTI_PARTITION_WEBP);
		expect(picture.width).toBe(64);
		expect(picture.height).toBe(48);
		expect(picture.pixels.toString("hex")).toBe(
			MULTI_PARTITION_BGRA.toString("hex"),
		);
	});

	it("writes the places of the file of the colour of the picture of the places of the picture of the head of the format of the picture of the web", async () => {
		const cases: [number, number, Buffer, Buffer][] = [
			[4, 3, PLACES_WEBP, PLACES_BGRA],
			[24, 20, ALPHA_LOSSLESS_WEBP, ALPHA_LOSSLESS_BGRA],
			[24, 20, ALPHA_FILTER_WEBP, ALPHA_FILTER_BGRA],
			[24, 20, ALPHA_LEVEL_WEBP, ALPHA_LEVEL_BGRA],
			[24, 20, ALPHA_VERTICAL_WEBP, ALPHA_VERTICAL_BGRA],
			[24, 20, ALPHA_GRADIENT_WEBP, ALPHA_GRADIENT_BGRA],
			[5, 7, ALPHA_ODD_WEBP, ALPHA_ODD_BGRA],
		];
		for (const [width, height, file, bgra] of cases) {
			const picture = await pictureOf(file);
			expect(picture.width).toBe(width);
			expect(picture.height).toBe(height);
			expect(picture.pixels.toString("hex")).toBe(bgra.toString("hex"));
		}
	});

	it("turns away the places of the picture of the colour of the picture of the places of the file of their own", async () => {
		const moved = Buffer.from(SOLID_WEBP);
		moved.write("ANIM", 12, "latin1");
		const source = new BufferByteSource(moved);
		await expect(
			gameresWebpImageFormat.open(source, "image.webp"),
		).rejects.toThrow(GarbroError);
	});
});
