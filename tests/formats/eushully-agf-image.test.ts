import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeAgf,
	readAgfImageLayout,
	eushullyAgfImageFormat,
} from "../../packages/formats/src/eushully/agf-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0x18;
/** The first section begins behind the four byte word and the head. */
const SECTION_START = 4 + HEADER_SIZE;
const INNER_HEADER = 0x20;
const INNER_TAIL = 0x18;
const PALETTE = 0x400;
const PICTURE_HEADER = 12;
const ALPHA_HEADER = 0x24;
/**
 * The reference works the picture's own offset out as `0x18 + packed_size`, which lands four bytes before
 * the first section ends. The two sections therefore share those four bytes, which is why the head a packed
 * section unfolds to carries four bytes nothing reads behind it, and why the picture's own first word - which
 * the reader steps over - may stand there.
 */
const SECTION_TAIL = 4;

interface AgfFixture {
	/** The kind of picture: one for twenty four bits, two for a picture that may carry alpha. */
	kind: 1 | 2;
	width: number;
	height: number;
	sourceBitsPerPixel: number;
	/** The pictures' pixels, top down, in the order a bitmap keeps them: blue, green, red, and alpha. */
	pixels: Buffer;
	palette?: Buffer;
	alpha?: Buffer;
	packOuter?: boolean;
	packPicture?: boolean;
	head?: string;
}

/** The stored rows: the last row of the picture first, each padded to a whole number of four bytes. */
function storedRows(
	pixels: Buffer,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const rowBytes = Math.floor((width * bitsPerPixel) / 8);
	// The reference works its stride out of the same truncated byte count, but a row still carries every
	// byte its pixels are packed into.
	const storedBytes = Math.ceil((width * bitsPerPixel) / 8);
	const stride = (rowBytes + 3) & ~3;
	const rows: Buffer[] = [];
	for (let row = height - 1; row >= 0; row -= 1) {
		const line = Buffer.alloc(stride, 0x00);
		pixels.copy(line, 0, row * storedBytes, (row + 1) * storedBytes);
		rows.push(line);
	}
	return Buffer.concat(rows);
}

function agfFile(options: AgfFixture): Buffer {
	const indexed = options.sourceBitsPerPixel <= 8;
	const innerLength =
		INNER_HEADER + (indexed ? INNER_TAIL + PALETTE : 0) + SECTION_TAIL;
	const inner = Buffer.alloc(innerLength, 0x00);
	inner.writeUInt32LE(options.width, INNER_HEADER - 0x0c);
	inner.writeUInt32LE(options.height, INNER_HEADER - 0x08);
	inner.writeInt16LE(options.sourceBitsPerPixel, INNER_HEADER - 0x02);
	if (options.palette) options.palette.copy(inner, INNER_HEADER + INNER_TAIL);
	const outer = options.packOuter ? literalLzssStream(inner) : inner;

	const body = storedRows(
		options.pixels,
		options.width,
		options.height,
		options.sourceBitsPerPixel,
	);
	const stored = options.packPicture ? literalLzssStream(body) : body;
	const picture = Buffer.alloc(PICTURE_HEADER + stored.length, 0x00);
	picture.writeUInt32LE(body.length, 4);
	picture.writeUInt32LE(stored.length, 8);
	stored.copy(picture, PICTURE_HEADER);

	const alpha = Buffer.alloc(
		options.alpha ? ALPHA_HEADER + options.alpha.length : 0,
		0x00,
	);
	if (options.alpha) {
		alpha.write("ACIF", 0, "latin1");
		alpha.writeUInt32LE(options.alpha.length, 0x1c);
		alpha.writeUInt32LE(options.alpha.length, 0x20);
		options.alpha.copy(alpha, ALPHA_HEADER);
	}

	const head = Buffer.alloc(SECTION_START, 0x00);
	head.write(options.head ?? "ACGF", 0, "latin1");
	head.writeInt32LE(options.kind, 4 + 4);
	head.writeInt32LE(inner.length, 4 + 0x0c);
	head.writeInt32LE(outer.length, 4 + 0x14);
	const start = HEADER_SIZE + outer.length;
	const file = Buffer.alloc(
		Math.max(
			SECTION_START + outer.length,
			start + picture.length + alpha.length,
		),
		0x00,
	);
	head.copy(file, 0);
	outer.copy(file, SECTION_START);
	// The picture stands where the reference works it out to, which overlaps the outer section's last word.
	picture.copy(file, start);
	alpha.copy(file, start + picture.length);
	return file;
}

