import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	pmsImageFormat,
	readPmsLayout,
	unpackPms8,
	unpackPms16,
} from "../../packages/formats/src/alicesoft/pms-image.js";

const HEAD_SIZE = 0x30;
const PALETTE_AT = 0x400;

/** A picture of this engine: the head, the runs of its pixels, and whatever plane stands behind them. */
function buildPms(options: {
	bits: number;
	width: number;
	height: number;
	runs: readonly number[];
	alpha?: Buffer;
	palette?: Buffer;
	offsetX?: number;
	offsetY?: number;
}): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("PM", 0, "latin1");
	head[2] = 16 === options.bits ? 2 : 1;
	head[6] = options.bits;
	head.writeInt32LE(options.offsetX ?? 0, 0x10);
	head.writeInt32LE(options.offsetY ?? 0, 0x14);
	head.writeUInt32LE(options.width, 0x18);
	head.writeUInt32LE(options.height, 0x1c);
	head.writeUInt32LE(HEAD_SIZE, 0x20);
	head.writeUInt32LE(options.alpha || options.palette ? PALETTE_AT : 0, 0x24);
	const parts: Buffer[] = [head, Buffer.from(options.runs)];
	if (options.palette) {
		const padding = Buffer.alloc(
			PALETTE_AT - HEAD_SIZE - options.runs.length,
			0x00,
		);
		parts.push(padding, options.palette);
	} else if (options.alpha) {
		const padding = Buffer.alloc(
			PALETTE_AT - HEAD_SIZE - options.runs.length,
			0x00,
		);
		parts.push(padding, options.alpha);
	}
	return Buffer.concat(parts);
}

/** A colour map as the file stores it, three bytes to a colour, red first. */
function buildPalette(colours: readonly [number, number, number][]): Buffer {
	const palette = Buffer.alloc(0x300, 0x00);
	for (const [index, colour] of colours.entries()) {
		palette[index * 3] = colour[0];
		palette[index * 3 + 1] = colour[1];
		palette[index * 3 + 2] = colour[2];
	}
	return palette;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await pmsImageFormat.open(
		new BufferByteSource(data),
		"picture.pms",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("AliceSoft image", () => {
	it("reads the head and turns away what it does not name", () => {
		const data = buildPms({
			bits: 8,
			width: 4,
			height: 2,
			runs: [1],
			palette: buildPalette([]),
		});
		expect(readPmsLayout(data)).toMatchObject({
			bitsPerPixel: 8,
			width: 4,
			height: 2,
			dataOffset: HEAD_SIZE,
			alphaOffset: PALETTE_AT,
		});
		const wrongDepth = buildPms({ bits: 24, width: 4, height: 2, runs: [] });
		expect(readPmsLayout(wrongDepth)).toBeUndefined();
		const elsewhere = Buffer.from(data);
		elsewhere.writeUInt32LE(0x10, 0x20);
		expect(readPmsLayout(elsewhere)).toBeUndefined();
	});

	it("draws the runs of a picture of sixteen bits", () => {
		// A word of its own, then a run of one word three times over - and the row behind it copies the three
		// pixels that stand before the place it has reached, then the pixel above and to the left of it.
		const data = buildPms({
			bits: 16,
			width: 4,
			height: 2,
			runs: [0xf8, 0x34, 0x12, 0xfd, 0x00, 0x78, 0x56, 0xff, 0x01, 0xfb],
		});
		const layout = readPmsLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = unpackPms16(data, layout);
		expect([...pixels]).toEqual([
			0x34, 0x12, 0x78, 0x56, 0x78, 0x56, 0x78, 0x56, 0x34, 0x12, 0x78, 0x56,
			0x78, 0x56, 0x78, 0x56,
		]);
	});

	it("makes a word of the two bytes that carry five, six and five bits", () => {
		// The first byte holds the top three bits and two of the green, the second the rest of the green and
		// the blue: a byte of every bit set in both places makes a word of nothing but red.
		const data = buildPms({
			bits: 16,
			width: 2,
			height: 1,
			runs: [0xf9, 0x01, 0xe0, 0xc0, 0xc0],
		});
		const layout = readPmsLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackPms16(data, layout)]).toEqual([0x00, 0xf8, 0x00, 0xf8]);
	});

	it("draws the runs of a picture of eight bits, whose control byte is the pixel itself", () => {
		// A pixel that is the control byte itself, a pair written three times over, and a byte of its own;
		// then a run of one byte and four of their own; and the last row copies the first.
		const data = buildPms({
			bits: 8,
			width: 8,
			height: 3,
			runs: [
				0x05, 0xfc, 0x00, 0x11, 0x22, 0x07, 0xfd, 0x00, 0x09, 0x04, 0x04, 0x04,
				0x04, 0xfe, 0x05,
			],
			palette: buildPalette([]),
		});
		const layout = readPmsLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackPms8(data, layout)]).toEqual([
			0x05, 0x11, 0x22, 0x11, 0x22, 0x11, 0x22, 0x07, 0x09, 0x09, 0x09, 0x09,
			0x04, 0x04, 0x04, 0x04, 0x05, 0x11, 0x22, 0x11, 0x22, 0x11, 0x22, 0x07,
		]);
	});

	it("hands an eight bit picture over through its colour map", async () => {
		const palette = buildPalette([
			[0x01, 0x02, 0x03],
			[0x11, 0x22, 0x33],
		]);
		const data = buildPms({
			bits: 8,
			width: 2,
			height: 1,
			runs: [0x00, 0x01],
			palette,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 2)]).toEqual([0, 1]);
		// The colour the file stores red first reaches the bitmap blue first.
		expect([...bmp.palette.subarray(4, 8)]).toEqual([0x33, 0x22, 0x11, 0x00]);
	});

	it("draws the alpha of a picture of sixteen bits into a picture of four bytes", async () => {
		const alpha = Buffer.from([0x00, 0x40, 0x80, 0xc0]);
		const data = buildPms({
			bits: 16,
			width: 4,
			height: 1,
			// A word of its own for every pixel: blue, then green, then red, then nothing at all.
			runs: [0x1f, 0x00, 0xe0, 0x07, 0x00, 0xf8, 0x00, 0x00],
			alpha,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(32);
		// A word of every bit set in one channel makes a byte of every bit set in that channel, and the
		// alpha plane stands in the fourth byte of every pixel.
		expect([...bmp.pixels.subarray(0, 8)]).toEqual([
			0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x40,
		]);
		const handle = await pmsImageFormat.open(
			new BufferByteSource(data),
			"picture.pms",
		);
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 4,
			height: 1,
			bitsPerPixel: 32,
		});
		// A picture of eight bits without the colour map its head should name is refused.
		// A picture of eight bits without the colour map its head should name is refused when its pixels
		// are asked for.
		await expect(
			extract(buildPms({ bits: 8, width: 2, height: 1, runs: [0] })),
		).rejects.toThrow(GarbroError);
	});

	it("tells a picture by the word it opens with", async () => {
		const data = buildPms({
			bits: 8,
			width: 2,
			height: 1,
			runs: [0, 1],
			palette: buildPalette([]),
		});
		expect(
			await pmsImageFormat.detect(new BufferByteSource(data), "a.pms"),
		).toBe(true);
		const elsewhere = Buffer.from(data);
		elsewhere.write("XX", 0, "latin1");
		expect(
			await pmsImageFormat.detect(new BufferByteSource(elsewhere), "a.pms"),
		).toBe(false);
	});
});
