import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { keroqKgd1ImageFormat } from "../../packages/formats/src/keroq/kgd1-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmp32,
	writeBmp8Palette,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x18;

function paletteOf(): Buffer {
	const palette: Buffer = Buffer.alloc(0x400, 0);
	for (let index = 0; index < 256; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = 255 - index;
		palette[index * 4 + 2] = index ^ 0x33;
		palette[index * 4 + 3] = 0x00;
	}
	return palette;
}

interface Kgd1Parts {
	bitsPerPixel: number;
	width: number;
	height: number;
	pixels: Buffer;
	alpha?: Buffer;
	palette?: Buffer;
	headerLength?: number;
}

/** The file: twenty four bytes of header, then the transparency, the colour map and the pixels behind it. */
function kgd1File(parts: Kgd1Parts): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.write("KGD1", 0, "latin1");
	header.writeInt16LE(parts.bitsPerPixel, 6);
	header.writeUInt32LE(parts.width, 8);
	header.writeUInt32LE(parts.height, 0xc);
	header.writeInt32LE(parts.alpha?.length ?? 0, 0x10);
	const body: Buffer[] = [];
	if (parts.alpha) body.push(parts.alpha);
	if (parts.palette) body.push(parts.palette);
	body.push(parts.pixels);
	return Buffer.concat([header, ...body]).subarray(
		0,
		parts.headerLength ?? Number.MAX_SAFE_INTEGER,
	);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.kgd"): Promise<Buffer> {
	const handle = await keroqKgd1ImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function normalised(picture: Buffer): Buffer {
	const image = readBmpImage(picture);
	if (!image) throw new Error("the fixture is not a bitmap");
	return writeBmpImage(image);
}

describe("KeroQ image format", () => {
	const pixels: Buffer = Buffer.alloc(5 * 3 * 3, 0);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 7) & 0xff;
	}

	it("finds a picture behind the word of the format", async () => {
		const data = kgd1File({
			bitsPerPixel: 24,
			width: 5,
			height: 3,
			pixels,
		});
		expect(await keroqKgd1ImageFormat.detect(sourceOf(data), "cg.kgd")).toBe(
			true,
		);
		const other = kgd1File({
			bitsPerPixel: 24,
			width: 5,
			height: 3,
			pixels: Buffer.alloc(pixels.length, 0),
		});
		other[3] = 0x32;
		expect(await keroqKgd1ImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("declines a depth the reference does not read", async () => {
		for (const bitsPerPixel of [4, 16, 32]) {
			const data = kgd1File({
				bitsPerPixel,
				width: 2,
				height: 2,
				pixels: Buffer.alloc(8),
			});
			expect(await keroqKgd1ImageFormat.detect(sourceOf(data))).toBe(false);
		}
	});

	it("reports what the header says about the picture", async () => {
		const data = kgd1File({ bitsPerPixel: 24, width: 5, height: 3, pixels });
		const handle = await keroqKgd1ImageFormat.open(
			sourceOf(data),
			"dir/cg.kgd",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 5,
			height: 3,
			bitsPerPixel: 24,
		});
	});

	it("writes the twenty four bit pixels behind the header", async () => {
		const expected = writeBmp24(5, 3, pixels);
		expect(
			await extract(
				kgd1File({ bitsPerPixel: 24, width: 5, height: 3, pixels }),
			),
		).toEqual(normalised(expected));
	});

	it("writes an indexed picture together with its colour map", async () => {
		const palette = paletteOf();
		const indexed: Buffer = Buffer.from([0, 1, 2, 3, 4, 5]);
		const expected = writeBmp8Palette(3, 2, indexed, palette);
		expect(
			await extract(
				kgd1File({
					bitsPerPixel: 8,
					width: 3,
					height: 2,
					pixels: indexed,
					palette,
				}),
			),
		).toEqual(normalised(expected));
		// The colour map the reference reads carries the fourth byte of every entry, which the writer keeps.
		expect(expected.readUInt8(54 + 3)).toBe(0x00);
	});

	it("turns the transparency of a twenty four bit picture over", async () => {
		const alpha: Buffer = Buffer.from([
			0x00, 0x0f, 0xf0, 0xff, 0x55, 0xaa, 0x01, 0x02, 0x03,
		]);
		const pixels24 = pixels.subarray(0, 9 * 3);
		const data = kgd1File({
			bitsPerPixel: 24,
			width: 3,
			height: 3,
			pixels: pixels24,
			alpha,
		});
		const expected: Buffer = Buffer.alloc(9 * 4, 0);
		for (let index = 0; index < 9; index += 1) {
			expected[index * 4] = pixels24[index * 3] ?? 0;
			expected[index * 4 + 1] = pixels24[index * 3 + 1] ?? 0;
			expected[index * 4 + 2] = pixels24[index * 3 + 2] ?? 0;
			expected[index * 4 + 3] = ~(alpha[index] ?? 0) & 0xff;
		}
		expect(await extract(data)).toEqual(normalised(writeBmp32(3, 3, expected)));
	});

	it("reads the colour of every pixel out of the colour map when it has transparency", async () => {
		const palette = paletteOf();
		const indexed: Buffer = Buffer.from([0, 1, 2, 3]);
		const alpha: Buffer = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
		const expected: Buffer = Buffer.alloc(4 * 4, 0);
		for (let index = 0; index < 4; index += 1) {
			const entry = (indexed[index] ?? 0) * 4;
			expected[index * 4] = palette[entry] ?? 0;
			expected[index * 4 + 1] = palette[entry + 1] ?? 0;
			expected[index * 4 + 2] = palette[entry + 2] ?? 0;
			expected[index * 4 + 3] = ~(alpha[index] ?? 0) & 0xff;
		}
		expect(
			await extract(
				kgd1File({
					bitsPerPixel: 8,
					width: 2,
					height: 2,
					pixels: indexed,
					palette,
					alpha,
				}),
			),
		).toEqual(normalised(writeBmp32(2, 2, expected)));
	});

	it("refuses a picture cut short of its pixels", async () => {
		const whole = kgd1File({ bitsPerPixel: 24, width: 5, height: 3, pixels });
		await expect(
			extract(whole.subarray(0, whole.length - 4)),
		).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses an indexed picture cut short of its colour map", async () => {
		const palette = paletteOf().subarray(0, 0x200);
		await expect(
			extract(
				kgd1File({
					bitsPerPixel: 8,
					width: 2,
					height: 2,
					pixels: Buffer.alloc(4),
					palette,
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture whose transparency does not cover it", async () => {
		await expect(
			extract(
				kgd1File({
					bitsPerPixel: 24,
					width: 3,
					height: 3,
					pixels: pixels.subarray(0, 9),
					alpha: Buffer.alloc(4, 0),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
