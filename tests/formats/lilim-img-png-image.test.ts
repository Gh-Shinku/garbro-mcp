import { BufferByteSource } from "@garbro-mcp/core";
import {
	deobfuscateLilim,
	imgPngImageFormat,
	prgImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { pngFile } from "../helpers/png.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { readPngImage } from "../../packages/formats/src/shared/png-image.js";

const PREFIX = 0x20;

interface PngOptions {
	width?: number;
	height?: number;
	depth?: number;
	colourType?: number;
	tail?: boolean;
}

function chunk(type: string, body: Buffer): Buffer {
	const length: Buffer = Buffer.alloc(4);
	length.writeUInt32BE(body.length, 0);
	return Buffer.concat([
		length,
		Buffer.from(type, "latin1"),
		body,
		Buffer.alloc(4, 0xaa),
	]);
}

function buildPng(options: PngOptions = {}): Buffer {
	const ihdr: Buffer = Buffer.alloc(13, 0x00);
	ihdr.writeUInt32BE(options.width ?? 8, 0);
	ihdr.writeUInt32BE(options.height ?? 4, 4);
	ihdr[8] = options.depth ?? 8;
	ihdr[9] = options.colourType ?? 6;
	const parts: Buffer[] = [
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
	];
	if (options.tail !== false) {
		parts.push(chunk("IDAT", Buffer.alloc(6, 0x78)));
		parts.push(chunk("IEND", Buffer.alloc(0)));
	}
	return Buffer.concat(parts);
}

/** The stored file is the graphic with its first thirty two bytes xored; the tail is untouched. */

/** A whole portable network graphic of the four places of a colour a place. */
function realPng(): Buffer {
	const rows = [
		Array.from({ length: 3 * 4 }, (_, at) => (at * 7 + 3) & 0xff),
		Array.from({ length: 3 * 4 }, (_, at) => (at * 11 + 5) & 0xff),
	];
	return pngFile({ width: 3, height: 2, colourType: 6, rows });
}

/** The same graphic read through the reader of the other obfuscated format. */
async function extractRegrips(file: Buffer): Promise<Buffer> {
	const archive = await prgImageFormat.open(sourceOf(file), "A.prg");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

function buildImg(png: Buffer): Buffer {
	return deobfuscateLilim(png);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.img"): Promise<Buffer> {
	const archive = await imgPngImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Lilim obfuscated image", () => {
	it("obfuscates only the first thirty two bytes", async () => {
		const png = buildPng();
		const img = buildImg(png);
		expect(
			img
				.subarray(0, PREFIX)
				.equals(png.subarray(0, PREFIX).map((x) => x ^ 0xff)),
		).toBe(true);
		// Everything behind the prefix is the graphic's own bytes: the format hides a header, not a body.
		expect(img.subarray(PREFIX).equals(png.subarray(PREFIX))).toBe(true);
		expect(await imgPngImageFormat.detect(sourceOf(img), "A.img")).toBe(true);
	});

	it("probes the deobfuscated header", async () => {
		expect(
			await imgPngImageFormat.detect(sourceOf(buildImg(buildPng())), "A.img"),
		).toBe(true);
		// A plain graphic is not this format, and neither is a file too short to hold a header.
		expect(await imgPngImageFormat.detect(sourceOf(buildPng()), "A.img")).toBe(
			false,
		);
		expect(
			await imgPngImageFormat.detect(
				sourceOf(buildImg(buildPng()).subarray(0, 28)),
				"A.img",
			),
		).toBe(false);
		// Nor is a file whose deobfuscated header names no known colour type.
		const odd = buildPng({ colourType: 7 });
		expect(
			await imgPngImageFormat.detect(sourceOf(buildImg(odd)), "A.img"),
		).toBe(false);
	});

	it("shares its stored signature with the Regrips graphic, as the reference does", async () => {
		// Both formats store the graphic's signature xored and both read the header from their own
		// deobfuscation. Since the header lies entirely within the first thirty two bytes, each reader sees a
		// readable header in the other's file: the reference draws no distinction, and neither does the port.
		const lilim = buildImg(buildPng());
		expect(await prgImageFormat.detect(sourceOf(lilim), "A.img")).toBe(true);
		const regrips: Buffer = Buffer.from(buildPng().map((x) => x ^ 0xff));
		expect(await imgPngImageFormat.detect(sourceOf(regrips), "A.img")).toBe(
			true,
		);
		// What tells them apart is where the obfuscation stops, which the extraction is faithful to: the body of
		// this format stands alone, so both readers stand before the same graphic and hand the same places of
		// the picture over.
		const real = realPng();
		const fromLilim = readBmpImage(await extract(buildImg(real)));
		const fromRegrips = readBmpImage(
			await extractRegrips(Buffer.from(real.map((x) => x ^ 0xff))),
		);
		expect(fromLilim).not.toBeUndefined();
		expect([...(fromLilim?.pixels ?? [])]).toEqual([
			...(fromRegrips?.pixels ?? []),
		]);
	});

	it("maps the colour type and the bit depth the way the reference does", async () => {
		for (const [depth, colourType, bitsPerPixel] of [
			[8, 6, 32],
			[16, 2, 48],
			[1, 3, 24],
			[4, 4, 8],
		] as [number, number, number][]) {
			const archive = await imgPngImageFormat.open(
				sourceOf(buildImg(buildPng({ depth, colourType }))),
				"A.img",
			);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					bitsPerPixel,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("reads the places of the picture the graphic holds", async () => {
		const png = realPng();
		const output = await extract(buildImg(png));
		const picture = readBmpImage(output);
		const expected = await readPngImage(png);
		expect(picture).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 32,
		});
		expect(expected).not.toBeUndefined();
		expect([...(picture?.pixels ?? [])]).toEqual([...(expected?.pixels ?? [])]);
	});

	it("names the entry after the graphic, with its size and its depth", async () => {
		const archive = await imgPngImageFormat.open(
			sourceOf(buildImg(buildPng({ width: 6, height: 5 }))),
			"sub/CG_06.img",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_06.png");
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 6,
				height: 5,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});
});
