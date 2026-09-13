import { BufferByteSource } from "@garbro-mcp/core";
import { ap3ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const BMP_HEADER_SIZE = 54;
const PALETTE_BYTES = 0x400;

interface Ap3Options {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	offsetX?: number;
	offsetY?: number;
	pixels?: Buffer;
}

function buildAp3(options: Ap3Options = {}): Buffer {
	const { width = 2, height = 2, bitsPerPixel = 32 } = options;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("AP-3", 0, "latin1");
	header.writeInt32LE(options.offsetX ?? 0, 4);
	header.writeInt32LE(options.offsetY ?? 0, 8);
	header.writeUInt32LE(width, 0x0c);
	header.writeUInt32LE(height, 0x10);
	header.writeInt32LE(bitsPerPixel, 0x14);
	const byteCount = (width * height * bitsPerPixel) / 8;
	const pixels =
		options.pixels ??
		Buffer.from(Array.from({ length: byteCount }, (_x, i) => (i % 0x40) + 1));
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "EV_001.ALP"): Promise<Buffer> {
	const archive = await ap3ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kaguya ap-3 image", () => {
	it("registers the four byte signature and the alp extension", () => {
		expect(ap3ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x41, 0x50, 0x2d, 0x33]) },
		]);
		expect(ap3ImageFormat.descriptor.extensions).toEqual(["alp"]);
	});

	it("accepts the three depths and reports the origin", async () => {
		for (const bitsPerPixel of [8, 24, 32]) {
			const file = buildAp3({ bitsPerPixel, offsetX: 3, offsetY: -6 });
			expect(await ap3ImageFormat.detect(sourceOf(file), "A.ALP")).toBe(true);
			const archive = await ap3ImageFormat.open(sourceOf(file), "A.ALP");
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					width: 2,
					height: 2,
					bitsPerPixel,
					offsetX: 3,
					offsetY: -6,
				});
				expect(archive.entries[0]?.sizeKnown).toBe(false);
			} finally {
				await archive.close();
			}
		}
		for (const bitsPerPixel of [0, 1, 4, 16, 31, 33, -8]) {
			expect(
				await ap3ImageFormat.detect(
					sourceOf(buildAp3({ bitsPerPixel })),
					"A.ALP",
				),
			).toBe(false);
		}
	});

	it("writes eight bit grayscale with the grey ramp", async () => {
		const file = buildAp3({
			width: 3,
			height: 2,
			bitsPerPixel: 8,
			pixels: Buffer.from([1, 2, 3, 4, 5, 6]),
		});
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(8);
		// `CreateFlipped` with a row stride of a third the buffer: a positive height and no reversal.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.readUInt32LE(46)).toBe(256);
		expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
		);
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_BYTES)).toEqual(
			Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]),
		);
	});

	it("pads the rows of a twenty four bit image", async () => {
		// Three pixels a row is nine bytes, which a bitmap widens to twelve.
		const pixels = Buffer.from([
			0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
			0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
		]);
		const output = await extract(
			buildAp3({ width: 3, height: 2, bitsPerPixel: 24, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x00, 0x00, 0x00,
				0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("copies thirty two bit pixels straight through", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const output = await extract(buildAp3({ bitsPerPixel: 32, pixels }));
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("fails on extraction when the pixel stream is short", async () => {
		const file = buildAp3({ bitsPerPixel: 24 });
		const truncated = file.subarray(0, file.length - 1);
		expect(await ap3ImageFormat.detect(sourceOf(truncated), "A.ALP")).toBe(
			true,
		);
		const archive = await ap3ImageFormat.open(sourceOf(truncated), "A.ALP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("checks the dimensions before the depth and declines a short header", async () => {
		expect(
			await ap3ImageFormat.detect(
				sourceOf(buildAp3({ width: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		expect(
			await ap3ImageFormat.detect(
				sourceOf(buildAp3({ height: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		// A file whose depth is invalid is declined even when its dimensions are fine.
		const wrongDepth = buildAp3({ bitsPerPixel: 32 });
		wrongDepth.writeInt32LE(16, 0x14);
		expect(await ap3ImageFormat.detect(sourceOf(wrongDepth), "A.ALP")).toBe(
			false,
		);
		expect(
			await ap3ImageFormat.detect(
				sourceOf(buildAp3().subarray(0, HEADER_SIZE - 1)),
				"A.ALP",
			),
		).toBe(false);
	});
});
