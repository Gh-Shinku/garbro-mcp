import { BufferByteSource } from "@garbro-mcp/core";
import { digitalWorksTxImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BLOCK_SIZE = 256;
const HEADER_SIZE = 0x10;
const PALETTE_ENTRIES = 0x100;
const PALETTE_SIZE = PALETTE_ENTRIES * 4;

interface TxOptions {
	widthBlocks?: number;
	heightBlocks?: number;
	/** Bytes a pixel, which is what the depth field holds. */
	depthBytes?: number;
	/** The pixels of the whole image, a row at a time and tight. */
	pixels?: Buffer;
	/** Replaces the bytes behind the header outright, palette included. */
	body?: Buffer;
	tail?: number;
}

function buildTx(options: TxOptions = {}): Buffer {
	const widthBlocks = options.widthBlocks ?? 1;
	const heightBlocks = options.heightBlocks ?? 1;
	const depthBytes = options.depthBytes ?? 3;
	const width = widthBlocks * BLOCK_SIZE;
	const height = heightBlocks * BLOCK_SIZE;
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from(
				{ length: width * height * depthBytes },
				(_, index) => (index * 11 + 3) & 0xff,
			),
		);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("TX", 0, "latin1");
	// The width block count shares its two bytes with the marker: its low byte is the marker's third one, which
	// is why the two words the reference registers stand for three and two blocks.
	header.writeUInt16LE(widthBlocks, 2);
	header.writeUInt16LE(heightBlocks, 4);
	header[6] = depthBytes;
	let body = options.body;
	if (!body) {
		// The image is stored a block at a time: every 256 by 256 square, left to right and top to bottom, and
		// a row of the block at a time.
		const stride = width * depthBytes;
		const blockStride = BLOCK_SIZE * depthBytes;
		const parts: Buffer[] = [];
		for (let blockRow = 0; blockRow < heightBlocks; blockRow += 1) {
			for (let blockColumn = 0; blockColumn < widthBlocks; blockColumn += 1) {
				for (let line = 0; line < BLOCK_SIZE; line += 1) {
					const from =
						(blockRow * BLOCK_SIZE + line) * stride + blockColumn * blockStride;
					parts.push(pixels.subarray(from, from + blockStride));
				}
			}
		}
		body = Buffer.concat(parts);
	}
	return Buffer.concat([header, body, Buffer.alloc(options.tail ?? 0, 0x5a)]);
}

