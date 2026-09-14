import { BufferByteSource } from "@garbro-mcp/core";
import { picImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("PIC\0", "latin1");
const BMP_OFFSET = 10;
const DIB_HEADER_SIZE = 40;
const BMP_HEADER_SIZE = 14 + DIB_HEADER_SIZE;
const PALETTE_SIZE = 1024;
/** The seven bytes between the tag and the bitmap that the reference never reads. */
const GAP_MARKER = 0xab;

function strideOf(width: number, bitsPerPixel: number): number {
	return (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
}

function buildPixels(size: number, seed = 23): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * seed + 5) & 0xff;
	return pixels;
}

function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = (i * 7) & 0xff;
		palette[i * 4 + 1] = (i * 3) & 0xff;
		palette[i * 4 + 2] = 0x11;
		palette[i * 4 + 3] = 0x00;
	}
	return palette;
}

function buildBmp(options: {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	palette?: Buffer;
	reserved?: number;
}): Buffer {
	const palette = options.palette ?? Buffer.alloc(0);
	const imageOffset = BMP_HEADER_SIZE + palette.length;
	const size = imageOffset + options.pixels.length;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(size, 2);
	header.writeUInt32LE(options.reserved ?? 0, 6);
	header.writeUInt32LE(imageOffset, 10);
	header.writeUInt32LE(DIB_HEADER_SIZE, 14);
	header.writeInt32LE(options.width, 18);
	header.writeInt32LE(options.height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(options.bitsPerPixel, 28);
	return Buffer.concat([header, palette, options.pixels]);
}

/** The engine's file: a tag with a null, six bytes of gap and the bitmap from its tenth byte. */
function buildPic(bmp: Buffer): Buffer {
	const prefix: Buffer = Buffer.alloc(BMP_OFFSET, GAP_MARKER);
	SIGNATURE.copy(prefix, 0);
	return Buffer.concat([prefix, bmp.subarray(BMP_OFFSET)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await picImageFormat.open(sourceOf(stored), "SPR01.PIC");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("soft house pic image", () => {
	it("declares the PIC signature and no extension", () => {
		expect(picImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(picImageFormat.descriptor.extensions).toEqual([]);
	});

	it("rebuilds the bitmap file header exactly", async () => {
		const pixels = buildPixels(strideOf(3, 24) * 2);
		const bmp = buildBmp({ width: 3, height: 2, bitsPerPixel: 24, pixels });
		const stored = buildPic(bmp);
		const source = sourceOf(stored);
		expect(await picImageFormat.detect(source, "SPR01.PIC")).toBe(true);
		const archive = await picImageFormat.open(source, "SPR01.PIC");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SPR01.bmp"]);
			// The header is ten bytes before and ten bytes after, so the entry has the stored length.
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
				prefixSize: BMP_OFFSET,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		// The reference writes `BM`, the length of the source file and four zeros; for a bitmap whose reserved
		// field is already zero that is the original file again, byte for byte.
		expect(output).toEqual(bmp);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(2);
	});

	it("ignores the six bytes between the tag's null and the bitmap", async () => {
		const pixels = buildPixels(strideOf(2, 24));
		const bmp = buildBmp({ width: 2, height: 1, bitsPerPixel: 24, pixels });
		const stored = buildPic(bmp);
		expect(stored.subarray(4, BMP_OFFSET)).toEqual(Buffer.alloc(6, GAP_MARKER));
		const output = await extract(stored);
		expect(output).toEqual(bmp);
	});

	it("declines a fourth byte that is not a null", async () => {
		const pixels = buildPixels(strideOf(2, 24));
		const bmp = buildBmp({ width: 2, height: 1, bitsPerPixel: 24, pixels });
		const stored = buildPic(bmp);
		stored[3] = GAP_MARKER;
		expect(await picImageFormat.detect(sourceOf(stored), "SPR01.PIC")).toBe(
			false,
		);
	});

	it("zeroes the reserved field the source may have filled", async () => {
		const pixels = buildPixels(strideOf(2, 24));
		const bmp = buildBmp({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			pixels,
			reserved: 0xdeadbeef,
		});
		const stored = buildPic(bmp);
		const output = await extract(stored);
		// The four bytes the reference builds itself, not the ones the source carried.
		expect(output.readUInt32LE(6)).toBe(0);
		expect(output.subarray(BMP_OFFSET)).toEqual(bmp.subarray(BMP_OFFSET));
	});

	it("carries a palette through untouched", async () => {
		const palette = buildPalette();
		const pixels = buildPixels(strideOf(3, 8));
		const bmp = buildBmp({
			width: 3,
			height: 1,
			bitsPerPixel: 8,
			pixels,
			palette,
		});
		const stored = buildPic(bmp);
		const archive = await picImageFormat.open(sourceOf(stored), "SPR01.PIC");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([0x00, 0x00, 0x11, 0x00]),
		);
		// The stored palette and pixels are the output's, unchanged.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.concat([palette, pixels]),
		);
	});

	it("declines a bitmap whose information header is too short", async () => {
		const bmp = buildBmp({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			pixels: buildPixels(strideOf(2, 24)),
		});
		// A header size below forty is not a bitmap the shared reader accepts.
		bmp.writeUInt32LE(12, 14);
		const stored = buildPic(bmp);
		expect(await picImageFormat.detect(sourceOf(stored), "SPR01.PIC")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		const bmp = buildBmp({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			pixels: buildPixels(strideOf(2, 24)),
		});
		const stored = buildPic(bmp);
		expect(
			await picImageFormat.detect(
				sourceOf(stored.subarray(0, 40)),
				"SPR01.PIC",
			),
		).toBe(false);
		const zero = buildPic(
			buildBmp({
				width: 0,
				height: 1,
				bitsPerPixel: 24,
				pixels: buildPixels(4),
			}),
		);
		expect(await picImageFormat.detect(sourceOf(zero), "SPR01.PIC")).toBe(
			false,
		);
	});

	it("declines a file that does not begin with the tag", async () => {
		const bmp = buildBmp({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			pixels: buildPixels(strideOf(2, 24)),
		});
		const stored = buildPic(bmp);
		stored[0] = 0x58;
		expect(await picImageFormat.detect(sourceOf(stored), "SPR01.PIC")).toBe(
			false,
		);
	});
});
