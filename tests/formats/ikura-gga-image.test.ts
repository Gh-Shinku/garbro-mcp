import { BufferByteSource } from "@garbro-mcp/core";
import { ggaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;
const MAX_DIMENSION = 0x7fff;

/** A literal-only LZSS stream: one control byte per eight literals, every bit set. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const group = data.subarray(i, i + 8);
		parts.push(
			Buffer.from([0xff >> Math.max(0, 8 - group.length)]),
			Buffer.from(group),
		);
	}
	return Buffer.concat(parts);
}

function buildGga(options: {
	width: number;
	height: number;
	pixels: Buffer;
	offsetX?: number;
	offsetY?: number;
	declaredSize?: number;
	trailer?: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt16LE(options.offsetX ?? 0, 0);
	header.writeInt16LE(options.offsetY ?? 0, 2);
	header.writeUInt16LE(options.width, 4);
	header.writeUInt16LE(options.height, 6);
	header.writeInt32LE(
		options.declaredSize ?? 3 * options.width * options.height,
		8,
	);
	return Buffer.concat([
		header,
		lzssLiterals(options.pixels),
		options.trailer ?? Buffer.alloc(0),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.GGA"): Promise<Buffer> {
	const archive = await ggaImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ikura gga image", () => {
	it("registers no signature and no extension", () => {
		// The reference's `Signature` is zero, so there is nothing for the registry to gate on.
		expect(ggaImageFormat.detection?.signatures ?? []).toEqual([]);
		expect(ggaImageFormat.descriptor.extensions).toEqual([]);
	});

	it("unpacks a top down twenty four bit bitmap", async () => {
		// Three by two pixels: nine bytes a row, padded to twelve in the bitmap.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31, 0x32, 0x33,
			0x41, 0x42, 0x43, 0x51, 0x52, 0x53,
		]);
		const stored = buildGga({ width: 3, height: 2, pixels });
		const source = sourceOf(stored);
		expect(await ggaImageFormat.detect(source, "IMAGE.GGA")).toBe(true);
		const archive = await ggaImageFormat.open(source, "IMAGE.GGA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({ width: 3, height: 2 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x00, 0x00, 0x00,
				0x31, 0x32, 0x33, 0x41, 0x42, 0x43, 0x51, 0x52, 0x53, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("keeps the header offsets out of the bitmap and in the metadata", async () => {
		const pixels = Buffer.alloc(12, 0x7e);
		const stored = buildGga({
			width: 2,
			height: 2,
			pixels,
			offsetX: 13,
			offsetY: 5,
		});
		const archive = await ggaImageFormat.open(sourceOf(stored), "IMAGE.GGA");
		try {
			expect(archive.metadata).toMatchObject({ offsetX: 13, offsetY: 5 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				offsetX: 13,
				offsetY: 5,
			});
		} finally {
			await archive.close();
		}
	});

	it("gates on the extension because it has no signature", async () => {
		const pixels = Buffer.alloc(12, 0x11);
		const stored = buildGga({ width: 2, height: 2, pixels });
		// The very same bytes with a different name are declined, which is the only thing that differs.
		expect(await ggaImageFormat.detect(sourceOf(stored), "IMAGE.BIN")).toBe(
			false,
		);
		expect(await ggaImageFormat.detect(sourceOf(stored), "IMAGE.GGA")).toBe(
			true,
		);
		expect(await ggaImageFormat.detect(sourceOf(stored), "image.gga")).toBe(
			true,
		);
	});

	it("declines a negative offset because the offsets are signed", async () => {
		const pixels = Buffer.alloc(12, 0x11);
		const negative = buildGga({ width: 2, height: 2, pixels, offsetX: -1 });
		// `ReadInt16` reads -1 from ffff, and the reference rejects anything below zero.
		expect(negative.readInt16LE(0)).toBe(-1);
		expect(await ggaImageFormat.detect(sourceOf(negative), "IMAGE.GGA")).toBe(
			false,
		);
		const stored = buildGga({ width: 2, height: 2, pixels });
		expect(await ggaImageFormat.detect(sourceOf(stored), "IMAGE.GGA")).toBe(
			true,
		);
	});

	it("requires the announced size to be three bytes a pixel", async () => {
		const pixels = Buffer.alloc(12, 0x11);
		const wrong = buildGga({ width: 2, height: 2, pixels, declaredSize: 13 });
		expect(await ggaImageFormat.detect(sourceOf(wrong), "IMAGE.GGA")).toBe(
			false,
		);
		const good = buildGga({ width: 2, height: 2, pixels });
		expect(good.readInt32LE(8)).toBe(12);
		expect(await ggaImageFormat.detect(sourceOf(good), "IMAGE.GGA")).toBe(true);
	});

	it("declines zero and oversized dimensions", async () => {
		const pixels = Buffer.alloc(12, 0x11);
		const zero = buildGga({ width: 0, height: 2, pixels, declaredSize: 0 });
		expect(await ggaImageFormat.detect(sourceOf(zero), "IMAGE.GGA")).toBe(
			false,
		);
		const wide = buildGga({
			width: MAX_DIMENSION + 1,
			height: 1,
			pixels,
			declaredSize: 0,
		});
		expect(await ggaImageFormat.detect(sourceOf(wide), "IMAGE.GGA")).toBe(
			false,
		);
		// A file shorter than the header is declined rather than thrown on.
		expect(
			await ggaImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.GGA",
			),
		).toBe(false);
	});

	it("lists a header with no payload and fails when it is extracted", async () => {
		// The reference's `ReadMetaData` reads twelve bytes and nothing else.
		const headerOnly: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		headerOnly.writeUInt16LE(1, 4);
		headerOnly.writeUInt16LE(1, 6);
		headerOnly.writeInt32LE(3, 8);
		expect(await ggaImageFormat.detect(sourceOf(headerOnly), "IMAGE.GGA")).toBe(
			true,
		);
		const archive = await ggaImageFormat.open(
			sourceOf(headerOnly),
			"IMAGE.GGA",
		);
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fails when the stream is shorter than the announced size", async () => {
		// Twelve bytes are stored for eighteen announced: the reference insists on reading all of them.
		const stored = buildGga({
			width: 3,
			height: 2,
			pixels: Buffer.alloc(12, 0x22),
		});
		expect(await ggaImageFormat.detect(sourceOf(stored), "IMAGE.GGA")).toBe(
			true,
		);
		const archive = await ggaImageFormat.open(sourceOf(stored), "IMAGE.GGA");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("ignores bytes after the payload", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31, 0x32, 0x33,
		]);
		const stored = buildGga({
			width: 2,
			height: 2,
			pixels,
			trailer: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
		});
		const output = await extract(stored);
		expect(output.readInt32LE(34)).toBe(16);
		// Two pixels a row pad to eight bytes, so the body carries two zero bytes a row.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x00, 0x00, 0x21, 0x22, 0x23, 0x31,
				0x32, 0x33, 0x00, 0x00,
			]),
		);
	});

	it("accepts a size that only matches because the reference multiplies as a signed integer", async () => {
		// Three times 32767 squared is 3221028867, which a signed thirty two bit integer cannot hold: the
		// reference's check wraps to -1073938429, so a file announcing that value passes its metadata read.
		expect((3 * 0x7fff * 0x7fff) | 0).toBe(-1073938429);
		const huge: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		huge.writeUInt16LE(0x7fff, 4);
		huge.writeUInt16LE(0x7fff, 6);
		huge.writeInt32LE(-1073938429, 8);
		expect(await ggaImageFormat.detect(sourceOf(huge), "IMAGE.GGA")).toBe(true);
		// The reference would then try to allocate a negatively sized array, so extraction fails.
		const archive = await ggaImageFormat.open(sourceOf(huge), "IMAGE.GGA");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
