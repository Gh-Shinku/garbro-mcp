import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ai5HizImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("hiz\0", "latin1");
const DATA_OFFSET = 0x4c;
const BMP_HEADER_SIZE = 54;
const WIDTH_XOR = 0xaa5a5a5a;
const HEIGHT_XOR = 0xac9326af;
const SIZE_XOR = 0x19739d6a;
const OTHER_FORMAT_WORD = 0x375a8436;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

interface HizOptions {
	width?: number;
	height?: number;
	/** The four planes of the picture, one byte of every pixel each. */
	planes?: Buffer;
	count?: number;
	mark?: number;
	/** The size the header carries, which has to be the pixels of the picture. */
	size?: number;
	stream?: Buffer;
}

function buildHiz(options: HizOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	// The bytes between the fields the reference reads and the picture are never looked at.
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0xee);
	SIGNATURE.copy(header, 0);
	header.writeInt32LE(options.count ?? 100, 4);
	header.writeUInt32LE((width ^ WIDTH_XOR) >>> 0, 8);
	header.writeUInt32LE((height ^ HEIGHT_XOR) >>> 0, 0xc);
	header.writeInt32LE(options.mark ?? 0, 0x10);
	header.writeUInt32LE(
		((options.size ?? width * height * 4) ^ SIZE_XOR) >>> 0,
		0x14,
	);
	const stream =
		options.stream ??
		lzssLiterals(options.planes ?? Buffer.alloc(width * height * 4, 0));
	return Buffer.concat([header, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await ai5HizImageFormat.open(sourceOf(file), "CG01.hiz");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("elf bitmap format (HIZ)", () => {
	it("finds its files by its word and a header behind it", async () => {
		expect(ai5HizImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(await ai5HizImageFormat.detect(sourceOf(buildHiz()), "a.hiz")).toBe(
			true,
		);
		// The count behind the word has to be a hundred.
		expect(
			await ai5HizImageFormat.detect(
				sourceOf(buildHiz({ count: 101 })),
				"a.hiz",
			),
		).toBe(false);
		expect(
			await ai5HizImageFormat.detect(
				sourceOf(buildHiz({ mark: OTHER_FORMAT_WORD })),
				"a.hiz",
			),
		).toBe(false);
		// The size has to be exactly the pixels of the measurements.
		expect(
			await ai5HizImageFormat.detect(
				sourceOf(buildHiz({ size: 2 * 2 * 4 + 4 })),
				"a.hiz",
			),
		).toBe(false);
		expect(
			await ai5HizImageFormat.detect(sourceOf(buildHiz({ width: 0 })), "a.hiz"),
		).toBe(false);
		expect(
			await ai5HizImageFormat.detect(sourceOf(Buffer.alloc(8, 0)), "a.hiz"),
		).toBe(false);
		expect(
			await ai5HizImageFormat.detect(
				sourceOf(
					Buffer.concat([
						Buffer.from("hiy\0", "latin1"),
						Buffer.alloc(0x60, 0),
					]),
				),
				"a.hiz",
			),
		).toBe(false);
	});

	it("weaves the four planes of the picture into whole pixels", async () => {
		const planes = Buffer.concat([
			Buffer.from([1, 2, 3, 4]),
			Buffer.from([5, 6, 7, 8]),
			Buffer.from([9, 10, 11, 12]),
			Buffer.from([13, 14, 15, 16]),
		]);
		const file = buildHiz({ width: 2, height: 2, planes });
		const archive = await ai5HizImageFormat.open(sourceOf(file), "CG01.hiz");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				dataOffset: DATA_OFFSET,
			});
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(bmp.readInt32LE(22)).toBe(-2);
		// Blue, green, red and alpha of each pixel, one plane after the other.
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 16)).toEqual(
			Buffer.from([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]),
		);
	});

	it("stops when the stream carries less than the whole picture", async () => {
		const file = buildHiz({
			width: 2,
			height: 2,
			stream: lzssLiterals(Buffer.alloc(15, 0x11)),
		});
		const archive = await ai5HizImageFormat.open(sourceOf(file), "CG01.hiz");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Unexpected end of file",
			});
		} finally {
			await archive.close();
		}
	});

	it("reads nothing behind the last pixel of the stream", async () => {
		const file = Buffer.concat([
			// One pixel of four planes: a blue byte and three of nothing.
			buildHiz({ width: 1, height: 1, planes: Buffer.from([7, 0, 0, 0]) }),
			Buffer.from([0xaa, 0xbb]),
		]);
		expect(await ai5HizImageFormat.detect(sourceOf(file), "a.hiz")).toBe(true);
		const bmp = await extract(file);
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([7, 0x00, 0x00, 0x00]),
		);
	});
});
