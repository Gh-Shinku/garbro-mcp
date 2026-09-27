import { BufferByteSource } from "@garbro-mcp/core";
import { mgfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { pngFile } from "../helpers/png.js";

const SIGNATURE = Buffer.from([0x4d, 0x61, 0x6c, 0x69]);
const TAG = Buffer.from("MalieGF\0", "latin1");

/** The places of the file of a picture of a colour of the places of the picture of the format of the two of them. */
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
			const red = (x * 13 + y * 5) & 0xff;
			const green = (y * 29) & 0xff;
			const blue = (x * 47) & 0xff;
			const alpha = 0x20 + ((x * 3 + y) & 0x5f);
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

/** A picture of no places of the file of the picture of the colour of the picture, which no walk reads. */
function zeroPicture(): Buffer {
	return pngFile({
		width: 0,
		height: 4,
		colourType: 6,
		rows: [[], [], [], []],
	});
}

/** The engine's file: the tag in place of the PNG signature, everything else identical. */
function buildMgf(png: Buffer): Buffer {
	return Buffer.concat([TAG, png.subarray(8)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await mgfImageFormat.open(sourceOf(stored), "CG01.MGF");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("malie mgf image", () => {
	it("declares the Mali signature and no extension", () => {
		expect(mgfImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("Mali");
		expect(mgfImageFormat.descriptor.extensions).toEqual([]);
	});

	it("decodes the restored png into a bitmap", async () => {
		const { png, expected } = picture(7, 5);
		const stored = buildMgf(png);
		const source = sourceOf(stored);
		expect(await mgfImageFormat.detect(source, "CG01.MGF")).toBe(true);
		const archive = await mgfImageFormat.open(source, "CG01.MGF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// Eight bytes are replaced by eight bytes, so the entry has the stored length.
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 7,
				height: 5,
				bitsPerPixel: 32,
				tag: "MalieGF",
				prefixSize: 8,
			});
		} finally {
			await archive.close();
		}
		const image = readBmpImage(await extract(stored));
		if (!image) throw new Error("no bitmap");
		expect(image.width).toBe(7);
		expect(image.height).toBe(5);
		expect(image.pixels.toString("hex")).toBe(expected.toString("hex"));
	});

	it("reports the dimensions of the picture and the depth of the picture of the web", async () => {
		const width = 31;
		const height = 13;
		const rows: number[][] = [];
		for (let y = 0; y < height; y += 1) {
			const row: number[] = [];
			// Sixteen places of a colour per channel, four channels.
			for (let x = 0; x < width * 4 * 2; x += 1)
				row.push((x * 7 + y * 3) & 0xff);
			rows.push(row);
		}
		const stored = buildMgf(
			pngFile({ width, height, colourType: 6, depth: 16, rows }),
		);
		const archive = await mgfImageFormat.open(sourceOf(stored), "CG01.MGF");
		try {
			expect(archive.metadata).toMatchObject({
				width,
				height,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width,
				height,
				bitsPerPixel: 32,
				storedBitsPerPixel: 64,
			});
		} finally {
			await archive.close();
		}
	});

	it("maps the color types of the stored png to a pixel depth", async () => {
		const cases: Array<[number, number, number, number]> = [
			[0, 1, 8, 24],
			[2, 3, 24, 24],
			[4, 2, 16, 32],
			[6, 4, 32, 32],
		];
		for (const [colourType, channels, stored, depth] of cases) {
			const width = 3;
			const rows: number[][] = [];
			for (let y = 0; y < 2; y += 1) {
				const row: number[] = [];
				for (let x = 0; x < width * channels; x += 1)
					row.push((x * 23 + y * 5) & 0xff);
				rows.push(row);
			}
			const archive = await mgfImageFormat.open(
				sourceOf(buildMgf(pngFile({ width, height: 2, colourType, rows }))),
				"CG01.MGF",
			);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: depth,
					storedBitsPerPixel: stored,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("does not check the eighth byte of the tag", async () => {
		// `AsciiEqual` compares the seven characters of `MalieGF`, so whatever follows them is accepted even
		// though the reference's own writer puts a zero there.
		const stored = buildMgf(picture(4, 4).png);
		stored[7] = 0xff;
		const source = sourceOf(stored);
		expect(await mgfImageFormat.detect(source, "CG01.MGF")).toBe(true);
		const image = readBmpImage(await extract(stored));
		expect(image?.width).toBe(4);
	});

	it("declines a tag that is not the engine's", async () => {
		const stored = buildMgf(picture(4, 4).png);
		stored[6] = 0x47;
		expect(await mgfImageFormat.detect(sourceOf(stored), "CG01.MGF")).toBe(
			false,
		);
	});

	it("declines a body that is not a png", async () => {
		const png = picture(4, 4).png;
		const wrongLength = buildMgf(png);
		wrongLength.writeUInt32BE(12, 8);
		expect(await mgfImageFormat.detect(sourceOf(wrongLength), "CG01.MGF")).toBe(
			false,
		);
		const wrongType = buildMgf(png);
		wrongType.write("IHXR", 12, "latin1");
		expect(await mgfImageFormat.detect(sourceOf(wrongType), "CG01.MGF")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		const stored = buildMgf(picture(4, 4).png);
		expect(
			await mgfImageFormat.detect(sourceOf(stored.subarray(0, 25)), "CG01.MGF"),
		).toBe(false);
		const zero = buildMgf(zeroPicture());
		expect(await mgfImageFormat.detect(sourceOf(zero), "CG01.MGF")).toBe(false);
	});
});
