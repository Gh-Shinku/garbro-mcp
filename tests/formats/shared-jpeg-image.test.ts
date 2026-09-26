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
	PROGRESSIVE_COLOUR_JPEG,
	PROGRESSIVE_COLOUR_PIXELS,
	PROGRESSIVE_GREY_JPEG,
	PROGRESSIVE_GREY_PIXELS,
	PROGRESSIVE_TALL_JPEG,
	PROGRESSIVE_TALL_PIXELS,
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

/**
 * Writes one block of a component: the difference from the block before it as a category and a magnitude,
 * and then the end of the block marker of the table this fixture declares.
 */
function writeBlock(
	writer: BitWriter,
	direct: number,
	previous: number,
): number {
	const difference = direct - previous;
	const magnitude = Math.abs(difference);
	const category = 0 === magnitude ? 0 : 32 - Math.clz32(magnitude);
	writer.write(((1 << category) - 1) << 1, category + 1);
	if (category > 0) {
		writer.write(
			difference > 0 ? difference : difference + (1 << category) - 1,
			category,
		);
	}
	writer.write(0, 1);
	return direct;
}

/**
 * A baseline JPEG of three components, built here from the layout, whose blocks are flat in the same way.
 * The colour of a pixel follows from the direct current coefficients of the three components: the luma comes
 * from the block that stands over the pixel and the two chrominance places from the block of their own
 * component, which is stretched over the picture when that component samples it less often than the luma.
 */
