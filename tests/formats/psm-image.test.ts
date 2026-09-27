import { BufferByteSource } from "@garbro-mcp/core";
import { psmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { pngFile } from "../helpers/png.js";

const IHDR_END = 0x21;

interface Built {
	file: Buffer;
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
}

/** Builds an obfuscated PNG: the replaced signature byte and a real IHDR chunk. */
function buildPsm(
	width = 0x40,
	height = 0x30,
	bitDepth = 8,
	colorType = 6,
): Built {
	const file: Buffer = Buffer.alloc(IHDR_END + 4, 0x22);
	Buffer.from([0xed, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(file, 0);
	file.writeUInt32BE(13, 8);
	file.write("IHDR", 12, "latin1");
	file.writeUInt32BE(width, 16);
	file.writeUInt32BE(height, 20);
	file[24] = bitDepth;
	file[25] = colorType;
	file.writeUInt32BE(0xa1b2c3d4, 29);
	return { file, width, height, bitDepth, colorType };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("obfuscated png image", () => {
	it("declares the obfuscated signature for the registry", () => {
		expect(psmImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0xed, 0x50, 0x4e, 0x47]) },
		]);
	});

	it("restores the signature byte and keeps the rest verbatim", async () => {
		const built = buildPsm();
		const source = sourceOf(built.file);
		expect(await psmImageFormat.detect(source, "CG01.PSM")).toBe(true);
		const archive = await psmImageFormat.open(source, "CG01.PSM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.png"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x40,
				height: 0x30,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "png",
				encrypted: true,
				width: 0x40,
				height: 0x30,
			});
			// The places of a whole graphic stand read of the walk of the pictures of this project, behind
			// the word of the signature the walk of the file restores.
		} finally {
			await archive.close();
		}
	});

	it("reads the places of a whole picture of the kind of its head", async () => {
		// A whole graphic of two pixels to a row and one row, of the obfuscated kind: the first word of its
		// signature stands of the word the format stores instead.
		const graphic = pngFile({
			width: 2,
			height: 1,
			colourType: 2,
			rows: [[10, 20, 30, 40, 50, 60]],
		});
		const file = Buffer.from(graphic);
		file[0] = 0xed;
		const archive = await psmImageFormat.open(sourceOf(file), "CG02.PSM");
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		const picture = readBmpImage(
			await consumeBuffer(await archive.openEntry(entry.id)),
		);
		expect(picture).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
		});
		expect([...(picture?.pixels ?? [])]).toEqual([30, 20, 10, 60, 50, 40]);
	});

	it("derives the bit depth from the colour type", async () => {
		// A palette image has one channel, a truecolour one has three.
		const palette = buildPsm(0x10, 0x10, 4, 3);
		expect(await psmImageFormat.detect(sourceOf(palette.file), "A.PSM")).toBe(
			true,
		);
		const first = await psmImageFormat.open(sourceOf(palette.file), "A.PSM");
		try {
			expect(first.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 4 });
		} finally {
			await first.close();
		}
		const rgb = buildPsm(0x20, 0x10, 8, 2);
		const second = await psmImageFormat.open(sourceOf(rgb.file), "B.PSM");
		try {
			expect(second.entries[0]?.metadata).toMatchObject({
				bitsPerPixel: 24,
			});
		} finally {
			await second.close();
		}
	});

	it("declines an unobfuscated png", async () => {
		const { file } = buildPsm();
		file[0] = 0x89;
		expect(await psmImageFormat.detect(sourceOf(file), "CG01.PSM")).toBe(false);
	});

	it("declines a broken png signature", async () => {
		const { file } = buildPsm();
		file[5] = 0x0b;
		expect(await psmImageFormat.detect(sourceOf(file), "CG01.PSM")).toBe(false);
	});

	it("declines a file whose first chunk is not the header", async () => {
		const { file } = buildPsm();
		file.write("IDAT", 12, "latin1");
		expect(await psmImageFormat.detect(sourceOf(file), "CG01.PSM")).toBe(false);
	});

	it("declines a zero dimension", async () => {
		const { file } = buildPsm();
		file.writeUInt32BE(0, 20);
		expect(await psmImageFormat.detect(sourceOf(file), "CG01.PSM")).toBe(false);
	});

	it("declines a file shorter than a header chunk", async () => {
		const { file } = buildPsm();
		expect(
			await psmImageFormat.detect(
				sourceOf(file.subarray(0, IHDR_END - 1)),
				"CG01.PSM",
			),
		).toBe(false);
	});
});
