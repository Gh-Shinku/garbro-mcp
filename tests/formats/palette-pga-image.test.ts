import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { pgaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { pngFile } from "../helpers/png.js";

const SIGNATURE = Buffer.from("PGAP", "ascii");
const KEY = Buffer.from("PGAECODE", "ascii");
const PREFIX_SIZE = 11;
const HEADER_SIZE = 26;

/** The reference's writer: three tag bytes, eight obfuscated bytes, then the body from offset sixteen. */
function obfuscate(png: Buffer): Buffer {
	const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x00);
	prefix.write("PGA", 0, "latin1");
	for (let i = 0; i < KEY.length; i += 1)
		prefix[3 + i] = (png[8 + i] ?? 0) ^ (KEY[i] ?? 0);
	return Buffer.concat([prefix, png.subarray(16)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The places of the file of a picture of a colour of the places of the picture of the format of the two of them of
 * twenty four places of a colour, of the places of the file of the picture of the format of the numbers of the
 * picture, of the places of the file: the walk of the project stands of the counts of the head of the format of the
 * picture of the places of the file of the format of the two of them. */
function picture(
	width: number,
	height: number,
): {
	png: Buffer;
	expected: Buffer;
} {
	const rows: number[][] = [];
	const expected = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		const row: number[] = [];
		for (let x = 0; x < width; x += 1) {
			const red = (x * 31 + y * 7) & 0xff;
			const green = (x * 11) & 0xff;
			const blue = (y * 53) & 0xff;
			const alpha = 0x40 + ((x + y) & 0x3f);
			row.push(red, green, blue, alpha);
			const at = (y * width + x) * 4;
			expected[at] = blue;
			expected[at + 1] = green;
			expected[at + 2] = red;
			expected[at + 3] = alpha;
		}
		rows.push(row);
	}
	return {
		png: pngFile({ width, height, colourType: 6, rows }),
		expected,
	};
}

describe("palette pga image", () => {
	it("declares the PGAP signature and no extension", () => {
		expect(pgaImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("PGAP");
		expect(pgaImageFormat.descriptor.extensions).toEqual([]);
	});

	it("decodes the restored png into a bitmap", async () => {
		const { png, expected } = picture(9, 4);
		const stored = obfuscate(png);
		expect(await pgaImageFormat.detect(sourceOf(stored), "CG01.PGA")).toBe(
			true,
		);
		const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			// Eleven stored bytes become a sixteen byte PNG header, so the extraction is longer than the
			// source.
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 9,
				height: 4,
				bitsPerPixel: 32,
				obfuscation: "PGAECODE",
				prefixSize: PREFIX_SIZE,
			});
		} finally {
			await archive.close();
		}
		const image = readBmpImage(await extract(stored));
		if (!image) throw new Error("no bitmap");
		expect(image.width).toBe(9);
		expect(image.height).toBe(4);
		expect(image.pixels.toString("hex")).toBe(expected.toString("hex"));
	});

	it("has a P as the fourth byte because the chunk length starts with a zero", async () => {
		const stored = obfuscate(picture(3, 3).png);
		expect(stored.subarray(0, 4)).toEqual(SIGNATURE);
		// The fourth byte is the `IHDR` length's top byte, which is zero, exclusive orred with `P`.
		expect(stored[3]).toBe(0x00 ^ 0x50);
	});

	it("reports the depth of the stored png beside the depth of the bitmap", async () => {
		const cases: Array<[number, number, number]> = [
			[0, 8, 24],
			[2, 8, 24],
			[4, 8, 32],
			[6, 8, 32],
		];
		for (const [colourType, stored, depth] of cases) {
			const channels = (
				0 === colourType ? 1 : 4 === colourType ? 2 : 6 === colourType ? 4 : 3
			) as 1 | 2 | 3 | 4;
			const width = 3;
			const rows: number[][] = [];
			for (let y = 0; y < 2; y += 1) {
				const row: number[] = [];
				for (let x = 0; x < width * channels; x += 1)
					row.push((x * 17 + y) & 0xff);
				rows.push(row);
			}
			const png = pngFile({ width, height: 2, colourType, rows });
			const archive = await pgaImageFormat.open(
				sourceOf(obfuscate(png)),
				"CG01.PGA",
			);
			try {
				expect(archive.metadata).toMatchObject({ bitsPerPixel: depth });
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					width,
					height: 2,
					bitsPerPixel: depth,
					storedBitsPerPixel: stored * channels,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("reads a sixty four place png into a bitmap of thirty two places", async () => {
		const width = 3;
		const rows: number[][] = [];
		for (let y = 0; y < 2; y += 1) {
			const row: number[] = [];
			for (let x = 0; x < width * 4 * 2; x += 1) row.push((x * 9 + y) & 0xff);
			rows.push(row);
		}
		const stored = obfuscate(
			pngFile({ width, height: 2, colourType: 6, depth: 16, rows }),
		);
		const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 32 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				bitsPerPixel: 32,
				storedBitsPerPixel: 64,
			});
		} finally {
			await archive.close();
		}
		const image = readBmpImage(await extract(stored));
		expect(image?.bitsPerPixel).toBe(32);
	});

	it("declines a wrong tag and an unrestorable header", async () => {
		const stored = obfuscate(picture(4, 4).png);
		const wrongTag = Buffer.from(stored);
		wrongTag[2] = 0x58;
		expect(await pgaImageFormat.detect(sourceOf(wrongTag), "CG01.PGA")).toBe(
			false,
		);
		// A wrong key leaves the chunk length and type unreadable.
		const wrongKey = Buffer.from(stored);
		wrongKey[3] = (wrongKey[3] ?? 0) ^ 0xff;
		expect(await pgaImageFormat.detect(sourceOf(wrongKey), "CG01.PGA")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		const stored = obfuscate(picture(4, 4).png);
		expect(
			await pgaImageFormat.detect(
				sourceOf(stored.subarray(0, HEADER_SIZE - 1)),
				"CG01.PGA",
			),
		).toBe(false);
		const zero = Buffer.from(stored);
		// The file stands five bytes behind the restored picture, and the width of the `IHDR` chunk stands sixteen
		// bytes into it.
		const widthAt = 16 - 5;
		zero[widthAt] = 0;
		zero[widthAt + 1] = 0;
		zero[widthAt + 2] = 0;
		zero[widthAt + 3] = 0;
		expect(await pgaImageFormat.detect(sourceOf(zero), "CG01.PGA")).toBe(false);
	});

	it("turns away a body that stands of no walk of its own", async () => {
		const stored = obfuscate(picture(4, 4).png);
		// The places of the file of the picture of the format of the two of them stand of no counts of the head of
		// the format of the picture of the places of the file.
		const broken = Buffer.from(stored);
		broken.fill(0x11, PREFIX_SIZE + 28, PREFIX_SIZE + 40);
		await expect(extract(broken)).rejects.toThrow(GarbroError);
	});
});