function colourJpeg(input: {
	width: number;
	height: number;
	/** The sampling of each component, luma first. */
	sampling: readonly [number, number][];
	/** The direct current coefficients of every block of every component, in the order they are coded. */
	blocks: readonly (readonly number[])[];
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
	const frame = Buffer.alloc(6 + 3 * input.sampling.length, 0);
	frame[0] = 8;
	frame.writeUInt16BE(input.height, 1);
	frame.writeUInt16BE(input.width, 3);
	frame[5] = input.sampling.length;
	input.sampling.forEach(([horizontal, vertical], index) => {
		frame[6 + index * 3] = index + 1;
		frame[7 + index * 3] = (horizontal << 4) | vertical;
		frame[8 + index * 3] = 0;
	});
	const scan = Buffer.from([
		input.sampling.length,
		...input.sampling.flatMap((_, index) => [index + 1, 0x00]),
		0,
		63,
		0,
	]);
	const parts: Buffer[] = [
		Buffer.from([0xff, 0xd8]),
		quantisation,
		segment(0xc0, frame),
		huffman,
		segment(0xda, scan),
	];
	const writer = new BitWriter();
	for (const component of input.blocks) {
		let previous = 0;
		for (const direct of component) {
			previous = writeBlock(writer, direct, previous);
		}
	}
	writer.align();
	parts.push(writer.toBuffer(), Buffer.from([0xff, 0xd9]));
	return Buffer.concat(parts);
}

/**
 * A progressive JPEG of one grey component of eight places square, of two scans: the first carries the direct
 * current coefficient the test names with its low bit dropped, and the second carries that bit.
 */
function progressiveJpeg(direct: number): Buffer {
	const quantisation = segment(
		0xdb,
		Buffer.from([0, ...new Array(64).fill(1)]),
	);
	const huffman = segment(0xc4, huffmanTable(0x00, ONE_A_LENGTH, DC_SYMBOLS));
	const frame = Buffer.alloc(9, 0);
	frame[0] = 8;
	frame.writeUInt16BE(8, 1);
	frame.writeUInt16BE(8, 3);
	frame[5] = 1;
	frame[6] = 1;
	frame[7] = 0x11;
	frame[8] = 0;
	const writer = new BitWriter();
	writeBlock(writer, direct >> 1, 0);
	writer.align();
	const first = Buffer.concat([
		segment(0xda, Buffer.from([1, 1, 0x00, 0, 0, 0x01])),
		writer.toBuffer(),
	]);
	const second = new BitWriter();
	second.write(direct & 1, 1);
	second.align();
	const refinement = Buffer.concat([
		segment(0xda, Buffer.from([1, 1, 0x00, 0, 0, 0x10])),
		second.toBuffer(),
	]);
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		quantisation,
		segment(0xc2, frame),
		huffman,
		first,
		refinement,
		Buffer.from([0xff, 0xd9]),
	]);
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

	it("stretches a component that samples the picture four times as coarsely", () => {
		// The luma samples the picture once, the two chrominance places every fourth place, so the reader has
		// to widen them by repeating the nearest sample. The picture is one block group of four luma blocks
		// and one block of each chrominance place.
		const image = readJpegImage(
			colourJpeg({
				width: 32,
				height: 8,
				sampling: [
					[4, 1],
					[1, 1],
					[1, 1],
				],
				blocks: [[8 * 20, 8 * 40, 8 * 60, 8 * 80], [8 * 30], [8 * 40]],
			}),
		);
		expect(image).toMatchObject({ width: 32, height: 8, bitsPerPixel: 32 });
		// The luma of the four blocks is 148, 168, 188 and 208; both chrominance places are flat, at 30 and
		// 40 above their own middle, so the colour of every block follows from those three numbers:
		// red is 148 + 1.402 * 40, green is 148 - 0.344136 * 30 - 0.714136 * 40, blue is 148 + 1.772 * 30.
		expect(pixelAt(image.pixels, 32, 0, 0)).toEqual([201, 109, 204, 255]);
		expect(pixelAt(image.pixels, 32, 8, 0)).toEqual([221, 129, 224, 255]);
		expect(pixelAt(image.pixels, 32, 16, 0)).toEqual([241, 149, 244, 255]);
		// The last block, and the last place of the picture: the chrominance places are the same ones.
		expect(pixelAt(image.pixels, 32, 31, 7)).toEqual([255, 169, 255, 255]);
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

	it("reads a progressive stream built here: a scan and a refinement of it", () => {
		// The first scan carries the direct current coefficient with its low bit dropped, and the second scan
		// carries that bit, so the two together give the coefficient the fixture names.
		const direct = 8 * 20 + 1;
		const image = readJpegImage(progressiveJpeg(direct));
		expect(image).toMatchObject({ width: 8, height: 8, bitsPerPixel: 32 });
		expect([...image.pixels]).toEqual([
			...flatBlocks({ width: 8, height: 8, blocks: [direct] }),
		]);
		// The coefficient stands at 161, so every sample is 161 / 8 rounded, above the middle of the range.
		expect(pixelAt(image.pixels, 8, 0, 0)).toEqual([148, 148, 148, 255]);
	});

	it("reads a progressive stream of one grey component behind the Python imaging library", () => {
		const image = readJpegImage(PROGRESSIVE_GREY_JPEG);
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		const { worst } = differences(image.pixels, PROGRESSIVE_GREY_PIXELS);
		expect(worst).toBeLessThanOrEqual(1);
	});

	it("reads a progressive stream whose components each sample the picture", () => {
		const image = readJpegImage(PROGRESSIVE_COLOUR_JPEG);
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		// The scans of a progressive stream carry the same coefficients a baseline one would, so the two
		// pictures agree with libjpeg's own to the same rounding.
		const { worst } = differences(image.pixels, PROGRESSIVE_COLOUR_PIXELS);
		expect(worst).toBeLessThanOrEqual(2);
	});

	it("reads a progressive stream whose chroma is sampled twice as coarsely both ways", () => {
		const image = readJpegImage(PROGRESSIVE_TALL_JPEG);
		const { mean, worst } = differences(image.pixels, PROGRESSIVE_TALL_PIXELS);
		expect(mean).toBeLessThanOrEqual(12);
		expect(worst).toBeLessThanOrEqual(45);
	});

	it("turns away a frame of a kind this reader does not read", () => {
		// An arithmetic coded frame (`SOF9`) follows a walk this reader does not read, and so does a lossless
		// one (`SOF3`).
		for (const kind of [0xc3, 0xc9, 0xca, 0xcb]) {
			const frame = Buffer.alloc(20, 0);
			frame.writeUInt16BE((0xff00 | kind) >>> 0, 0);
			frame.writeUInt16BE(17, 2);
			frame[4] = 8;
			frame.writeUInt16BE(8, 5);
			frame.writeUInt16BE(8, 7);
			frame[9] = 1;
			const data = Buffer.concat([
				Buffer.from([0xff, 0xd8]),
				frame,
				Buffer.from([0xff, 0xd9]),
			]);
			expect(() => readJpegImage(data)).toThrow(GarbroError);
			try {
				readJpegImage(data);
			} catch (error) {
				expect((error as GarbroError).code).toBe("UNSUPPORTED_FEATURE");
			}
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
