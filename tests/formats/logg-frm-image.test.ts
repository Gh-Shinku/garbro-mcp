import { BufferByteSource } from "@garbro-mcp/core";
import { frmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const PALETTE_SIZE = 0x400;
const BMP_HEADER_SIZE = 54;
const SIGNATURE = Buffer.from([0x46, 0x52, 0x4d, 0x00]);

const WIDTH = 5;
const HEIGHT = 3;

/** Four distinct palette quads so a copied palette cannot be mistaken for a generated grey ramp. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let i = 0; i < PALETTE_SIZE; i += 1) palette[i] = (i * 3) & 0xff;
	palette[0] = 0x10;
	palette[1] = 0x20;
	palette[2] = 0x30;
	palette[3] = 0xff;
	palette[4] = 0x40;
	palette[5] = 0x50;
	palette[6] = 0x60;
	palette[7] = 0x00;
	return palette;
}

interface Built {
	file: Buffer;
	/// The compact pixel rows the bitmap should contain.
	pixels: Buffer;
	palette: Buffer;
	stride: number;
}

function buildFrm(
	options: {
		width?: number;
		height?: number;
		stride?: number;
		truncate?: number;
	} = {},
): Built {
	const width = options.width ?? WIDTH;
	const height = options.height ?? HEIGHT;
	const stride = options.stride ?? width;
	const palette = buildPalette();
	const raw: Buffer = Buffer.alloc(stride * height, 0x2e);
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let row = 0; row < height; row += 1) {
		for (let col = 0; col < width; col += 1) {
			const value = (row * width + col) & 0xff;
			raw[row * stride + col] = value;
			pixels[row * width + col] = value;
		}
		// Row padding must not survive into the bitmap.
		for (let col = width; col < stride; col += 1)
			raw[row * stride + col] = 0xee;
	}
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt32LE(stride, 0x0c);
	const file = Buffer.concat([header, palette, raw]);
	return {
		file:
			options.truncate === undefined
				? file
				: file.subarray(0, file.length - options.truncate),
		pixels,
		palette,
		stride,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("logg frm image", () => {
	it("declares the FRM signature and the frm extension", () => {
		expect(frmImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("writes a palettised bitmap with the stored palette", async () => {
		const built = buildFrm();
		const source = sourceOf(built.file);
		expect(await frmImageFormat.detect(source, "FACE.FRM")).toBe(true);
		const archive = await frmImageFormat.open(source, "FACE.FRM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["FACE.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				stride: WIDTH,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16BE(0)).toBe(0x424d);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + PALETTE_SIZE);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(46)).toBe(256);
			// Top down rows, as `ImageData.Create` produces.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			// The palette reaches the bitmap unchanged, and is not a grey ramp.
			expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 8)).toEqual(
				built.palette.subarray(0, 8),
			);
			const stride = (WIDTH + 3) & ~3;
			const body = output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE);
			expect(body.length).toBe(stride * HEIGHT);
			for (let row = 0; row < HEIGHT; row += 1) {
				expect(body.subarray(row * stride, row * stride + WIDTH)).toEqual(
					built.pixels.subarray(row * WIDTH, row * WIDTH + WIDTH),
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("drops row padding when the stride is wider than the image", async () => {
		const built = buildFrm({ stride: 16 });
		const archive = await frmImageFormat.open(sourceOf(built.file), "FACE.FRM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const body = output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE);
			const stride = (WIDTH + 3) & ~3;
			for (let row = 0; row < HEIGHT; row += 1) {
				const line = body.subarray(row * stride, row * stride + stride);
				expect(line.subarray(0, WIDTH)).toEqual(
					built.pixels.subarray(row * WIDTH, row * WIDTH + WIDTH),
				);
				// The stored 0xEE padding never appears.
				expect(line.includes(0xee)).toBe(false);
			}
		} finally {
			await archive.close();
		}
	});

	it("declines a stride narrower than the image", async () => {
		const built = buildFrm({ stride: WIDTH - 1 });
		expect(await frmImageFormat.detect(sourceOf(built.file), "FACE.FRM")).toBe(
			false,
		);
	});

	it("declines pixel data that runs past the end of the file", async () => {
		const built = buildFrm({ truncate: 4 });
		// Listing needs the header only, so the file is still recognised.
		expect(await frmImageFormat.detect(sourceOf(built.file), "FACE.FRM")).toBe(
			true,
		);
		const archive = await frmImageFormat.open(sourceOf(built.file), "FACE.FRM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(
				/Invalid Logg FRM image/,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions", async () => {
		const built = buildFrm({ width: 0 });
		expect(await frmImageFormat.detect(sourceOf(built.file), "FACE.FRM")).toBe(
			false,
		);
	});

	it("declines a different signature", async () => {
		const built = buildFrm();
		built.file[3] = 0x01;
		expect(await frmImageFormat.detect(sourceOf(built.file), "FACE.FRM")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await frmImageFormat.detect(sourceOf(Buffer.alloc(8)), "FACE.FRM"),
		).toBe(false);
	});
});
