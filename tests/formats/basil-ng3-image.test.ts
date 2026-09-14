import { BufferByteSource } from "@garbro-mcp/core";
import { basilNg3ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x0c;
const PALETTE_ENTRIES = 0x100;

/** A palette of colour triples: index i is blue i, green 255 - i, red 0x40. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_ENTRIES * 3, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		palette[index * 3] = index;
		palette[index * 3 + 1] = 0xff - index;
		palette[index * 3 + 2] = 0x40;
	}
	return palette;
}

interface Ng3Options {
	width?: number;
	height?: number;
	/** The pixel stream, one token after another. */
	stream?: Buffer;
	palette?: Buffer;
	marker?: Buffer;
	/** Trims the file, which can cut the palette or the stream short. */
	truncate?: number;
}

function buildNg3(options: Ng3Options = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	(options.marker ?? Buffer.from([0x4e, 0x47, 0x33, 0x00])).copy(header, 0);
	header.writeUInt32LE(options.width ?? 2, 4);
	header.writeUInt32LE(options.height ?? 1, 8);
	const file = Buffer.concat([
		header,
		options.palette ?? buildPalette(),
		options.stream ?? Buffer.alloc(0),
	]);
	return options.truncate
		? file.subarray(0, Math.max(0, file.length - options.truncate))
		: file;
}

/**
 * A raw triple. There is no control byte in front of one: the reference peeks, and only a byte of one or two
 * starts a token, so a raw pixel's first byte has to be anything else.
 */
function rawPixel(pixel: number[]): number[] {
	return pixel;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.ng3"): Promise<Buffer> {
	const archive = await basilNg3ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("BasiL image", () => {
	it("needs the whole marker word and a full header", async () => {
		expect(
			await basilNg3ImageFormat.detect(sourceOf(buildNg3()), "A.ng3"),
		).toBe(true);
		// The reference compares a little endian word, so a fourth byte that is not a null is another file.
		expect(
			await basilNg3ImageFormat.detect(
				sourceOf(buildNg3({ marker: Buffer.from("NG3X", "latin1") })),
				"A.ng3",
			),
		).toBe(false);
		expect(
			await basilNg3ImageFormat.detect(
				sourceOf(buildNg3({ marker: Buffer.from("NG2\0", "latin1") })),
				"A.ng3",
			),
		).toBe(false);
		expect(
			await basilNg3ImageFormat.detect(
				sourceOf(Buffer.from("NG3\0", "latin1")),
				"A.ng3",
			),
		).toBe(false);
	});

	it("reads raw triples from the palette", async () => {
		const stream = Buffer.from([
			...rawPixel([0x10, 0x11, 0x12]),
			...rawPixel([0x20, 0x21, 0x22]),
		]);
		const output = await extract(buildNg3({ width: 2, height: 1, stream }));
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands this image over flipped, so the bitmap's height is positive.
		expect(output.readInt32LE(22)).toBe(1);
		expect(output.subarray(54, 60)).toEqual(
			Buffer.from([0x10, 0x11, 0x12, 0x20, 0x21, 0x22]),
		);
	});

	it("reads a byte of one as a token even where a colour would start with it", async () => {
		// Nothing separates a raw triple from a token, so a colour whose first byte is one or two cannot be
		// stored raw: the reader takes that byte as the token and the next one as a palette index.
		const stream = Buffer.from([0x01, 0x05, 0xaa, 0xbb]);
		const output = await extract(buildNg3({ width: 2, height: 1, stream }));
		expect(output.subarray(54, 60)).toEqual(
			Buffer.from([0x05, 0xfa, 0x40, 0xaa, 0xbb, 0x00]),
		);
	});

	it("takes a colour out of the palette for one pixel", async () => {
		const stream = Buffer.from([0x01, 0x03]);
		const output = await extract(buildNg3({ width: 1, height: 1, stream }));
		expect(output.subarray(54, 57)).toEqual(Buffer.from([0x03, 0xfc, 0x40]));
	});

	it("repeats a palette colour for a run", async () => {
		const stream = Buffer.from([0x02, 0x02, 0x03]);
		const output = await extract(buildNg3({ width: 3, height: 1, stream }));
		// Row padding puts the fourth byte behind the three pixels.
		expect(output.subarray(54, 63)).toEqual(
			Buffer.from([0x02, 0xfd, 0x40, 0x02, 0xfd, 0x40, 0x02, 0xfd, 0x40]),
		);
	});

	it("stops at the end of a stream and leaves the rest black", async () => {
		// One triple only, for an image that wants four.
		const stream = Buffer.from(rawPixel([0x09, 0x08, 0x07]));
		const output = await extract(buildNg3({ width: 2, height: 2, stream }));
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([0x09, 0x08, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("refuses a run that would run past the image", async () => {
		const stream = Buffer.from([0x02, 0x01, 0xff]);
		await expect(
			extract(buildNg3({ width: 2, height: 1, stream })),
		).rejects.toThrow();
	});

	it("refuses a file whose palette is cut short", async () => {
		await expect(extract(buildNg3({ truncate: 4 }))).rejects.toThrow();
	});

	it("refuses an image with no pixels to place", async () => {
		expect(
			await basilNg3ImageFormat.detect(
				sourceOf(buildNg3({ width: 0 })),
				"A.ng3",
			),
		).toBe(true);
		await expect(extract(buildNg3({ width: 0 }))).rejects.toThrow();
	});

	it("names the entry after the bitmap and describes it", async () => {
		const archive = await basilNg3ImageFormat.open(
			sourceOf(buildNg3({ width: 7, height: 3 })),
			"sub/CG_07.ng3",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 7,
				height: 3,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});
});
