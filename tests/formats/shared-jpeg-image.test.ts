// The reader of the JPEG interchange format of this project, against two kinds of fixture: streams written
// by the Python imaging library (see `tests/helpers/jpeg.ts`), whose places that library also decodes, and a
// stream built here from the layout of ITU-T T.81, whose places follow from the coefficients it names.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { GarbroError } from "@garbro-mcp/core";
import { readJpegImage } from "../../packages/formats/src/shared/jpeg-image.js";
import {
	COLOUR_JPEG,
	COLOUR_PIXELS,
	GREY_JPEG,
	GREY_PIXELS,
	PROGRESSIVE_JPEG,
	TALL_JPEG,
	TALL_PIXELS,
	WIDE_JPEG,
	WIDE_PIXELS,
} from "../helpers/jpeg.js";

/** The worst and the mean difference between two pictures of the same box. */
function differences(
	pixels: Buffer,
	expected: Buffer,
): { worst: number; mean: number } {
	let worst = 0;
	let sum = 0;
	for (let at = 0; at < expected.length; at += 1) {
		const difference = Math.abs((expected[at] ?? 0) - (pixels[at] ?? 0));
		worst = Math.max(worst, difference);
		sum += difference;
	}
	return { worst, mean: sum / expected.length };
}

/** The place of one pixel of a picture of four places a pixel, blue first. */
function pixelAt(
	pixels: Buffer,
	width: number,
	x: number,
	y: number,
): number[] {
	const at = (y * width + x) * 4;
	return [
		pixels[at] ?? 0,
		pixels[at + 1] ?? 0,
		pixels[at + 2] ?? 0,
		pixels[at + 3] ?? 0,
	];
}

/** A writer of coded bits: a byte of `0xff` in the coded data is followed by a zero byte, as the layout
 * asks, because such a byte would otherwise stand for a marker. */
class BitWriter {
	private readonly bytes: number[] = [];
	private cache = 0;
	private bits = 0;

	write(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.cache = (this.cache << 1) | ((value >> index) & 1);
			this.bits += 1;
			if (8 === this.bits) {
				this.bytes.push(this.cache & 0xff);
				if (0xff === (this.cache & 0xff)) this.bytes.push(0);
				this.cache = 0;
				this.bits = 0;
			}
		}
	}

	/** Pads the coded data to a byte with ones, which is what an encoder writes there. */
	align(): void {
		while (0 !== this.bits) this.write(1, 1);
	}

	/** Writes a marker, which stands as its two own bytes and never as coded data. */
	marker(code: number): void {
		this.align();
		this.bytes.push(0xff, code & 0xff);
	}

	toBuffer(): Buffer {
		return Buffer.from(this.bytes);
	}
}

function segment(marker: number, body: Buffer): Buffer {
	const length = Buffer.alloc(2, 0);
	length.writeUInt16BE(body.length + 2, 0);
	return Buffer.concat([Buffer.from([0xff, marker]), length, body]);
}

/** A table of Huffman codes of the given counts per length and the symbols behind them. */
function huffmanTable(
	id: number,
	counts: readonly number[],
	values: readonly number[],
): Buffer {
	return Buffer.from([id, ...counts, ...values]);
}

/** The table of one code a length, of the given symbols, which this fixture of a stream declares itself. */
const ONE_A_LENGTH = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0];
const DC_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const ONLY_END_OF_BLOCK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * A baseline JPEG of one grey component, built here from the layout: every block of eight places square is
 * flat, and holds the direct current coefficient the test names, divided by the quantisation table of ones.
 * The encoded value of a block is the difference from the block before it, which a restart marker clears.
 */
function greyJpeg(input: {
	width: number;
	height: number;
	blocks: readonly number[];
	restartInterval?: number;
}): Buffer {
	const quantisation = segment(
		0xdb,
		Buffer.from([0, ...new Array(64).fill(1)]),
	);
	const huffman = segment(
		0xc4,
		Buffer.concat([
			huffmanTable(0x00, ONE_A_LENGTH, DC_SYMBOLS),
			huffmanTable(0x10, [1, ...ONLY_END_OF_BLOCK.slice(1)], [0x00]),
		]),
	);
	const frame = Buffer.alloc(9, 0);
	frame[0] = 8;
	frame.writeUInt16BE(input.height, 1);
	frame.writeUInt16BE(input.width, 3);
	frame[5] = 1;
	frame[6] = 1;
	frame[7] = 0x11;
	frame[8] = 0;
	const scan = Buffer.from([1, 1, 0x00, 0, 63, 0]);
	const parts: Buffer[] = [
		Buffer.from([0xff, 0xd8]),
		quantisation,
		segment(0xc0, frame),
		huffman,
	];
	if (input.restartInterval)
		parts.push(segment(0xdd, Buffer.from([0, input.restartInterval])));
	parts.push(segment(0xda, scan));
	const writer = new BitWriter();
	let previous = 0;
	let restart = 0;
	for (let block = 0; block < input.blocks.length; block += 1) {
		const direct = input.blocks[block] ?? 0;
		const difference = direct - previous;
		previous = direct;
		const magnitude = Math.abs(difference);
		const category = 0 === magnitude ? 0 : 32 - Math.clz32(magnitude);
		writer.write(((1 << category) - 1) << 1, category + 1);
		if (category > 0)
			writer.write(
				difference > 0 ? difference : difference + (1 << category) - 1,
				category,
			);
		writer.write(0, 1);
		const interval = input.restartInterval ?? 0;
		if (
			0 !== interval &&
			block + 1 < input.blocks.length &&
			0 === (block + 1) % interval
		) {
			writer.marker(0xd0 + restart);
			restart = (restart + 1) % 8;
			previous = 0;
		}
	}
	writer.align();
	parts.push(writer.toBuffer(), Buffer.from([0xff, 0xd9]));
	return Buffer.concat(parts);
}

