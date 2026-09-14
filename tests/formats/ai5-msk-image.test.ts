import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ai5Gp8ImageFormat, ai5MskImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PALETTE_BYTES = 0x100 * 4;
const BMP_HEADER_SIZE = 54;
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + PALETTE_BYTES;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

interface MskOptions {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	pixels?: Buffer;
	stream?: Buffer;
}

function buildMsk(options: MskOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt16LE(options.offsetX ?? 0, 0);
	header.writeInt16LE(options.offsetY ?? 0, 2);
	header.writeInt16LE(options.width ?? 2, 4);
	header.writeInt16LE(options.height ?? 1, 6);
	const stream =
		options.stream ?? lzssLiterals(options.pixels ?? Buffer.alloc(2, 0));
	return Buffer.concat([header, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await ai5MskImageFormat.open(sourceOf(file), "CG01.msk");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Ai5 engine image mask (MSK/AI5)", () => {
	it("claims the msk extension and no word", () => {
		expect(ai5MskImageFormat.detection?.signatures).toEqual([]);
		expect(ai5MskImageFormat.descriptor.extensions).toEqual(["msk"]);
	});

	it("allows its picture twice as far from the beginning as the indexed kind", async () => {
		expect(await ai5MskImageFormat.detect(sourceOf(buildMsk()), "a.msk")).toBe(
			true,
		);
		expect(
			await ai5MskImageFormat.detect(
				sourceOf(buildMsk({ offsetX: 0x800, offsetY: 0x800 })),
				"a.msk",
			),
		).toBe(true);
		expect(
			await ai5MskImageFormat.detect(
				sourceOf(buildMsk({ offsetX: 0x801 })),
				"a.msk",
			),
		).toBe(false);
		expect(
			await ai5MskImageFormat.detect(
				sourceOf(buildMsk({ height: 0 })),
				"a.msk",
			),
		).toBe(false);
		expect(
			await ai5MskImageFormat.detect(
				sourceOf(buildMsk({ height: 0x1001 })),
				"a.msk",
			),
		).toBe(false);
		// The reference reads its eight bytes without asking whether they are there.
		expect(
			await ai5MskImageFormat.detect(sourceOf(Buffer.alloc(4, 0)), "a.msk"),
		).toBe(false);
	});

	it("reads a picture both kinds would take, since only the extension tells them apart", async () => {
		// Nothing in a file of this shape tells the two kinds apart: the mask asks only that its picture lie
		// no further than two thousand and forty eight from the beginning, and three hundred is well inside
		// that, so the extension of the name decides which of them opens it.
		const file = buildMsk({
			offsetX: 0x40,
			offsetY: 0x20,
			width: 1,
			height: 1,
		});
		expect(await ai5MskImageFormat.detect(sourceOf(file), "a.msk")).toBe(true);
		expect(await ai5Gp8ImageFormat.detect(sourceOf(file), "a.gp8")).toBe(false);
		// The indexed kind wants a palette in front of its picture, which this file has not got, and a
		// picture at the beginning once it has one.
		const withPalette = Buffer.concat([
			file.subarray(0, HEADER_SIZE),
			Buffer.alloc(PALETTE_BYTES, 0x00),
			file.subarray(HEADER_SIZE),
		]);
		expect(await ai5MskImageFormat.detect(sourceOf(withPalette), "a.msk")).toBe(
			true,
		);
		expect(await ai5Gp8ImageFormat.detect(sourceOf(withPalette), "a.gp8")).toBe(
			true,
		);
	});

	it("writes a grey palette and carries where the picture belongs", async () => {
		const file = buildMsk({
			width: 2,
			height: 1,
			offsetX: 3,
			offsetY: 4,
			pixels: Buffer.from([5, 6]),
		});
		const archive = await ai5MskImageFormat.open(sourceOf(file), "CG01.msk");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// The mask carries its position into its measurements, unlike the indexed kind.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 1,
				bitsPerPixel: 8,
				offsetX: 3,
				offsetY: 4,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 2,
				height: 1,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.readUInt32LE(46)).toBe(0x100);
		expect(bmp.readInt32LE(22)).toBe(1);
		// A bitmap of this kind carries a palette of two hundred and fifty six levels of grey, so the fifth
		// entry of it is the fifth level.
		expect(
			bmp.subarray(BMP_HEADER_SIZE + 5 * 4, BMP_HEADER_SIZE + 5 * 4 + 4),
		).toEqual(Buffer.from([5, 5, 5, 0x00]));
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 4)).toEqual(
			Buffer.from([5, 6, 0x00, 0x00]),
		);
	});

	it("stops when the stream carries less than the whole picture", async () => {
		const file = buildMsk({
			width: 2,
			height: 2,
			stream: lzssLiterals(Buffer.from([1, 2, 3])),
		});
		const archive = await ai5MskImageFormat.open(sourceOf(file), "CG01.msk");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Truncated Ai5 image pixels",
			});
		} finally {
			await archive.close();
		}
	});
});
