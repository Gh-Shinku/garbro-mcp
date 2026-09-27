import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { gameresWebpImageFormat } from "../../packages/formats/src/gameres/webp-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	GRADIENT_WEBP,
	GRADIENT_WEBP_PLACES,
	MULTI_PARTITION_BGRA,
	MULTI_PARTITION_WEBP,
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

	it("turns away a picture whose counts of the places of the file of the colour of the picture stand of their own", async () => {
		const source = new BufferByteSource(PLACES_WEBP);
		const archive = await gameresWebpImageFormat.open(source, "image.webp");
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
	});
});
