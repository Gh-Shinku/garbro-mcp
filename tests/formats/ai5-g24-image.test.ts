import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ai5G24ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

interface G24Options {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	/** The rows of the picture as the stream stores them: already aligned to four bytes. */
	rows?: Buffer[];
}

function buildG24(options: G24Options = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt16LE(options.offsetX ?? 0, 0);
	header.writeInt16LE(options.offsetY ?? 0, 2);
	header.writeInt16LE(options.width ?? 2, 4);
	header.writeInt16LE(options.height ?? 1, 6);
	const body = options.rows
		? Buffer.concat(options.rows)
		: Buffer.alloc((options.width ?? 2) * 3);
	return Buffer.concat([header, lzssLiterals(body)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.g24"): Promise<Buffer> {
	const archive = await ai5G24ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Ai5 engine RGB image (G24)", () => {
	it("takes its depth from the end of the file's name", async () => {
		expect(ai5G24ImageFormat.descriptor.extensions).toEqual([
			"g24",
			"g16",
			"g32",
		]);
		const file = buildG24({ width: 1, height: 1 });
		for (const [name, depth] of [
			["CG01.g24", 24],
			["CG01.G16", 16],
			["cg01.g32", 32],
			// Any other name is a picture of twenty four bits, as the reference's reader decides.
			["CG01.bmp", 24],
		] as [string, number][]) {
			expect(await ai5G24ImageFormat.detect(sourceOf(file), name)).toBe(true);
			const archive = await ai5G24ImageFormat.open(sourceOf(file), name);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: depth,
				});
				expect(archive.metadata).toMatchObject({
					compression: "lzss",
					bitsPerPixel: depth,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("holds its measurements and its positions to what the reference allows", async () => {
		expect(await ai5G24ImageFormat.detect(sourceOf(buildG24()), "a.g24")).toBe(
			true,
		);
		expect(
			await ai5G24ImageFormat.detect(
				sourceOf(buildG24({ offsetX: 0x800, offsetY: 0x800 })),
				"a.g24",
			),
		).toBe(true);
		expect(
			await ai5G24ImageFormat.detect(
				sourceOf(buildG24({ offsetX: 0x801 })),
				"a.g24",
			),
		).toBe(false);
		expect(
			await ai5G24ImageFormat.detect(
				sourceOf(buildG24({ offsetY: -1 })),
				"a.g24",
			),
		).toBe(false);
		expect(
			await ai5G24ImageFormat.detect(
				sourceOf(buildG24({ height: 0 })),
				"a.g24",
			),
		).toBe(false);
		expect(
			await ai5G24ImageFormat.detect(
				sourceOf(buildG24({ height: 0x1001 })),
				"a.g24",
			),
		).toBe(false);
		expect(
			await ai5G24ImageFormat.detect(sourceOf(Buffer.alloc(4, 0)), "a.g24"),
		).toBe(false);
	});

	it("reads the rows the stream pads and keeps the picture tight", async () => {
		// Three pixels a row are nine bytes, which a row of the stream carries in twelve.
		const file = buildG24({
			width: 3,
			height: 2,
			rows: [
				Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0xee, 0xee, 0xee]),
				Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 0xee, 0xee, 0xee]),
			],
		});
		const archive = await ai5G24ImageFormat.open(sourceOf(file), "CG01.g24");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
				offsetX: 0,
				offsetY: 0,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		expect(bmp.readInt32LE(22)).toBe(2);
		// The padding the stream carries is not part of the picture, so the bitmap pads the rows itself.
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 16)).toEqual(
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 0x00, 0x00, 0x00, 10, 11, 12, 13,
			]),
		);
	});

	it("writes the three depths the name can ask for", async () => {
		// A row of one pixel is four bytes however deep it is, which is what the stream has to carry.
		const one = () =>
			buildG24({ width: 1, height: 1, rows: [Buffer.alloc(4, 0)] });
		// Sixteen bits a pixel, five to a channel, as the reference's own reader asks for.
		expect(
			(await extract(one(), "a.g16")).subarray(
				BMP_HEADER_SIZE + 12,
				BMP_HEADER_SIZE + 14,
			),
		).toEqual(Buffer.from([0x00, 0x00]));
		expect(
			(await extract(one(), "a.g32")).subarray(
				BMP_HEADER_SIZE,
				BMP_HEADER_SIZE + 4,
			),
		).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x00]));
		// A row of one pixel of twenty four bits is padded by the bitmap, not by the stream.
		const narrow = await extract(one(), "a.g24");
		expect(narrow.readUInt16LE(28)).toBe(24);
		expect(narrow.length).toBe(BMP_HEADER_SIZE + 4);
	});

	it("stops when the stream carries less than the whole picture", async () => {
		const file = buildG24({ width: 3, height: 2, rows: [Buffer.alloc(12, 1)] });
		const archive = await ai5G24ImageFormat.open(sourceOf(file), "CG01.g24");
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
