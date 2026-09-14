import { BufferByteSource } from "@garbro-mcp/core";
import { interheartBmpRleImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const MARKER = "BMP24RLE";
const BITMAP_HEADER_SIZE = 54;

function strideOf(width: number): number {
	return (width * 3 + 3) & ~3;
}

/**
 * The bitmap header the file carries behind the marker. The fields the format reads are a shifted view of it:
 * the size at 0x0A is this header's file size, the header size at 0x12 is its pixel offset, and the width,
 * height and depth are the ones at their usual places.
 */
function buildBitmapHeader(
	width: number,
	height: number,
	pixelsSize: number,
): Buffer {
	const header: Buffer = Buffer.alloc(BITMAP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BITMAP_HEADER_SIZE + pixelsSize, 2);
	header.writeUInt32LE(BITMAP_HEADER_SIZE, 0x0a);
	header.writeUInt32LE(40, 0x0e);
	header.writeInt32LE(width, 0x12);
	header.writeInt32LE(height, 0x16);
	header.writeUInt16LE(1, 0x1a);
	header.writeUInt16LE(24, 0x1c);
	header.writeUInt32LE(pixelsSize, 0x22);
	return header;
}

interface BmpRleOptions {
	width?: number;
	height?: number;
	runs?: Buffer;
	/** Replaces the header the source carries, for the rejection cases. */
	header?: Buffer;
	truncate?: number;
}

function buildBmpRle(options: BmpRleOptions = {}): Buffer {
	const width = options.width ?? 4;
	const height = options.height ?? 1;
	const pixelsSize = strideOf(width) * height;
	const header = options.header ?? buildBitmapHeader(width, height, pixelsSize);
	const file = Buffer.concat([
		Buffer.from(MARKER, "latin1"),
		header,
		options.runs ?? Buffer.alloc(0),
	]);
	return options.truncate === undefined
		? file
		: file.subarray(0, options.truncate);
}

/** One pixel as the run length data stores it: red, green and blue, which the decoder writes back reversed. */
function pixel(red: number, green: number, blue: number): Buffer {
	return Buffer.from([red, green, blue]);
}

/** A pixel, its repeat and the count of further repeats a run writes. */
function run(value: Buffer, count: number): Buffer {
	const tail: Buffer = Buffer.alloc(2, 0x00);
	tail.writeUInt16LE(count, 0);
	return Buffer.concat([value, value, tail]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "PIC01.bmp"): Promise<Buffer> {
	const archive = await interheartBmpRleImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Candy Soft RLE bitmap", () => {
	it("declares its marker and takes only the twenty four bit flavour", async () => {
		expect(interheartBmpRleImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("BMP2", "latin1") },
		]);
		expect(interheartBmpRleImageFormat.descriptor.extensions).toEqual([]);
		expect(
			await interheartBmpRleImageFormat.detect(
				sourceOf(buildBmpRle()),
				"PIC.bin",
			),
		).toBe(true);
		// The eight bit flavour shares neither the word nor the marker.
		const eightBit = buildBmpRle();
		eightBit.write("BMP08RLE", 0, "latin1");
		expect(
			await interheartBmpRleImageFormat.detect(sourceOf(eightBit), "PIC.bin"),
		).toBe(false);
		expect(
			await interheartBmpRleImageFormat.detect(
				sourceOf(buildBmpRle({ truncate: 0x20 })),
				"A",
			),
		).toBe(false);
	});

	it("needs a size and a bitmap header that can be copied into it", async () => {
		const short = buildBitmapHeader(4, 1, 12);
		// The size field the format reads doubles as the bitmap's file size, so clearing that clears the size.
		short.writeUInt32LE(0, 2);
		expect(
			await interheartBmpRleImageFormat.detect(
				sourceOf(buildBmpRle({ header: short })),
				"A",
			),
		).toBe(false);
		const big = buildBitmapHeader(4, 1, 12);
		// The pixel offset of the bitmap is the header size, and it has to fit the file size above.
		big.writeUInt32LE(100, 0x0a);
		expect(
			await interheartBmpRleImageFormat.detect(
				sourceOf(buildBmpRle({ header: big })),
				"A",
			),
		).toBe(false);
		const flat = buildBitmapHeader(0, 1, 0);
		expect(
			await interheartBmpRleImageFormat.detect(
				sourceOf(buildBmpRle({ header: flat })),
				"A",
			),
		).toBe(false);
	});

	it("reads its measurements from the header behind the marker", async () => {
		const archive = await interheartBmpRleImageFormat.open(
			sourceOf(buildBmpRle({ width: 8, height: 4 })),
			"PIC01.bmp",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 8,
				height: 4,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "rle",
			});
		} finally {
			await archive.close();
		}
	});

	it("carries the bitmap header over and expands a run into it", async () => {
		// Four pixels: a run of three of one colour, then one of another.
		const runs = Buffer.concat([
			run(pixel(0x11, 0x22, 0x33), 1),
			pixel(0x44, 0x55, 0x66),
		]);
		const output = await extract(buildBmpRle({ runs }));
		// The header is the one the file carried, so the output is a whole bitmap.
		expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(output.readUInt32LE(2)).toBe(BITMAP_HEADER_SIZE + 12);
		expect(output.readUInt32LE(0x0a)).toBe(BITMAP_HEADER_SIZE);
		// The runs store red, green and blue and are written back reversed.
		expect(
			output.subarray(BITMAP_HEADER_SIZE, BITMAP_HEADER_SIZE + 12),
		).toEqual(
			Buffer.from([
				0x33, 0x22, 0x11, 0x33, 0x22, 0x11, 0x33, 0x22, 0x11, 0x66, 0x55, 0x44,
			]),
		);
	});

	it("takes two identical pixels as the start of a run", async () => {
		// A count of zero still means the second copy, and the pixel behind the run follows it.
		const runs = Buffer.concat([run(pixel(1, 2, 3), 0), pixel(4, 5, 6)]);
		const output = await extract(buildBmpRle({ runs }));
		expect(
			output.subarray(BITMAP_HEADER_SIZE, BITMAP_HEADER_SIZE + 12),
		).toEqual(Buffer.from([3, 2, 1, 3, 2, 1, 6, 5, 4, 0, 0, 0]));
	});

	it("stops at the size of the bitmap the header declares", async () => {
		// Three pixels, no run, and the fourth one left as the buffer was.
		const runs = Buffer.concat([
			pixel(1, 1, 1),
			pixel(2, 2, 2),
			pixel(3, 3, 3),
		]);
		const output = await extract(buildBmpRle({ runs }));
		expect(
			output.subarray(BITMAP_HEADER_SIZE, BITMAP_HEADER_SIZE + 12),
		).toEqual(Buffer.from([1, 1, 1, 2, 2, 2, 3, 3, 3, 0, 0, 0]));
	});

	it("refuses a run that does not fit the bitmap", async () => {
		const runs = Buffer.concat([run(pixel(1, 2, 3), 20)]);
		await expect(extract(buildBmpRle({ runs }))).rejects.toThrow(
			/run overflows/,
		);
	});

	it("names the entry after the bitmap", async () => {
		const archive = await interheartBmpRleImageFormat.open(
			sourceOf(buildBmpRle()),
			"sub/GFX07.bmp",
		);
		try {
			expect(archive.entries[0]?.path).toBe("GFX07.bmp");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
