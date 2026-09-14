import { BufferByteSource } from "@garbro-mcp/core";
import { fc01AcdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1c;
const GREY_PIXEL_OFFSET = 54 + 0x100 * 4;

/** Builds a literal only mrg lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

/** Packs the bits the decoder reads, most significant bit of each byte first. */
function packBits(bits: number[]): Buffer {
	const output: number[] = [];
	for (let start = 0; start < bits.length; start += 8) {
		let byte = 0;
		for (let index = 0; index < 8; index += 1) {
			byte = (byte << 1) | (bits[start + index] ?? 0);
		}
		output.push(byte);
	}
	return Buffer.from(output);
}

interface AcdOptions {
	width?: number;
	height?: number;
	/** The bits the decoder reads, which are packed and then wrapped in the mrg stream. */
	bits?: number[];
	/** Replaces the pixel stream outright. */
	plain?: Buffer;
	version?: string;
	headerSize?: number;
	dataOffset?: number;
	packedSize?: number;
	marker?: string;
	/** Bytes behind the packed stream, which the reader should not need. */
	trailing?: number;
}

function buildAcd(options: AcdOptions = {}): Buffer {
	const width = options.width ?? 4;
	const height = options.height ?? 1;
	const plain =
		options.plain ??
		packBits(options.bits ?? new Array(width * height).fill(0));
	const packed = literalStream(plain);
	const dataOffset = options.dataOffset ?? HEADER_SIZE;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "ACD ", 0, "latin1");
	header.write(options.version ?? "1.00", 4, "latin1");
	header.writeInt32LE(options.headerSize ?? dataOffset, 8);
	header.writeInt32LE(options.packedSize ?? packed.length, 0x0c);
	header.writeInt32LE(plain.length, 0x10);
	header.writeUInt32LE(width, 0x14);
	header.writeUInt32LE(height, 0x18);
	const filler: Buffer = Buffer.alloc(
		Math.max(0, dataOffset - HEADER_SIZE),
		0x00,
	);
	return Buffer.concat([
		header,
		filler,
		packed,
		Buffer.alloc(options.trailing ?? 0, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.acd"): Promise<Buffer> {
	const archive = await fc01AcdImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("F&C Co. image", () => {
	it("declares its word, which is what finds the file", async () => {
		expect(fc01AcdImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("ACD ", "latin1") },
		]);
		expect(fc01AcdImageFormat.descriptor.extensions).toEqual([]);
		expect(
			await fc01AcdImageFormat.detect(sourceOf(buildAcd()), "CG01.acd"),
		).toBe(true);
		// The reference throws for a version it does not know rather than declining the file.
		expect(
			await fc01AcdImageFormat.detect(
				sourceOf(buildAcd({ version: "2.00" })),
				"CG01.acd",
			),
		).toBe(true);
		expect(
			await fc01AcdImageFormat.detect(
				sourceOf(buildAcd({ marker: "ACDx" })),
				"CG01.acd",
			),
		).toBe(false);
		expect(
			await fc01AcdImageFormat.detect(sourceOf(Buffer.alloc(8)), "CG01.acd"),
		).toBe(false);
	});

	it("throws for a version, a header size and an offset it cannot take", async () => {
		await expect(extract(buildAcd({ version: "2.00" }))).rejects.toThrow(
			/ACD image version/,
		);
		await expect(extract(buildAcd({ headerSize: 0x10 }))).rejects.toThrow(
			/ACD image version/,
		);
		await expect(extract(buildAcd({ dataOffset: 0x10 }))).rejects.toThrow(
			/ACD image version/,
		);
	});

	it("reads its measurements and its sizes from the header", async () => {
		const archive = await fc01AcdImageFormat.open(
			sourceOf(buildAcd({ width: 8, height: 4, bits: new Array(32).fill(0) })),
			"CG01.acd",
		);
		try {
			// The reference describes twenty four bits and builds a grey bitmap from what it decodes.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 8,
				height: 4,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "mrg-lzss",
			});
		} finally {
			await archive.close();
		}
	});

	it("reads a zero bit as black and two set bits as white", async () => {
		const black = await extract(
			buildAcd({ width: 4, height: 1, bits: [0, 0, 0, 0] }),
		);
		expect(black.readUInt16LE(28)).toBe(8);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(black.readInt32LE(22)).toBe(-1);
		expect(black.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0, 0, 0, 0]),
		);
		const white = await extract(
			buildAcd({ width: 4, height: 1, bits: [1, 1, 1, 1, 1, 1, 1, 1] }),
		);
		expect(white.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0xff, 0xff, 0xff, 0xff]),
		);
	});

	it("scales the seven bits that follow a set and a clear bit", async () => {
		// The code is a set bit, a clear one and seven more; a number of one is the smallest level there is.
		const one = await extract(
			buildAcd({
				width: 1,
				height: 1,
				plain: packBits([1, 0, 0, 0, 0, 0, 0, 0, 1]),
			}),
		);
		expect(one.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 1)).toEqual(
			Buffer.from([5]),
		);
		// A number of zero is black as well.
		const zero = await extract(
			buildAcd({
				width: 1,
				height: 1,
				plain: packBits([1, 0, 0, 0, 0, 0, 0, 0, 0]),
			}),
		);
		expect(zero.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 1)).toEqual(
			Buffer.from([0]),
		);
		// The product of the largest number of those seven bits wraps in the reference's thirty two bit
		// multiply, so a hundred and twenty seven lands at seventy rather than at its own level.
		const huge = await extract(
			buildAcd({
				width: 1,
				height: 1,
				plain: packBits([1, 0, 1, 1, 1, 1, 1, 1, 1]),
			}),
		);
		expect(huge.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 1)).toEqual(
			Buffer.from([70]),
		);
	});

	it("unfolds a stream that runs over several control bytes", async () => {
		// Nine pixels of the smallest level: eighteen bits, so the mrg stream needs three control bytes.
		const bits: number[] = [];
		for (let pixel = 0; pixel < 9; pixel += 1)
			bits.push(1, 0, 0, 0, 0, 0, 0, 0, 1);
		const plain = packBits(bits);
		expect(plain.length).toBeGreaterThan(8);
		const output = await extract(buildAcd({ width: 9, height: 1, plain }));
		expect(output.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 9)).toEqual(
			Buffer.alloc(9, 0x05),
		);
	});

	it("stops at the size of the packed stream it was given", async () => {
		const bits: number[] = [1, 1, 1, 1];
		const plain = packBits(bits);
		const withJunk = await extract(
			buildAcd({ width: 2, height: 1, plain, trailing: 32 }),
		);
		const withoutJunk = await extract(buildAcd({ width: 2, height: 1, plain }));
		expect(withJunk.equals(withoutJunk)).toBe(true);
		expect(withJunk.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 2)).toEqual(
			Buffer.from([0xff, 0xff]),
		);
	});

	it("refuses a stream that stops in the middle of a pixel", async () => {
		// Nine pixels need more than the eight bits a single byte holds, and the stream is only that byte long.
		const nine = buildAcd({ width: 9, height: 1, plain: Buffer.from([0x00]) });
		await expect(extract(nine)).rejects.toThrow(/ends in the middle/);
	});

	it("names the entry after the image", async () => {
		const archive = await fc01AcdImageFormat.open(
			sourceOf(buildAcd()),
			"sub/CG07.acd",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
