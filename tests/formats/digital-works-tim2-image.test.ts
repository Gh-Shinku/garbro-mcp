import { BufferByteSource } from "@garbro-mcp/core";
import { digitalWorksTim2ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PIXEL_OFFSET_24 = 54;
const PALETTE_OFFSET = 54;
const PALETTE_SIZE = 0x100 * 4;
const PALETTE_PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_SIZE;
const SIXTEEN_PIXEL_OFFSET = 54 + 12;

interface Tim2Options {
	width?: number;
	height?: number;
	/** The depth code the header stores, one of 1, 2, 3 and 5. */
	depth?: number;
	colors?: number;
	headerSize?: number;
	body?: Buffer;
}

function buildTim2(options: Tim2Options = {}): Buffer {
	const headerSize = options.headerSize ?? 0x30;
	const header: Buffer = Buffer.alloc(0x40, 0x00);
	header.write("TIM2", 0, "latin1");
	header.writeInt32LE(options.colors ?? 0, 0x18);
	header.writeInt32LE(options.colors ?? 0, 0x14);
	header.writeUInt16LE(headerSize, 0x1c);
	header.writeUInt16LE(options.colors ?? 0, 0x1e);
	header.writeUInt8(options.depth ?? 3, 0x23);
	header.writeUInt16LE(options.width ?? 2, 0x24);
	header.writeUInt16LE(options.height ?? 1, 0x26);
	const filler: Buffer = Buffer.alloc(
		Math.max(0, 0x10 + headerSize - 0x40),
		0x00,
	);
	return Buffer.concat([header, filler, options.body ?? Buffer.alloc(0)]);
}

/** A palette the way the file stores it: red, green, blue and alpha, four bytes an entry. */
function buildPalette(colors: number): Buffer {
	const palette: Buffer = Buffer.alloc(colors * 4, 0x00);
	for (let index = 0; index < colors; index += 1) {
		palette[index * 4] = index & 0xff;
		palette[index * 4 + 1] = 0x80;
		palette[index * 4 + 2] = (0xff - index) & 0xff;
		palette[index * 4 + 3] = 0x40;
	}
	return palette;
}

/** One palette entry of the bitmap, in its blue, green, red and alpha order. */
function entryAt(bitmap: Buffer, index: number): number[] {
	const at = PALETTE_OFFSET + index * 4;
	return [...bitmap.subarray(at, at + 4)];
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "tex.tm2"): Promise<Buffer> {
	const archive = await digitalWorksTim2ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("PlayStation/2 image (TIM2)", () => {
	it("declares its word and both of its extensions", async () => {
		expect(digitalWorksTim2ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("TIM2", "latin1") },
		]);
		expect(digitalWorksTim2ImageFormat.descriptor.extensions).toEqual([
			"tm2",
			"ext",
		]);
		for (const depth of [1, 2, 3, 5]) {
			expect(
				await digitalWorksTim2ImageFormat.detect(
					sourceOf(buildTim2({ depth, body: Buffer.alloc(64, 0x11) })),
					"tex.tm2",
				),
			).toBe(true);
		}
		// A depth code the reference does not know is not this format at all.
		expect(
			await digitalWorksTim2ImageFormat.detect(
				sourceOf(buildTim2({ depth: 0, body: Buffer.alloc(64) })),
				"tex.tm2",
			),
		).toBe(false);
		expect(
			await digitalWorksTim2ImageFormat.detect(
				sourceOf(buildTim2({ depth: 4, body: Buffer.alloc(64) })),
				"tex.tm2",
			),
		).toBe(false);
		expect(
			await digitalWorksTim2ImageFormat.detect(
				sourceOf(Buffer.alloc(8)),
				"tex.tm2",
			),
		).toBe(false);
	});

	it("reads its measurements and the sizes the header keeps", async () => {
		const archive = await digitalWorksTim2ImageFormat.open(
			sourceOf(
				buildTim2({
					width: 4,
					height: 2,
					depth: 2,
					colors: 16,
					body: Buffer.concat([Buffer.alloc(24, 0x11), buildPalette(16)]),
				}),
			),
			"tex.tm2",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 2,
				bitsPerPixel: 24,
				headerSize: 0x30,
				colors: 16,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
			});
		} finally {
			await archive.close();
		}
	});

	it("turns a thirty two colour palette from its own order into the picture's", async () => {
		const body = Buffer.concat([Buffer.from([0, 0]), buildPalette(32)]);
		const output = await extract(
			buildTim2({ width: 2, height: 1, depth: 5, colors: 32, body }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		// The second palette entry has alpha in the fourth byte.
		expect(entryAt(output, 1)).toEqual([0xfe, 0x80, 0x01, 0x40]);
		// The four blocks of eight arrive as the first, the third, the second and the fourth.
		const order = [
			0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23, 8, 9, 10, 11, 12,
			13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31,
		];
		for (const [destination, stored] of order.entries()) {
			expect(entryAt(output, destination)).toEqual([
				(0xff - stored) & 0xff,
				0x80,
				stored,
				0x40,
			]);
		}
	});

	it("keeps nothing of a palette that does not fill a whole part", async () => {
		const body = Buffer.concat([Buffer.from([0, 1]), buildPalette(16)]);
		const output = await extract(
			buildTim2({ width: 2, height: 1, depth: 5, colors: 16, body }),
		);
		// The reference only walks whole parts of thirty two colours, so a palette of sixteen fills none of
		// them and not one of its colours is copied at all.
		expect(entryAt(output, 0)).toEqual([0, 0, 0, 0]);
		expect(entryAt(output, 15)).toEqual([0, 0, 0, 0]);
		expect(
			output.subarray(PALETTE_PIXEL_OFFSET, PALETTE_PIXEL_OFFSET + 2),
		).toEqual(Buffer.from([0, 1]));
	});

	it("gives an eight bit image without a colour count a grey ramp", async () => {
		const output = await extract(
			buildTim2({
				width: 2,
				height: 1,
				depth: 5,
				colors: 0,
				body: Buffer.from([0, 1]),
			}),
		);
		expect(entryAt(output, 1)).toEqual([1, 1, 1, 0]);
		expect(
			output.subarray(PALETTE_PIXEL_OFFSET, PALETTE_PIXEL_OFFSET + 2),
		).toEqual(Buffer.from([0, 1]));
	});

	it("turns the red and the blue of a thirty two bit pixel around", async () => {
		// The body stores red, green, blue and alpha.
		const output = await extract(
			buildTim2({
				width: 2,
				height: 1,
				depth: 3,
				body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 8)).toEqual(
			Buffer.from([3, 2, 1, 4, 7, 6, 5, 8]),
		);
	});

	it("turns them around under twenty four bits as well", async () => {
		const output = await extract(
			buildTim2({
				width: 2,
				height: 1,
				depth: 2,
				body: Buffer.from([1, 2, 3, 4, 5, 6]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 8)).toEqual(
			Buffer.from([3, 2, 1, 6, 5, 4, 0, 0]),
		);
	});

	it("copies a sixteen bit pixel as it stands", async () => {
		const output = await extract(
			buildTim2({
				width: 2,
				height: 1,
				depth: 1,
				body: Buffer.from([0x21, 0x84, 0xff, 0x7f]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(16);
		expect(output.readUInt32LE(30)).toBe(3);
		expect(
			output.subarray(SIXTEEN_PIXEL_OFFSET, SIXTEEN_PIXEL_OFFSET + 4),
		).toEqual(Buffer.from([0x21, 0x84, 0xff, 0x7f]));
	});

	it("refuses a body or a palette that does not fit what it declares", async () => {
		await expect(
			extract(
				buildTim2({ width: 4, height: 4, depth: 3, body: Buffer.alloc(8) }),
			),
		).rejects.toThrow(/image is truncated/);
		await expect(
			extract(
				buildTim2({
					width: 1,
					height: 1,
					depth: 5,
					colors: 64,
					body: Buffer.concat([Buffer.from([0]), buildPalette(4)]),
				}),
			),
		).rejects.toThrow(/palette is truncated/);
	});

	it("takes its pixels from behind the header the header size names", async () => {
		const output = await extract(
			buildTim2({
				width: 1,
				height: 1,
				depth: 3,
				headerSize: 0x40,
				body: Buffer.from([9, 8, 7, 6]),
			}),
		);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 4)).toEqual(
			Buffer.from([7, 8, 9, 6]),
		);
	});

	it("names the entry after the image", async () => {
		const archive = await digitalWorksTim2ImageFormat.open(
			sourceOf(
				buildTim2({
					width: 1,
					height: 1,
					depth: 3,
					body: Buffer.from([1, 2, 3, 4]),
				}),
			),
			"sub/tex07.ext",
		);
		try {
			expect(archive.entries[0]?.path).toBe("tex07.bmp");
			expect(archive.entries[0]?.compressed).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