function layoutOf(file: Buffer) {
	const layout = readAgfImageLayout(file);
	if (!layout)
		throw new Error("the fixture does not read as an Eushully picture");
	return layout;
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await eushullyAgfImageFormat.open(
		new BufferByteSource(file),
		"picture.agf",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

/** Three pixels to a row whose colours climb, so that a misplaced byte shows up. */
function pixels24(count: number): Buffer {
	const out: number[] = [];
	for (let i = 0; i < count; i += 1) {
		out.push((i * 3) & 0xff, (i * 3 + 1) & 0xff, (i * 3 + 2) & 0xff);
	}
	return Buffer.from(out);
}

function paletteOf(): Buffer {
	const palette = Buffer.alloc(0x100 * 4, 0x00);
	for (let i = 1; i < 0xff; i += 1) {
		palette.writeUInt8(i, i * 4);
		palette.writeUInt8((i * 2) & 0xff, i * 4 + 1);
		palette.writeUInt8((i * 3) & 0xff, i * 4 + 2);
	}
	return palette;
}

describe("Eushully AGF image", () => {
	it("reads a stored picture and turns its rows over", async () => {
		const file = agfFile({
			kind: 1,
			width: 3,
			height: 2,
			sourceBitsPerPixel: 24,
			pixels: pixels24(6),
		});
		const layout = layoutOf(file);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(2);
		expect(layout.bitsPerPixel).toBe(24);
		expect(layout.sourceBitsPerPixel).toBe(24);
		expect(layout.paletteOffset).toBeUndefined();
		const { pixels, bitsPerPixel } = decodeAgf(file, layout);
		expect(bitsPerPixel).toBe(24);
		expect(pixels).toEqual(pixels24(6));
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.width).toBe(3);
		expect(bitmap.height).toBe(2);
		expect(bitmap.bitsPerPixel).toBe(24);
		// The rows were stored with the last one first, so a positive height is the turned over picture.
		expect(bitmap.pixels).toEqual(pixels24(6));
	});

	it("takes a picture whose word is empty", async () => {
		const file = agfFile({
			kind: 1,
			width: 2,
			height: 2,
			sourceBitsPerPixel: 24,
			pixels: pixels24(4),
			head: "\u0000\u0000\u0000\u0000",
		});
		expect(layoutOf(file).width).toBe(2);
		expect(
			await eushullyAgfImageFormat.detect(new BufferByteSource(file)),
		).toBe(true);
	});

	it("reads an eight bit picture through the palette it carries", async () => {
		const file = agfFile({
			kind: 1,
			width: 3,
			height: 1,
			sourceBitsPerPixel: 8,
			pixels: Buffer.from([1, 2, 3]),
			palette: paletteOf(),
		});
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(24);
		expect(layout.paletteOffset).toBe(INNER_HEADER + INNER_TAIL);
		const { pixels } = decodeAgf(file, layout);
		expect(pixels).toEqual(Buffer.from([1, 2, 3, 2, 4, 6, 3, 6, 9]));
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(24);
		expect(bitmap.pixels).toEqual(Buffer.from([1, 2, 3, 2, 4, 6, 3, 6, 9]));
	});

	it("takes the higher nibble of a byte first in a four bit picture", async () => {
		const file = agfFile({
			kind: 1,
			width: 3,
			height: 1,
			sourceBitsPerPixel: 4,
			pixels: Buffer.from([0x12, 0x30]),
			palette: paletteOf(),
		});
		const layout = layoutOf(file);
		expect(layout.sourceBitsPerPixel).toBe(4);
		const { pixels } = decodeAgf(file, layout);
		// The first byte carries the first two pixels, the higher nibble leading.
		expect(pixels).toEqual(Buffer.from([1, 2, 3, 2, 4, 6, 3, 6, 9]));
	});

	it("reads the alpha channel behind a thirty two bit picture", async () => {
		const source = Buffer.from([
			1, 2, 3, 0xee, 4, 5, 6, 0xee, 7, 8, 9, 0xee, 10, 11, 12, 0xee,
		]);
		const alpha = Buffer.from([0xa1, 0xa2, 0xa3, 0xa4]);
		const file = agfFile({
			kind: 2,
			width: 2,
			height: 2,
			sourceBitsPerPixel: 32,
			pixels: source,
			alpha,
		});
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(32);
		const result = decodeAgf(file, layout);
		expect(result.bitsPerPixel).toBe(32);
		// The byte the picture itself stores last is dropped: the alpha channel beside it is the one that counts.
		expect(result.pixels).toEqual(
			Buffer.from([
				1, 2, 3, 0xa1, 4, 5, 6, 0xa2, 7, 8, 9, 0xa3, 10, 11, 12, 0xa4,
			]),
		);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(32);
		expect(bitmap.pixels).toEqual(result.pixels);
	});

	it("falls back to twenty four bits when the alpha channel is not there", async () => {
		const source = Buffer.from([
			1, 2, 3, 0xee, 4, 5, 6, 0xee, 7, 8, 9, 0xee, 10, 11, 12, 0xee,
		]);
		const file = agfFile({
			kind: 2,
			width: 2,
			height: 2,
			sourceBitsPerPixel: 32,
			pixels: source,
		});
		const result = decodeAgf(file, layoutOf(file));
		expect(result.bitsPerPixel).toBe(24);
		expect(result.pixels).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
		);
	});

	it("unfolds a packed head and a packed picture", async () => {
		const plain = agfFile({
			kind: 1,
			width: 3,
			height: 2,
			sourceBitsPerPixel: 24,
			pixels: pixels24(6),
		});
		const packed = agfFile({
			kind: 1,
			width: 3,
			height: 2,
			sourceBitsPerPixel: 24,
			pixels: pixels24(6),
			packOuter: true,
			packPicture: true,
		});
		// A stream that stores every byte as a literal grows, so only the picture it unfolds to is compared.
		expect(packed.length).not.toBe(plain.length);
		const layout = layoutOf(packed);
		expect(layout.width).toBe(3);
		expect(decodeAgf(packed, layout).pixels).toEqual(pixels24(6));
		expect(readBmpImage(await bitmapOf(packed))?.pixels).toEqual(pixels24(6));
	});

	it("refuses a picture it cannot read", () => {
		const base: AgfFixture = {
			kind: 1,
			width: 3,
			height: 2,
			sourceBitsPerPixel: 24,
			pixels: pixels24(6),
		};
		const plain = agfFile(base);
		expect(readAgfImageLayout(plain)).toBeDefined();
		// A kind of picture the reference does not know.
		expect(
			readAgfImageLayout(agfFile({ ...base, kind: 3 as 1 })),
		).toBeUndefined();
		// A head of another engine.
		expect(
			readAgfImageLayout(agfFile({ ...base, head: "ACGH" })),
		).toBeUndefined();
		// A picture whose depth is nothing.
		expect(
			readAgfImageLayout(agfFile({ ...base, sourceBitsPerPixel: 0 })),
		).toBeUndefined();
		// A picture with no width.
		expect(readAgfImageLayout(agfFile({ ...base, width: 0 }))).toBeUndefined();
		// A file that stops inside its own head.
		expect(readAgfImageLayout(plain.subarray(0, 0x1c))).toBeUndefined();
		// A file that stops inside the picture's own body still names its dimensions, but cannot be read.
		const cut = plain.subarray(0, plain.length - 4);
		expect(readAgfImageLayout(cut)).toBeDefined();
		expect(() => decodeAgf(cut, layoutOf(cut))).toThrow();
	});
});