/** The places of the flat blocks the fixture names, eight places square each, in the order of the blocks. */
function flatBlocks(input: {
	width: number;
	height: number;
	blocks: readonly number[];
}): Buffer {
	const across = Math.ceil(input.width / 8);
	const pixels = Buffer.alloc(input.width * input.height * 4);
	for (let y = 0; y < input.height; y += 1) {
		for (let x = 0; x < input.width; x += 1) {
			const block = Math.floor(y / 8) * across + Math.floor(x / 8);
			const value = Math.round((input.blocks[block] ?? 0) / 8) + 128;
			const at = (y * input.width + x) * 4;
			pixels[at] = value;
			pixels[at + 1] = value;
			pixels[at + 2] = value;
			pixels[at + 3] = 0xff;
		}
	}
	return pixels;
}

describe("JPEG reader", () => {
	it("reads a stream built here: four flat blocks of one grey component", () => {
		const blocks = [8 * 20, 8 * 30, -8 * 10, 8 * 60];
		const image = readJpegImage(greyJpeg({ width: 16, height: 16, blocks }));
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		expect([...image.pixels]).toEqual([
			...flatBlocks({ width: 16, height: 16, blocks }),
		]);
		expect(pixelAt(image.pixels, 16, 0, 0)).toEqual([148, 148, 148, 255]);
		expect(pixelAt(image.pixels, 16, 15, 15)).toEqual([188, 188, 188, 255]);
	});

	it("reads a stream whose coded data carries a restart marker", () => {
		const blocks = [8 * 20, 8 * 30, -8 * 10, 8 * 60];
		const image = readJpegImage(
			greyJpeg({ width: 16, height: 16, blocks, restartInterval: 2 }),
		);
		expect([...image.pixels]).toEqual([
			...flatBlocks({ width: 16, height: 16, blocks }),
		]);
	});

	it("reads a stream whose coefficients stand at the width of a byte", () => {
		// A difference of 255 stands in eight bits, so the coded data holds a run of one bits; the fixture
		// writes the zero byte behind a byte of `0xff` that the layout asks for.
		const image = readJpegImage(
			greyJpeg({ width: 8, height: 8, blocks: [255 * 8] }),
		);
		expect(pixelAt(image.pixels, 8, 0, 0)).toEqual([255, 255, 255, 255]);
	});

	it("reads a grey stream behind the Python imaging library", () => {
		const image = readJpegImage(GREY_JPEG);
		expect(image.width).toBe(8);
		expect(image.height).toBe(8);
		expect([...image.pixels]).toEqual([...GREY_PIXELS]);
	});

	it("reads a stream whose components each sample the picture, to within a place", () => {
		const image = readJpegImage(COLOUR_JPEG);
		expect(image.width).toBe(16);
		expect(image.height).toBe(16);
		// The colour conversion of this project stands in single precision against the fixed point arithmetic
		// of libjpeg, so the two pictures differ by no more than two places.
		const { worst } = differences(image.pixels, COLOUR_PIXELS);
		expect(worst).toBeLessThanOrEqual(2);
	});

	it("reads a stream whose chroma is sampled twice as coarsely across", () => {
		const image = readJpegImage(WIDE_JPEG);
		const { worst } = differences(image.pixels, WIDE_PIXELS);
		// libjpeg widens such chroma with the same three quarters to one quarter filter this reader uses.
		expect(worst).toBeLessThanOrEqual(3);
	});

	it("reads a stream whose chroma is sampled twice as coarsely both ways", () => {
		const image = readJpegImage(TALL_JPEG);
		const { worst, mean } = differences(image.pixels, TALL_PIXELS);
		// libjpeg folds the widening of such chroma into its colour conversion, so its places differ from a
		// widening in the colour space of the stream by more than the rounding alone; the boxes still match.
		expect(image.width).toBe(16);
		expect(image.height).toBe(16);
		expect(mean).toBeLessThanOrEqual(12);
		expect(worst).toBeLessThanOrEqual(45);
	});

	it("turns away a progressive stream", () => {
		expect(() => readJpegImage(PROGRESSIVE_JPEG)).toThrow(GarbroError);
		try {
			readJpegImage(PROGRESSIVE_JPEG);
		} catch (error) {
			expect((error as GarbroError).code).toBe("UNSUPPORTED_FEATURE");
		}
	});

	it("turns away a stream that is no stream of the format", () => {
		expect(() => readJpegImage(Buffer.from("not a picture", "latin1"))).toThrow(
			GarbroError,
		);
		expect(() => readJpegImage(Buffer.alloc(0))).toThrow(GarbroError);
		// A stream that ends inside its coded data is turned away rather than read as far as it goes.
		const cut = greyJpeg({
			width: 16,
			height: 16,
			blocks: [8 * 20, 8 * 30, -8 * 10, 8 * 60],
		});
		expect(() => readJpegImage(cut.subarray(0, 40))).toThrow(GarbroError);
	});
});
