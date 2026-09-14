import { BufferByteSource } from "@garbro-mcp/core";
import { mnoVioletGraImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0x14;
const GREY_PALETTE_SIZE = 0x100 * 4;
const GREY_PIXEL_OFFSET = 54 + GREY_PALETTE_SIZE;

function strideOf(width: number, bitsPerPixel: number): number {
	return (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
}

interface GraOptions {
	/** `gra` for twenty four bits and `mas` for eight. */
	marker?: string;
	width?: number;
	height?: number;
	/** The pixels, a row at a time and tight. */
	pixels?: Buffer;
	/** Replaces the compressed body outright. */
	body?: Buffer;
	packedSize?: number;
	unpackedSize?: number;
	/** Bytes the file carries behind the body, which the packed size excludes. */
	tail?: Buffer;
}

/** Compresses nothing: every byte of the image becomes a literal token. */
function buildGra(options: GraOptions = {}): Buffer {
	const marker = options.marker ?? "gra";
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const bitsPerPixel = marker === "mas" ? 8 : 24;
	const rowBytes = (width * bitsPerPixel) / 8;
	const stride = strideOf(width, bitsPerPixel);
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from(
				{ length: rowBytes * height },
				(_, index) => (index * 13 + 7) & 0xff,
			),
		);
	// The reference's own image has the rows at its four byte aligned stride, so the body holds that.
	const plain: Buffer = Buffer.alloc(stride * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(plain, row * stride, row * rowBytes, (row + 1) * rowBytes);
	}
	const body = options.body ?? literalLzssStream(plain);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(`${marker}\0`, 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt32LE(options.packedSize ?? body.length, 0xc);
	header.writeInt32LE(options.unpackedSize ?? plain.length, 0x10);
	return Buffer.concat([header, body, options.tail ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.gra"): Promise<Buffer> {
	const archive = await mnoVioletGraImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("M no Violet image", () => {
	it("takes gra and mas with their nulls and nothing else", async () => {
		expect(
			await mnoVioletGraImageFormat.detect(sourceOf(buildGra()), "A.gra"),
		).toBe(true);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ marker: "mas" })),
				"A.mas",
			),
		).toBe(true);
		const wrongNull = buildGra();
		wrongNull[3] = 0x58;
		expect(
			await mnoVioletGraImageFormat.detect(sourceOf(wrongNull), "A.gra"),
		).toBe(false);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ marker: "grb" })),
				"A.gra",
			),
		).toBe(false);
	});

	it("needs dimensions and both sizes", async () => {
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ width: 0 })),
				"A.gra",
			),
		).toBe(false);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ height: 0x8001 })),
				"A.gra",
			),
		).toBe(false);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ packedSize: 0 })),
				"A.gra",
			),
		).toBe(false);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra({ unpackedSize: -1 })),
				"A.gra",
			),
		).toBe(false);
		expect(
			await mnoVioletGraImageFormat.detect(
				sourceOf(buildGra().subarray(0, HEADER_SIZE - 1)),
				"A.gra",
			),
		).toBe(false);
	});

	it("takes its depth from the marker", async () => {
		const twentyFour = await mnoVioletGraImageFormat.open(
			sourceOf(buildGra()),
			"A.gra",
		);
		try {
			expect(twentyFour.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(twentyFour.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
			});
		} finally {
			await twentyFour.close();
		}
		const eight = await mnoVioletGraImageFormat.open(
			sourceOf(buildGra({ marker: "mas" })),
			"A.mas",
		);
		try {
			expect(eight.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 8 });
			expect(mnoVioletGraImageFormat.descriptor.extensions).toEqual([]);
		} finally {
			await eight.close();
		}
	});

	it("unfolds a twenty four bit image bottom up and tight", async () => {
		// Two rows of three pixels, which the reference's stride pads from nine bytes to twelve.
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23, 24,
		]);
		const output = await extract(buildGra({ width: 3, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// `ImageData.CreateFlipped` stores the rows bottom up, so the bitmap's height stays positive.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54, 66)).toEqual(
			Buffer.concat([pixels.subarray(0, 9), Buffer.alloc(3)]),
		);
		expect(output.subarray(66, 78)).toEqual(
			Buffer.concat([pixels.subarray(9), Buffer.alloc(3)]),
		);
	});

	it("writes an eight bit image with the grey palette", async () => {
		const pixels = Buffer.from([0x00, 0x40, 0x80, 0xc0, 0xff, 0x7f]);
		const output = await extract(
			buildGra({ marker: "mas", width: 3, height: 2, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54 + 0x40 * 4, 54 + 0x40 * 4 + 4)).toEqual(
			Buffer.from([0x40, 0x40, 0x40, 0x00]),
		);
		// The rows are padded from three bytes to four.
		expect(output.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0x00, 0x40, 0x80, 0x00]),
		);
		expect(
			output.subarray(GREY_PIXEL_OFFSET + 4, GREY_PIXEL_OFFSET + 8),
		).toEqual(Buffer.from([0xc0, 0xff, 0x7f, 0x00]));
	});

	it("reads only the packed size and ignores what follows it", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const plain = buildGra({ width: 3, height: 1, pixels });
		const withTail = Buffer.concat([plain, Buffer.alloc(32, 0x5a)]);
		// The header still describes the stream alone, so the trailing bytes change nothing.
		const output = await extract(withTail);
		expect(output.subarray(54, 63)).toEqual(pixels);
	});

	it("refuses a body that is cut short or an image that cannot hold its rows", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		// The packed size reaches past the end of the file.
		const truncated = buildGra({
			width: 3,
			height: 1,
			pixels,
			packedSize: 4096,
		});
		await expect(extract(truncated)).rejects.toThrow();
		// The unpacked size promises less than the stride needs, which the reference's image layer refuses.
		const short = buildGra({ width: 3, height: 2, pixels, unpackedSize: 9 });
		await expect(extract(short)).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const archive = await mnoVioletGraImageFormat.open(
			sourceOf(buildGra()),
			"sub/CG07.gra",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.compressed).toBe(true);
		} finally {
			await archive.close();
		}
	});
});
