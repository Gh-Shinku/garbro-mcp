import { BufferByteSource } from "@garbro-mcp/core";
import { lpgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1c;
const PALETTE_ENTRIES = 256;
const DATA_OFFSET = HEADER_SIZE + PALETTE_ENTRIES * 3;
const BMP_HEADER_SIZE = 54;
const BMP_PALETTE_BYTES = PALETTE_ENTRIES * 4;

interface LpgOptions {
	bitsPerPixel?: number;
	width?: number;
	height?: number;
	pixels?: Buffer;
	/** Truncates the file after this many bytes, for the short palette and stream cases. */
	truncate?: number;
}

function buildLpg(options: LpgOptions = {}): Buffer {
	const {
		bitsPerPixel = 32,
		width = 2,
		height = 2,
		pixels = Buffer.alloc(width * height * 2, 0x00),
	} = options;
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	header[0] = 0x01;
	header.writeInt32LE(bitsPerPixel, 4);
	header.writeUInt32LE(width, 0x10);
	header.writeUInt32LE(height, 0x14);
	// Two hundred and fifty six triples; entry n holds n, n+1 and n+2 so a swap is visible.
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		header[HEADER_SIZE + index * 3] = index;
		header[HEADER_SIZE + index * 3 + 1] = (index + 1) & 0xff;
		header[HEADER_SIZE + index * 3 + 2] = (index + 2) & 0xff;
	}
	const file = Buffer.concat([header, pixels]);
	return options.truncate === undefined
		? file
		: file.subarray(0, options.truncate);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "IMAGE.LPG"): Promise<Buffer> {
	const archive = await lpgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The palette a bitmap holds, as four byte entries. */
function bitmapPalette(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + BMP_PALETTE_BYTES);
}

describe("hypatia lpg image", () => {
	it("registers a one byte signature and gates on the extension", () => {
		expect(lpgImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x01]) },
		]);
		expect(lpgImageFormat.descriptor.extensions).toEqual(["lpg"]);
	});

	it("declines the right bytes under another extension", async () => {
		// The signature is one byte, so the extension is what identifies the file and the reference checks it
		// before reading anything at all.
		const file = buildLpg();
		expect(await lpgImageFormat.detect(sourceOf(file), "IMAGE.LPG")).toBe(true);
		expect(await lpgImageFormat.detect(sourceOf(file), "IMAGE.lpg")).toBe(true);
		expect(await lpgImageFormat.detect(sourceOf(file), "IMAGE.bin")).toBe(
			false,
		);
	});

	it("accepts only the two depths and sane dimensions", async () => {
		expect(
			await lpgImageFormat.detect(
				sourceOf(buildLpg({ bitsPerPixel: 24 })),
				"A.LPG",
			),
		).toBe(true);
		for (const bitsPerPixel of [0, 8, 16, 31, 33, 64, -24]) {
			expect(
				await lpgImageFormat.detect(
					sourceOf(buildLpg({ bitsPerPixel })),
					"A.LPG",
				),
			).toBe(false);
		}
		for (const width of [0, 0x8000, 0x8001]) {
			const expected = width === 0x8000;
			expect(
				await lpgImageFormat.detect(
					sourceOf(buildLpg({ width, height: 1, pixels: Buffer.alloc(8) })),
					"A.LPG",
				),
			).toBe(expected);
		}
		expect(
			await lpgImageFormat.detect(
				sourceOf(buildLpg({ height: 0x8001, pixels: Buffer.alloc(8) })),
				"A.LPG",
			),
		).toBe(false);
		expect(
			await lpgImageFormat.detect(sourceOf(buildLpg().subarray(0, 0)), "A.LPG"),
		).toBe(false);
	});

	it("expands a thirty two bit image from a palette index and an alpha byte", async () => {
		// Two by two, indices three and five, alphas 0x80 and 0x40.
		const file = buildLpg({
			pixels: Buffer.from([0x03, 0x80, 0x05, 0x40, 0x07, 0xff, 0x09, 0x00]),
		});
		const source = sourceOf(file);
		const archive = await lpgImageFormat.open(source, "IMAGE.LPG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		// `CreateFlipped`: the data is bottom up and the height is positive.
		expect(output.readInt32LE(22)).toBe(2);
		// The palette's fourth byte leads and ends up last in the pixel.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x05, 0x04, 0x03, 0x80, 0x07, 0x06, 0x05, 0x40, 0x09, 0x08, 0x07, 0xff,
				0x0b, 0x0a, 0x09, 0x00,
			]),
		);
		// A thirty two bit bitmap has no palette of its own: the stored one was expanded into the pixels, so the
		// image data starts right after the header.
		expect(output.length).toBe(BMP_HEADER_SIZE + 16);
	});

	it("treats a twenty four bit image as eight bit indexed", async () => {
		// The reference allocates one byte a pixel for this branch, not three, and wraps the result as indexed
		// eight with the palette. Six bytes are stored and only the first four are read.
		const file = buildLpg({
			bitsPerPixel: 24,
			width: 2,
			height: 2,
			pixels: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
		});
		const archive = await lpgImageFormat.open(sourceOf(file), "IMAGE.LPG");
		try {
			// The metadata still reports the depth the header declared.
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 24 });
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(2);
		// Stored red-green-blue triples reach a bitmap as blue-green-red with a zero byte. Entry n holds
		// n, n+1 and n+2, so the first two entries arrive reversed.
		expect(bitmapPalette(output).subarray(0, 8)).toEqual(
			Buffer.from([0x02, 0x01, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00]),
		);
		// The four bytes the reference read are two rows of two, padded out to a bitmap's stride of four.
		expect(output.subarray(BMP_HEADER_SIZE + BMP_PALETTE_BYTES)).toEqual(
			Buffer.from([0x01, 0x02, 0x00, 0x00, 0x03, 0x04, 0x00, 0x00]),
		);
	});

	it("leaves the tail zeroed when a twenty four bit stream is short", async () => {
		const file = buildLpg({
			bitsPerPixel: 24,
			width: 2,
			height: 2,
			pixels: Buffer.from([0x01, 0x02]),
		});
		const output = await extract(file);
		expect(output.subarray(BMP_HEADER_SIZE + BMP_PALETTE_BYTES)).toEqual(
			Buffer.from([0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("lists a short palette and fails on extraction", async () => {
		// The palette is read during extraction, not during the metadata read, so a file with a valid header
		// and a truncated palette lists and then fails.
		const file = buildLpg({ truncate: HEADER_SIZE + 8 });
		expect(await lpgImageFormat.detect(sourceOf(file), "IMAGE.LPG")).toBe(true);
		const archive = await lpgImageFormat.open(sourceOf(file), "IMAGE.LPG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fails when a thirty two bit stream ends inside a pixel", async () => {
		const file = buildLpg({
			width: 2,
			height: 2,
			pixels: Buffer.from([0x03, 0x80, 0x05]),
		});
		const archive = await lpgImageFormat.open(sourceOf(file), "IMAGE.LPG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
