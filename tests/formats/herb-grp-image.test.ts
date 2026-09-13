import { BufferByteSource } from "@garbro-mcp/core";
import { grpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x28;
const PALETTE_BYTES = 0x400;

interface GrpOptions {
	depth?: number;
	width?: number;
	height?: number;
	stride?: number;
	marker?: number;
	field4?: number;
	field8?: number;
	palette?: Buffer;
	stream?: Buffer;
}

function depthToBpp(depth: number): number {
	return depth === 0x08 ? 8 : depth === 0x18 ? 16 : 24;
}

/** The stride a bitmap of this width and depth would use, for fixtures that want a tight one. */
function strideFor(width: number, bitsPerPixel: number): number {
	return ((width * bitsPerPixel) / 8 + 3) & ~3;
}

function buildGrp(options: GrpOptions = {}): Buffer {
	const depth = options.depth ?? 0x18;
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const stride = options.stride ?? strideFor(width, depthToBpp(depth));
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header[0] = options.marker ?? depth;
	header.writeInt32LE(options.field4 ?? 0, 4);
	header.writeInt32LE(options.field8 ?? 1, 8);
	header.writeInt32LE(stride, 0x0c);
	header.writeUInt32LE(width, 0x20);
	header.writeUInt32LE(height, 0x24);
	// The file always reserves a palette's worth of space, whether or not the depth uses one.
	const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
	if (options.palette) options.palette.copy(palette, 0);
	const stream =
		options.stream ??
		deflateSync(Buffer.alloc(Math.max(0, stride * height), 0x00));
	return Buffer.concat([header, palette, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.grp"): Promise<Buffer> {
	const archive = await grpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Herb image", () => {
	it("knows only the three depths, and checks the two fixed words", async () => {
		for (const depth of [0x08, 0x18, 0x20]) {
			expect(
				await grpImageFormat.detect(sourceOf(buildGrp({ depth })), "A.grp"),
			).toBe(true);
		}
		for (const depth of [0x10, 0x02, 0x00, 0xff]) {
			expect(
				await grpImageFormat.detect(
					sourceOf(buildGrp({ marker: depth })),
					"A.grp",
				),
			).toBe(false);
		}
		expect(
			await grpImageFormat.detect(sourceOf(buildGrp({ field4: 1 })), "A.grp"),
		).toBe(false);
		expect(
			await grpImageFormat.detect(sourceOf(buildGrp({ field8: 0 })), "A.grp"),
		).toBe(false);
	});

	it("takes the bit depth from the first byte", async () => {
		const expected: Array<[number, number]> = [
			[0x08, 8],
			[0x18, 16],
			[0x20, 24],
		];
		for (const [depth, bitsPerPixel] of expected) {
			const archive = await grpImageFormat.open(
				sourceOf(buildGrp({ depth, width: 5, height: 3 })),
				"A.grp",
			);
			try {
				expect(archive.metadata).toMatchObject({
					width: 5,
					height: 3,
					bitsPerPixel,
				});
				expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel });
			} finally {
				await archive.close();
			}
		}
	});

	it("copies a tight twenty four bit image", async () => {
		// Four pixels a row at three bytes each is already a bitmap's stride.
		const pixels: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
			0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
		]);
		const output = await extract(
			buildGrp({
				depth: 0x20,
				width: 4,
				height: 2,
				stream: deflateSync(pixels),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands the image over unflipped, so the bitmap is top down.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54)).toEqual(pixels);
	});

	it("trims stored rows that are wider than the bitmap's", async () => {
		// One pixel a row at three bytes each: a bitmap row is four bytes, the file's is eight.
		const stored: Buffer = Buffer.from([
			0xa1, 0xa2, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0xb1, 0xb2, 0xb3, 0x00,
			0x00, 0x00, 0x00, 0x00,
		]);
		const output = await extract(
			buildGrp({
				depth: 0x20,
				width: 1,
				height: 2,
				stride: 8,
				stream: deflateSync(stored),
			}),
		);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0xa1, 0xa2, 0xa3, 0x00, 0xb1, 0xb2, 0xb3, 0x00]),
		);
	});

	it("writes sixteen bit rows with the bit field masks", async () => {
		// Two stored rows of three pixels each with two bytes of pad, which the bitmap must replace with zeros.
		const pixels: Buffer = Buffer.from([
			0x1f, 0x00, 0xe0, 0x03, 0x00, 0x7c, 0xaa, 0xaa, 0x11, 0x22, 0x33, 0x44,
			0x55, 0x66, 0xbb, 0xbb,
		]);
		const output = await extract(
			buildGrp({
				depth: 0x18,
				width: 3,
				height: 2,
				stream: deflateSync(pixels),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(16);
		expect(output.readUInt32LE(30)).toBe(3); // BI_BITFIELDS
		expect(output.readUInt32LE(10)).toBe(66);
		expect(output.readUInt32LE(54)).toBe(0x7c00);
		expect(output.readUInt32LE(58)).toBe(0x03e0);
		expect(output.readUInt32LE(62)).toBe(0x001f);
		expect(output.subarray(66)).toEqual(
			Buffer.from([
				0x1f, 0x00, 0xe0, 0x03, 0x00, 0x7c, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44,
				0x55, 0x66, 0x00, 0x00,
			]),
		);
	});

	it("swaps red and blue in the palette of an eight bit image", async () => {
		const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
		// Entry one is stored red, green, blue, spare.
		palette[4] = 0x11;
		palette[5] = 0x22;
		palette[6] = 0x33;
		palette[7] = 0x44;
		const output = await extract(
			buildGrp({
				depth: 0x08,
				width: 4,
				height: 1,
				palette,
				stream: deflateSync(Buffer.from([1, 1, 0, 0])),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readUInt32LE(46)).toBe(256);
		expect(output.subarray(54 + 4, 54 + 8)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0x44]),
		);
		expect(output.subarray(54 + PALETTE_BYTES)).toEqual(
			Buffer.from([1, 1, 0, 0]),
		);
	});

	it("leaves zeros when the stream is shorter than the image", async () => {
		const output = await extract(
			buildGrp({
				depth: 0x20,
				width: 4,
				height: 2,
				stream: deflateSync(Buffer.alloc(12, 0x77)),
			}),
		);
		expect(output.subarray(54)).toEqual(
			Buffer.concat([Buffer.alloc(12, 0x77), Buffer.alloc(12, 0x00)]),
		);
	});

	it("lists its single bitmap entry and refuses a row that cannot fit", async () => {
		const file = buildGrp({ depth: 0x20, width: 4, height: 1 });
		const archive = await grpImageFormat.open(sourceOf(file), "sub/CG_03.grp");
		try {
			expect(archive.entries[0]?.path).toBe("CG_03.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
		// A stride smaller than a row cannot describe one, and an empty stride is refused too.
		for (const stride of [2, 0, -4]) {
			const broken = buildGrp({ depth: 0x20, width: 4, height: 1, stride });
			expect(await grpImageFormat.detect(sourceOf(broken), "A.grp")).toBe(true);
			await expect(extract(broken)).rejects.toThrow();
		}
	});
});