/** The palette an eight bit texture carries **after** its pixels, in blue, green, red, alpha order. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = (index + 1) & 0xff;
		palette[index * 4 + 2] = (index + 2) & 0xff;
		palette[index * 4 + 3] = 0xff;
	}
	return palette;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "TEX01.tx"): Promise<Buffer> {
	const archive = await digitalWorksTxImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Digital Works texture", () => {
	it("declares the two TX words and its extensions", async () => {
		expect(digitalWorksTxImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x54, 0x58, 0x03, 0x00]) },
			{ bytes: Buffer.from([0x54, 0x58, 0x02, 0x00]) },
		]);
		expect(digitalWorksTxImageFormat.descriptor.extensions).toEqual([
			"tmx",
			"tx",
		]);
		const signed = buildTx({
			widthBlocks: 3,
			depthBytes: 1,
			pixels: Buffer.alloc(3 * BLOCK_SIZE * BLOCK_SIZE),
		});
		// The registered word carries it whatever the name is, and the second word is taken the same way.
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(signed), "TEX01.bin"),
		).toBe(true);
		const two = buildTx({
			widthBlocks: 2,
			depthBytes: 1,
			pixels: Buffer.alloc(2 * BLOCK_SIZE * BLOCK_SIZE),
		});
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(two), "TEX01.bin"),
		).toBe(true);
		// A third byte that is neither of the two is taken by name alone, which is what the zero in the
		// reference's signature list stands for.
		const odd = buildTx({
			widthBlocks: 1,
			depthBytes: 1,
			pixels: Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE),
		});
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(odd), "TEX01.tx"),
		).toBe(true);
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(odd), "TEX01.tmx"),
		).toBe(true);
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(odd), "TEX01.bin"),
		).toBe(false);
	});

	it("needs its marker, a depth of one to four bytes and two block counts", async () => {
		const pixels = Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE);
		const good = { depthBytes: 1, pixels };
		const noMarker = buildTx(good);
		noMarker.write("TZ", 0, "latin1");
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(noMarker), "A.tx"),
		).toBe(false);
		expect(
			await digitalWorksTxImageFormat.detect(
				sourceOf(buildTx({ ...good, depthBytes: 0 })),
				"A.tx",
			),
		).toBe(false);
		expect(
			await digitalWorksTxImageFormat.detect(
				sourceOf(buildTx({ ...good, depthBytes: 5 })),
				"A.tx",
			),
		).toBe(false);
		expect(
			await digitalWorksTxImageFormat.detect(
				sourceOf(buildTx({ ...good, widthBlocks: 0 })),
				"A.tx",
			),
		).toBe(false);
		expect(
			await digitalWorksTxImageFormat.detect(
				sourceOf(buildTx(good).subarray(0, HEADER_SIZE - 1)),
				"A.tx",
			),
		).toBe(false);
	});

	it("measures its image in blocks of 0x100 pixels", async () => {
		const archive = await digitalWorksTxImageFormat.open(
			sourceOf(buildTx({ widthBlocks: 2, heightBlocks: 3, depthBytes: 3 })),
			"TEX01.tx",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 512,
				height: 768,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "block-interleaved",
			});
		} finally {
			await archive.close();
		}
	});

	it("unfolds the blocks of a twenty four bit texture top down", async () => {
		const width = BLOCK_SIZE;
		const pixels: Buffer = Buffer.alloc(width * BLOCK_SIZE * 3, 0x00);
		// The first pixel of the first and of the last row, which is where a block's rows meet.
		pixels.set([1, 2, 3], 0);
		pixels.set([4, 5, 6], (BLOCK_SIZE - 1) * width * 3);
		const output = await extract(buildTx({ depthBytes: 3, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// No flip in the reference, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-BLOCK_SIZE);
		expect(output.subarray(54, 57)).toEqual(Buffer.from([1, 2, 3]));
		expect(
			output.subarray(
				54 + (BLOCK_SIZE - 1) * width * 3,
				54 + (BLOCK_SIZE - 1) * width * 3 + 3,
			),
		).toEqual(Buffer.from([4, 5, 6]));
	});

	it("walks the blocks of a row from left to right", async () => {
		const width = 2 * BLOCK_SIZE;
		const pixels: Buffer = Buffer.alloc(width * BLOCK_SIZE * 3, 0x00);
		// One marker in each half of the image's first row.
		pixels.set([1, 1, 1], 0);
		pixels.set([2, 2, 2], BLOCK_SIZE * 3);
		const output = await extract(
			buildTx({ widthBlocks: 2, depthBytes: 3, pixels }),
		);
		expect(output.subarray(54, 57)).toEqual(Buffer.from([1, 1, 1]));
		// The second block starts at the 0x100th pixel of the row.
		expect(
			output.subarray(54 + BLOCK_SIZE * 3, 54 + BLOCK_SIZE * 3 + 3),
		).toEqual(Buffer.from([2, 2, 2]));
	});

	it("stacks the blocks of the second row under the first", async () => {
		const width = BLOCK_SIZE;
		const pixels: Buffer = Buffer.alloc(width * 2 * BLOCK_SIZE * 3, 0x00);
		pixels.set([7, 7, 7], BLOCK_SIZE * width * 3);
		const output = await extract(
			buildTx({ heightBlocks: 2, depthBytes: 3, pixels }),
		);
		expect(output.readInt32LE(22)).toBe(-2 * BLOCK_SIZE);
		expect(
			output.subarray(
				54 + BLOCK_SIZE * width * 3,
				54 + BLOCK_SIZE * width * 3 + 3,
			),
		).toEqual(Buffer.from([7, 7, 7]));
	});

	it("reads the palette that follows an eight bit body", async () => {
		const pixels = Buffer.from([0x00, 0x05, 0xff]);
		const stored = buildTx({
			depthBytes: 1,
			pixels: Buffer.concat([
				pixels,
				Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE - 3),
			]),
			body: Buffer.concat([
				Buffer.concat([pixels, Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE - 3)]),
				buildPalette(),
			]),
		});
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		// The entry keeps its blue, green and red bytes; the alpha byte a bitmap palette has no use for is
		// cleared.
		expect(output.subarray(54 + 5 * 4, 54 + 5 * 4 + 4)).toEqual(
			Buffer.from([0x05, 0x06, 0x07, 0x00]),
		);
		expect(output.subarray(54 + PALETTE_SIZE, 54 + PALETTE_SIZE + 4)).toEqual(
			Buffer.from([0x00, 0x05, 0xff, 0x00]),
		);
	});

	it("unfolds a thirty two bit texture and refuses a sixteen bit one", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const stored = buildTx({
			depthBytes: 4,
			pixels: Buffer.concat([
				pixels,
				Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE * 4 - 8),
			]),
		});
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54, 62)).toEqual(pixels);
		// Two bytes a pixel is accepted when the header is read, but the reference builds a thirty two bit
		// image from it, which the buffer cannot fill.
		const sixteen = buildTx({
			depthBytes: 2,
			pixels: Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE * 2),
		});
		expect(
			await digitalWorksTxImageFormat.detect(sourceOf(sixteen), "A.tx"),
		).toBe(true);
		await expect(extract(sixteen)).rejects.toThrow();
	});

	it("names the entry after the texture", async () => {
		const stored = buildTx({
			depthBytes: 3,
			pixels: Buffer.alloc(BLOCK_SIZE * BLOCK_SIZE * 3),
		});
		const archive = await digitalWorksTxImageFormat.open(
			sourceOf(stored),
			"sub/TEX07.tmx",
		);
		try {
			expect(archive.entries[0]?.path).toBe("TEX07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
