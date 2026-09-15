import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readSgxLayout,
	umesoftSgxImageFormat,
} from "../../packages/formats/src/umesoft/sgx-image.js";

const GRX_HEADER_SIZE = 0x10;
/** The place the picture of a fixture stands at, which has to stand behind the header of the file. */
const SGX_HEADER_SIZE = 0x10;
const DATA_OFFSET = 0x36;
const GREY_DATA_OFFSET = 0x36 + 0x400;

/** A run of pixels that stand in the stream themselves. */
function raw(pixels: number[], bytesPerPixel = 1): Buffer {
	const count = pixels.length / bytesPerPixel;
	const low = count - 1;
	const head =
		low < 4 ? [0x08 | low] : [0x08 | 0x04 | (low & 3), (low - (low & 3)) >> 2];
	return Buffer.concat([Buffer.from(head), Buffer.from(pixels)]);
}

interface PictureParts {
	width: number;
	height: number;
	bitsPerPixel: number;
	rows: Buffer[];
	packed?: boolean;
	alphaRows?: Buffer[];
}

/** A picture of the U-Me Soft kind, whole and standing on its own. */
function grxFile(parts: PictureParts): Buffer {
	const packed = parts.packed ?? true;
	const head: Buffer = Buffer.alloc(GRX_HEADER_SIZE, 0x00);
	Buffer.from([0x47, 0x52, 0x58, 0x1a]).copy(head, 0);
	head[4] = packed ? 1 : 0;
	head[5] = parts.alphaRows ? 1 : 0;
	head.writeUInt16LE(parts.bitsPerPixel, 6);
	head.writeUInt16LE(parts.width, 8);
	head.writeUInt16LE(parts.height, 10);
	const rows = Buffer.concat(parts.rows);
	head.writeInt32LE(parts.alphaRows ? rows.length : 0, 12);
	return Buffer.concat([
		head,
		rows,
		parts.alphaRows ? Buffer.concat(parts.alphaRows) : Buffer.alloc(0),
	]);
}

/** A whole file: the header of the multi-frame format and the picture behind it at the place it names. */
function sgxFile(
	offset: number,
	picture: Buffer,
	parts: { offset?: number } = {},
): Buffer {
	const head: Buffer = Buffer.alloc(Math.max(offset, SGX_HEADER_SIZE), 0x00);
	Buffer.from([0x53, 0x47, 0x58, 0x1a]).copy(head, 0);
	head.writeInt32LE(parts.offset ?? offset, 4);
	return Buffer.concat([head, picture]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.grx"): Promise<Buffer> {
	const handle = await umesoftSgxImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap, row by row, from behind whatever stands in front of them. */
function pixelRows(
	bitmap: Buffer,
	width: number,
	height: number,
	bytesPerPixel = 4,
	offset = DATA_OFFSET,
): string[] {
	const stride = (width * bytesPerPixel + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					offset + row * stride,
					offset + row * stride + width * bytesPerPixel,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("U-Me Soft multi-frame picture format", () => {
	it("finds a picture by its four bytes and the place it names", async () => {
		const picture = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [raw([1, 2, 3, 4])],
		});
		const data = sgxFile(SGX_HEADER_SIZE, picture);
		expect(await umesoftSgxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		expect(readSgxLayout(data)).toMatchObject({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			packed: true,
			grxOffset: SGX_HEADER_SIZE,
		});
		// The place has to stand behind the header and the picture of the U-Me Soft kind has to stand there.
		expect(
			readSgxLayout(sgxFile(0x10, picture, { offset: 8 })),
		).toBeUndefined();
		expect(
			readSgxLayout(sgxFile(SGX_HEADER_SIZE, Buffer.alloc(0x20, 0x00))),
		).toBeUndefined();
		expect(
			readSgxLayout(sgxFile(SGX_HEADER_SIZE, picture, { offset: 0x100 })),
		).toBeUndefined();
		const odd = Buffer.from(data);
		odd.write("SGX\x1B", 0, "latin1");
		expect(readSgxLayout(odd)).toBeUndefined();
		expect(
			readSgxLayout(Buffer.alloc(SGX_HEADER_SIZE - 1, 0x00)),
		).toBeUndefined();
	});

	it("reports the measurements of the picture behind the place it names", async () => {
		const picture = grxFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			rows: [raw([1, 2, 3, 0, 4, 5, 6, 0], 4)],
		});
		const handle = await umesoftSgxImageFormat.open(
			sourceOf(sgxFile(0x20, picture)),
			"dir/cg.grx",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		// A picture of three bytes to the pixel is written out with four, which is what the reference does.
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 3,
			height: 2,
			bitsPerPixel: 32,
		});
	});

	it("reads the pixels of a picture that stands behind the place it names", async () => {
		const picture = grxFile({
			width: 8,
			height: 2,
			bitsPerPixel: 8,
			rows: [
				raw([1, 2, 3, 4, 5, 6, 7, 8]),
				raw([9, 10, 11, 12, 13, 14, 15, 16]),
			],
		});
		const bitmap = await extract(sgxFile(0x20, picture));
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(pixelRows(bitmap, 8, 2, 1, GREY_DATA_OFFSET)).toEqual([
			"0102030405060708",
			"090a0b0c0d0e0f10",
		]);
	});

	it("takes the plane of alpha of the picture as the fourth byte of a picture of three", async () => {
		const picture = grxFile({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			rows: [raw([0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 3)],
			alphaRows: [raw([0x99, 0x88])],
		});
		const bitmap = await extract(sgxFile(SGX_HEADER_SIZE, picture));
		expect(pixelRows(bitmap, 2, 1)).toEqual(["1122339944556688"]);
	});

	it("refuses a run that copies from before the start of the picture", async () => {
		// The first run of the picture copies the row above it, where there is none.
		const picture = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [Buffer.from([0x18])],
		});
		const data = sgxFile(SGX_HEADER_SIZE, picture);
		expect(await umesoftSgxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"U-Me Soft picture copies from before its start",
		);
	});

	it("refuses a stream that runs out inside the picture", async () => {
		const picture = grxFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			rows: [Buffer.from([0x0c, 1, 2])],
		});
		await expect(extract(sgxFile(SGX_HEADER_SIZE, picture))).rejects.toThrow(
			"U-Me Soft picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const picture = grxFile({
			width: 0xffff,
			height: 0xffff,
			bitsPerPixel: 8,
			rows: [raw([1])],
		});
		const data = sgxFile(SGX_HEADER_SIZE, picture);
		expect(await umesoftSgxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the fields of the picture behind the place it names", () => {
		const picture = grxFile({
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			rows: [raw([0x5a])],
		});
		const layout = readSgxLayout(sgxFile(0x10, picture));
		expect(layout?.grxOffset).toBe(0x10);
		expect(layout?.alpha).toBe(false);
		expect(layout?.alphaOffset).toBe(0);
	});
});
