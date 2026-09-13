import { BufferByteSource } from "@garbro-mcp/core";
import { opfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("OPF ", "latin1");
const HEADER_SIZE = 0x20;
const BMP_HEADER_SIZE = 54;

interface Fields {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	stride?: number;
	dataOffset?: number;
	dataLength?: number;
}

/** The stride a bitmap of this depth uses, which the stored stride may differ from. */
function bitmapStride(width: number, bitsPerPixel: number): number {
	return ((width * bitsPerPixel) / 8 + 3) & ~3;
}

function buildOpf(pixels: Buffer, fields: Fields = {}): Buffer {
	const width = fields.width ?? 2;
	const bitsPerPixel = fields.bitsPerPixel ?? 24;
	const stride = fields.stride ?? bitmapStride(width, bitsPerPixel);
	const height = fields.height ?? 2;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt32LE(bitsPerPixel, 0xc);
	header.writeInt32LE(stride, 0x10);
	header.writeInt32LE(fields.dataOffset ?? HEADER_SIZE, 0x14);
	header.writeInt32LE(fields.dataLength ?? pixels.length, 0x18);
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.OPF"): Promise<Buffer> {
	const archive = await opfImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

async function expectListingOnly(stored: Buffer): Promise<void> {
	expect(await opfImageFormat.detect(sourceOf(stored), "IMAGE.OPF")).toBe(true);
	const archive = await opfImageFormat.open(sourceOf(stored), "IMAGE.OPF");
	try {
		expect(archive.entries).toHaveLength(1);
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		await expect(archive.openEntry(entry.id)).rejects.toThrow();
	} finally {
		await archive.close();
	}
}

describe("hcsystem opf image", () => {
	it("declares the OPF signature and no extension", () => {
		expect(opfImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.readUInt32LE(0)).toBe(0x2046504f);
		expect(opfImageFormat.descriptor.extensions).toEqual([]);
	});

	it("carries rows through verbatim when the stored stride is the bitmap stride", async () => {
		// Two rows of two twenty four bit pixels: six bytes a row, padded to eight.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0xaa, 0xbb, 0x21, 0x22, 0x23, 0x31,
			0x32, 0x33, 0xcc, 0xdd,
		]);
		const stored = buildOpf(pixels);
		const source = sourceOf(stored);
		expect(await opfImageFormat.detect(source, "IMAGE.OPF")).toBe(true);
		const archive = await opfImageFormat.open(source, "IMAGE.OPF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				stride: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 2,
				stride: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		// `ImageData.Create` is top down, which a bitmap records with a negative height.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.readUInt32LE(34)).toBe(16);
		// The padding bytes are the producer's, so they survive into the bitmap unchanged.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("writes a thirty two bit image with its alpha", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24,
			0x31, 0x32, 0x33, 0x34,
		]);
		const stored = buildOpf(pixels, { bitsPerPixel: 32 });
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("repacks rows when the stored stride is wider than the bitmap stride", async () => {
		// Six bytes of pixels a row spaced twelve bytes apart: the two filler bytes a row are dropped.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee,
			0x21, 0x22, 0x23, 0x31, 0x32, 0x33, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee,
		]);
		const stored = buildOpf(pixels, { stride: 12 });
		const output = await extract(stored);
		expect(output.readUInt32LE(34)).toBe(16);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x00, 0x00, 0x21, 0x22, 0x23, 0x31,
				0x32, 0x33, 0x00, 0x00,
			]),
		);
	});

	it("fails when the stored stride is narrower than a row of pixels", async () => {
		// A bitmap source cannot be built when its stride is smaller than one row, so the reference throws.
		const stored = buildOpf(Buffer.alloc(12, 0x11), { stride: 4 });
		await expectListingOnly(stored);
	});

	it("lists an unsupported depth and fails when the pixels are asked for", async () => {
		// The metadata read only rejects a depth above thirty two, so sixteen lists and then throws.
		const stored = buildOpf(Buffer.alloc(8, 0x11), {
			bitsPerPixel: 16,
			stride: 8,
		});
		await expectListingOnly(stored);
	});

	it("lists a negative depth too, which the reference never rejects at metadata time", async () => {
		const stored = buildOpf(Buffer.alloc(8, 0x11), {
			bitsPerPixel: -24,
			stride: 8,
		});
		expect(await opfImageFormat.detect(sourceOf(stored), "IMAGE.OPF")).toBe(
			true,
		);
		await expectListingOnly(stored);
	});

	it("fails when the pixels run past the end of the file", async () => {
		const stored = buildOpf(Buffer.alloc(8, 0x11), {
			dataLength: 40,
			stride: 8,
		});
		await expectListingOnly(stored);
	});

	it("fails when the stored bytes are fewer than the stride needs", async () => {
		// A stride of eight needs sixteen bytes for two rows, and the file announces twelve, so the bitmap
		// would be reading past the stored pixels.
		const short = buildOpf(Buffer.alloc(12, 0x11), { stride: 8 });
		await expectListingOnly(short);
	});

	it("declines a data offset inside the header and a short file", async () => {
		const inside = buildOpf(Buffer.alloc(8, 0x11), {
			dataOffset: HEADER_SIZE - 1,
			stride: 8,
		});
		expect(await opfImageFormat.detect(sourceOf(inside), "IMAGE.OPF")).toBe(
			false,
		);
		expect(
			await opfImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.OPF",
			),
		).toBe(false);
		// A depth above thirty two is the other metadata time rejection.
		const deep = buildOpf(Buffer.alloc(8, 0x11), {
			bitsPerPixel: 33,
			stride: 8,
		});
		expect(await opfImageFormat.detect(sourceOf(deep), "IMAGE.OPF")).toBe(
			false,
		);
	});
});
