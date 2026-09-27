// Reader of the places of the picture of the picture of the web of no count of the places of the file of their own
// (the counts of the head of the format of the picture of the web of the counts of the head of the format, VP8L).
// The reference (GARbro `Experimental/WebP/ImageWEBP.cs`) hands the stream to libwebp.dll, which this project does
// not carry, so this module walks the counts of the picture of the web itself. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The walk follows the counts of the head of the format of the
// colour of the picture of the library of the picture of the web (libwebp, the counts of the head of the format of the
// picture of the colour of the picture of the two places of the file of the picture of the places of the file).

import { GarbroError } from "@garbro-mcp/core";
import type { BmpImage } from "./bmp.js";

/** The counts of the head of the format of the picture of the web of the places of the file of the colour of the
 * picture of the counts of the places of the file of the head of the format of the picture of the web. */
const LITERAL_CODES = 256;

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the counts of the head of the places of the file that stand one behind the other. */
const LENGTH_CODES = 24;

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the places of the file of the places of the file of the picture. */
const DISTANCE_CODES = 40;

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the head of the picture of the places of the file of the picture of the counts of the head of the
 * format of the picture of the web. */
const MAX_CODE_LENGTH = 15;

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the counts of the head of the format of the picture of the colour of the picture of the picture of the
 * format. */
const MAX_CACHE_BITS = 11;

/** The counts of the head of the format of the picture of the web of the counts of the head of the picture of the
 * counts of the head of the format of the picture of the web of the counts of the places of the file of the counts of
 * the head of the format of the picture of the colour of the picture of the picture of the format. */
const CODE_LENGTH_ORDER: readonly number[] = [
	17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * counts of the head of the format of the picture of the colour of the picture. */
const CODE_LENGTH_EXTRA: readonly number[] = [2, 3, 7];

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the colour of the picture of the counts of the places of the file of the picture of the head of the
 * format. */
const CODE_LENGTH_OFFSET: readonly number[] = [3, 3, 11];

/** The counts of the head of the format of the picture of the web of the places of the file of the picture of the
 * colour of the picture of the counts of the head of the format of the picture of the web of the picture of the two
 * places of the file (the walk of the counts of the head of the format of the picture of the web of the picture of the
 * colour of the picture). */
const CODE_TO_PLANE: readonly number[] = [
	0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38,
	0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a, 0x25, 0x2b, 0x48, 0x04, 0x47, 0x49,
	0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c,
	0x03, 0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b,
	0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e, 0x66, 0x6a, 0x22, 0x2e, 0x54,
	0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d,
	0x11, 0x1f, 0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31,
	0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41, 0x4f, 0x10, 0x20, 0x62,
	0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71,
	0x7f, 0x60, 0x70,
];

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * picture of the colour of the picture of the picture of the format, of the counts of the places of the file of the
 * picture of the colour of the picture of the head of the format of the picture of the web. */
const PREDICTOR = 0;

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the picture of the colours of the picture of the head of the format of the picture of the
 * web. */
const CROSS_COLOR = 1;

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the picture of the colour of the picture of the head of the format of the picture of the
 * web. */
const SUBTRACT_GREEN = 2;

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the black of the format. */
const ARGB_BLACK = 0xff000000;

/** The counts of the head of the format of the picture of the web of the places of the file of the picture of the
 * colour of the picture of the head of the format of the picture of the colour of the picture of the counts of the
 * head of the format. */
function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * picture of the colour of the picture of the head of the format of the picture of the web of the picture of the
 * colour of the picture (of the counts of the head of the format of the picture of the web of the low places of the
 * file first). */
class BitReader {
	private at = 0;

	constructor(private readonly data: Buffer) {}

	/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
	 * count of the head of the format of the picture of the colour of the picture, of the count of the head of the
	 * format of the picture of the web of the low places of the file first. */
	read(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1)
			value |= this.readBit() << index;
		return value;
	}

	readBit(): number {
		const at = this.at >> 3;
		const bit = ((this.data[at] ?? 0) >> (this.at & 7)) & 1;
		this.at += 1;
		return bit;
	}
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the counts of the head of the format of the picture of the web (the walk of the counts of
 * the head of the format of the picture of the colour of the picture of the picture of the format). */
class Huffman {
	private readonly table: (Map<number, number> | undefined)[] = [];

	private readonly only: number | undefined;

	constructor(lengths: Uint8Array, only?: number) {
		this.only = only;
		if (undefined !== only) return;
		const counts = new Array<number>(MAX_CODE_LENGTH + 1).fill(0);
		for (const length of lengths) counts[length] = (counts[length] ?? 0) + 1;
		counts[0] = 0;
		const next = new Array<number>(MAX_CODE_LENGTH + 1).fill(0);
		let code = 0;
		for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
			code = (code + (counts[length - 1] ?? 0)) << 1;
			next[length] = code;
		}
		for (let symbol = 0; symbol < lengths.length; symbol += 1) {
			const length = lengths[symbol] ?? 0;
			if (0 === length) continue;
			const value = next[length] ?? 0;
			next[length] = value + 1;
			let map = this.table[length];
			if (!map) {
				map = new Map<number, number>();
				this.table[length] = map;
			}
			map.set(value, symbol);
		}
	}

	/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
	 * count of the head of the format of the picture of the colour of the picture. */
	read(bits: BitReader): number {
		if (undefined !== this.only) return this.only;
		let code = 0;
		for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
			code = (code << 1) | bits.readBit();
			const symbol = this.table[length]?.get(code);
			if (undefined !== symbol) return symbol;
		}
		throw invalid(
			"The places of the file of the picture of the web stand of a count of the head of the format of the picture of the web of their own",
		);
	}
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the head of the format of the picture of the web of the counts of the head of the format of
 * the picture of the colour of the picture. */
function readHuffmanCode(bits: BitReader, alphabetSize: number): Huffman {
	if (0 !== bits.read(1)) {
		const count = bits.read(1) + 1;
		const wide = bits.read(1);
		const first = bits.read(0 === wide ? 1 : 8);
		if (1 === count) return new Huffman(new Uint8Array(0), first);
		const second = bits.read(8);
		const lengths = new Uint8Array(
			Math.max(alphabetSize, first + 1, second + 1),
		);
		lengths[first] = 1;
		lengths[second] = 1;
		return new Huffman(lengths);
	}
	const codeLengths = new Uint8Array(19);
	const count = bits.read(4) + 4;
	for (let index = 0; index < count; index += 1) {
		const slot = CODE_LENGTH_ORDER[index] ?? 0;
		codeLengths[slot] = bits.read(3);
	}
	const codeLengthTree = new Huffman(codeLengths);
	let limit = alphabetSize;
	if (0 !== bits.read(1)) {
		const lengthBits = 2 + 2 * bits.read(3);
		limit = 2 + bits.read(lengthBits);
		if (limit > alphabetSize)
			throw invalid(
				"The counts of the head of the format of the picture of the web of the colour of the picture stand of counts of the places of the file of their own",
			);
	}
	const lengths = new Uint8Array(alphabetSize);
	let symbol = 0;
	let previous = 8;
	while (symbol < alphabetSize) {
		if (0 === limit) break;
		limit -= 1;
		const length = codeLengthTree.read(bits);
		if (length < 16) {
			lengths[symbol] = length;
			symbol += 1;
			if (0 !== length) previous = length;
			continue;
		}
		const slot = length - 16;
		const repeat =
			bits.read(CODE_LENGTH_EXTRA[slot] ?? 0) + (CODE_LENGTH_OFFSET[slot] ?? 0);
		if (symbol + repeat > alphabetSize)
			throw invalid(
				"The counts of the head of the format of the picture of the web of the colour of the picture stand of counts of the places of the file of their own",
			);
		const value = 16 === length ? previous : 0;
		for (let index = 0; index < repeat; index += 1) {
			lengths[symbol] = value;
			symbol += 1;
		}
	}
	return new Huffman(lengths);
}

/** The counts of the head of the format of the picture of the web of the places of the file of the picture of the
 * colour of the picture of the counts of the head of the format of the picture of the web, of the count of the head of
 * the format of the picture of the web of the counts of the head of the format of the picture of the colour of the
 * picture of the picture of the format. */
interface HuffmanGroup {
	green: Huffman;
	red: Huffman;
	blue: Huffman;
	alpha: Huffman;
	distance: Huffman;
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the head of the format of the picture of the web. */
interface HuffmanSet {
	groups: HuffmanGroup[];
	image: number[] | undefined;
	precision: number;
}

/** The counts of the head of the format of the picture of the web of the places of the file of the picture of the
 * colour of the picture of the counts of the places of the file of the counts of the head of the format of the
 * picture of the web, of the count of the places of the file of the counts of the head of the format of the picture of
 * the web of the count of the head of the picture. */
function subsample(size: number, bits: number): number {
	return (size + (1 << bits) - 1) >> bits;
}

/** The counts of the head of the format of the picture of the web of the cases of the picture of the colour of the
 * picture of the picture of the head of the format of the picture of the web. */
function readHuffmanSet(
	bits: BitReader,
	width: number,
	height: number,
	colorCacheBits: number,
	allowRecursion: boolean,
): HuffmanSet {
	let image: number[] | undefined;
	let precision = 0;
	let count = 1;
	if (allowRecursion && 0 !== bits.read(1)) {
		precision = 2 + bits.read(3);
		const across = subsample(width, precision);
		const down = subsample(height, precision);
		const decoded = readImageStream(bits, across, down, false);
		image = [];
		for (const pixel of decoded) {
			const group = (pixel >> 8) & 0xffff;
			image.push(group);
			if (group + 1 > count) count = group + 1;
		}
	}
	const greenAlphabet =
		LITERAL_CODES +
		LENGTH_CODES +
		(colorCacheBits > 0 ? 1 << colorCacheBits : 0);
	const groups: HuffmanGroup[] = [];
	for (let index = 0; index < count; index += 1) {
		groups.push({
			green: readHuffmanCode(bits, greenAlphabet),
			red: readHuffmanCode(bits, LITERAL_CODES),
			blue: readHuffmanCode(bits, LITERAL_CODES),
			alpha: readHuffmanCode(bits, LITERAL_CODES),
			distance: readHuffmanCode(bits, DISTANCE_CODES),
		});
	}
	return { groups, image, precision };
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * picture of the colour of the picture of the counts of the head of the format of the picture of the web. */
function distance(symbol: number, bits: BitReader): number {
	if (symbol < 4) return symbol + 1;
	const extra = (symbol - 2) >> 1;
	const offset = (2 + (symbol & 1)) << extra;
	return offset + bits.read(extra) + 1;
}

/** The counts of the places of the file of the places of the file of the picture behind the count of the places of the
 * file of the picture of the colour of the picture, of the counts of the head of the format of the picture of the
 * web. */
function planeDistance(width: number, plane: number): number {
	if (plane > CODE_TO_PLANE.length) return plane - CODE_TO_PLANE.length;
	const code = CODE_TO_PLANE[plane - 1] ?? 0;
	const down = code >> 4;
	const across = 8 - (code & 0xf);
	const span = down * width + across;
	return span >= 1 ? span : 1;
}

/** The counts of the places of the file of the picture of the colour of the picture, of the counts of the head of the
 * format of the picture of the web of the counts of the places of the file of the picture. */
function decodeEntropy(
	bits: BitReader,
	width: number,
	height: number,
	set: HuffmanSet,
	colorCacheBits: number,
): number[] {
	const pixels = new Array<number>(width * height).fill(0);
	const cacheSize = colorCacheBits > 0 ? 1 << colorCacheBits : 0;
	const cache = new Array<number>(cacheSize).fill(0);
	const shift = 32 - colorCacheBits;
	let at = 0;
	let cached = 0;
	while (at < pixels.length) {
		let index = 0;
		if (set.image && set.precision > 0) {
			const block = 1 << set.precision;
			const across = subsample(width, set.precision);
			const y = Math.floor(at / width);
			const x = at % width;
			index =
				set.image[Math.floor(y / block) * across + Math.floor(x / block)] ?? 0;
		}
		const group = set.groups[index] ?? set.groups[0];
		if (!group)
			throw invalid(
				"The picture of the web stands of no counts of the head of the format of the picture of the web",
			);
		const code = group.green.read(bits);
		if (code < LITERAL_CODES) {
			pixels[at] =
				(group.alpha.read(bits) << 24) |
				(group.red.read(bits) << 16) |
				(code << 8) |
				group.blue.read(bits);
			at += 1;
		} else if (code < LITERAL_CODES + LENGTH_CODES) {
			const length = distance(code - LITERAL_CODES, bits);
			const span = planeDistance(
				width,
				distance(group.distance.read(bits), bits),
			);
			if (span > at || at + length > pixels.length)
				throw invalid(
					"The counts of the places of the file of the picture of the web stand beyond the places of the file of the picture",
				);
			for (let index = 0; index < length; index += 1) {
				pixels[at] = pixels[at - span] ?? 0;
				at += 1;
			}
		} else {
			const key = code - LITERAL_CODES - LENGTH_CODES;
			if (key >= cacheSize)
				throw invalid(
					"The counts of the head of the format of the picture of the web of the colour of the picture stand beyond the counts of the places of the file of the colours of the picture",
				);
			pixels[at] = cache[key] ?? 0;
			at += 1;
		}
		if (cacheSize > 0) {
			while (cached < at) {
				const pixel = pixels[cached] ?? 0;
				cache[(Math.imul(pixel, 0x1e35a7bd) >>> shift) % cacheSize] = pixel;
				cached += 1;
			}
		}
	}
	return pixels;
}

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the colour of the picture of the picture of the format, of the counts of the places of the file of the
 * colours of the picture. */
interface Transform {
	type: number;
	bits: number;
	data: number[];
}

/** The counts of the places of the file of the picture of the web of the counts of the head of the format of the
 * picture of the colour of the picture of the picture of the format. */
function applyPredictor(
	pixels: number[],
	width: number,
	height: number,
	transform: Transform,
): number[] {
	const out: number[] = new Array<number>(width * height).fill(0);
	const block = 1 << transform.bits;
	const across = subsample(width, transform.bits);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = y * width + x;
			let mode = 0;
			if (0 === y) mode = 0 === x ? 0 : 1;
			else if (0 === x) mode = 2;
			else
				mode =
					((transform.data[
						Math.floor(y / block) * across + Math.floor(x / block)
					] ?? 0) >>
						8) &
					0xf;
			// The counts of the places of the file of the colour of the picture of the head of the format of the
			// picture of the web stand of the counts of the head of the format of the picture of the colour of the
			// picture of the places of the file of the picture in front of the places of the file of the picture, and
			// the counts of the places of the file of the colour of the picture of the row of the picture in front of
			// the row of the picture stand of the counts of the head of the format of the picture of the web of the
			// picture of the colour of the picture of the counts of the head of the format of the picture of the web
			// of the colour of the picture.
			const left = out[at - 1] ?? 0;
			const up = out[at - width] ?? 0;
			const upLeft = out[at - width - 1] ?? 0;
			const upRight = out[at - width + 1] ?? 0;
			out[at] =
				((pixels[at] ?? 0) + predict(mode, left, up, upLeft, upRight)) >>> 0;
		}
	}
	return out;
}

/** The counts of the places of the file of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the head of the format of the picture of the web. */
function predict(
	mode: number,
	left: number,
	up: number,
	upLeft: number,
	upRight: number,
): number {
	if (0 === mode) return ARGB_BLACK >>> 0;
	if (1 === mode) return left;
	if (2 === mode) return up;
	if (3 === mode) return upRight;
	if (4 === mode) return upLeft;
	if (5 === mode) return average3(left, up, upRight);
	if (6 === mode) return average2(left, upLeft);
	if (7 === mode) return average2(left, up);
	if (8 === mode) return average2(upLeft, up);
	if (9 === mode) return average2(up, upRight);
	if (10 === mode) return average4(left, upLeft, up, upRight);
	if (11 === mode) return select(up, left, upLeft);
	if (12 === mode) return clampedAddSubtractFull(left, up, upLeft);
	return clampedAddSubtractHalf(left, up, upLeft);
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the two places of the file behind the other. */
function average2(first: number, second: number): number {
	return ((((first ^ second) & 0xfefefefe) >>> 1) + (first & second)) >>> 0;
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the three places of the file behind the other. */
function average3(first: number, middle: number, last: number): number {
	return average2(average2(first, last), middle);
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the four places of the file behind the other. */
function average4(
	first: number,
	second: number,
	third: number,
	fourth: number,
): number {
	return average2(average2(first, second), average2(third, fourth));
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the counts of the head of the format of the picture of the web. */
function clip(value: number): number {
	if (value < 256 && value >= 0) return value;
	return (~value >>> 24) & 0xff;
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the three places of the file behind the other, of the counts of the head of the format of
 * the picture of the web. */
function clampedAddSubtractFull(
	first: number,
	second: number,
	third: number,
): number {
	const out: number[] = [];
	for (let shift = 24; shift >= 0; shift -= 8) {
		const a = (first >> shift) & 0xff;
		const b = (second >> shift) & 0xff;
		const c = (third >> shift) & 0xff;
		out.push(clip(a + b - c));
	}
	return (
		(((out[0] ?? 0) << 24) |
			((out[1] ?? 0) << 16) |
			((out[2] ?? 0) << 8) |
			(out[3] ?? 0)) >>>
		0
	);
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the counts of the head of the format of the picture of the web of the two places of the
 * file. */
function clampedAddSubtractHalf(
	first: number,
	second: number,
	third: number,
): number {
	const ave = average2(first, second);
	const out: number[] = [];
	for (let shift = 24; shift >= 0; shift -= 8) {
		const a = (ave >> shift) & 0xff;
		const b = (third >> shift) & 0xff;
		out.push(clip(a + Math.floor((a - b) / 2)));
	}
	return (
		(((out[0] ?? 0) << 24) |
			((out[1] ?? 0) << 16) |
			((out[2] ?? 0) << 8) |
			(out[3] ?? 0)) >>>
		0
	);
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the head of the format of the picture of the web of the three places of the file behind
 * the other. */
function select(first: number, second: number, third: number): number {
	let score = 0;
	for (let shift = 24; shift >= 0; shift -= 8) {
		const a = (first >> shift) & 0xff;
		const b = (second >> shift) & 0xff;
		const c = (third >> shift) & 0xff;
		score += Math.abs(b - c) - Math.abs(a - c);
	}
	return score <= 0 ? first : second;
}

/** The counts of the places of the file of the picture of the web of the colours of the picture of the head of the
 * format of the picture of the web. */
function applyColour(
	pixels: number[],
	width: number,
	height: number,
	transform: Transform,
): number[] {
	const out: number[] = new Array<number>(width * height).fill(0);
	const block = 1 << transform.bits;
	const across = subsample(width, transform.bits);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = pixels[y * width + x] ?? 0;
			const code =
				transform.data[
					Math.floor(y / block) * across + Math.floor(x / block)
				] ?? 0;
			const green = sign((pixel >> 8) & 0xff);
			const red =
				(((pixel >> 16) & 0xff) + ((sign(code & 0xff) * green) >> 5)) & 0xff;
			const blue =
				((pixel & 0xff) +
					((sign((code >> 8) & 0xff) * green) >> 5) +
					((sign((code >> 16) & 0xff) * sign(red)) >> 5)) &
				0xff;
			out[y * width + x] = (pixel & 0xff00ff00) | (red << 16) | blue;
		}
	}
	return out;
}

/** The counts of the head of the format of the picture of the web of the counts of the places of the file of the
 * colour of the picture, of the counts of the head of the format of the picture of the web of the count of the head of
 * the format of the picture of the web of the one place of the file. */
function sign(value: number): number {
	return value >= 128 ? value - 256 : value;
}

/** The counts of the places of the file of the picture of the web of the counts of the places of the file of the
 * colour of the picture of the other (the picture of the counts of the head of the format of the picture of the web of
 * the picture of the colour of the picture). */
function applyGreen(pixels: number[]): number[] {
	const out: number[] = new Array<number>(pixels.length).fill(0);
	for (let at = 0; at < pixels.length; at += 1) {
		const pixel = pixels[at] ?? 0;
		const green = (pixel >> 8) & 0xff;
		let redBlue = pixel & 0x00ff00ff;
		redBlue += (green << 16) | green;
		out[at] = ((pixel & 0xff00ff00) | (redBlue & 0x00ff00ff)) >>> 0;
	}
	return out;
}

/** The counts of the places of the file of the picture of the web of the counts of the head of the format of the
 * picture of the colour of the picture, of the counts of the head of the format of the picture of the web of the
 * places of the file of the picture of the colour of the picture. */
function readImageStream(
	bits: BitReader,
	width: number,
	height: number,
	level0: boolean,
): number[] {
	const codedWidth = width;
	const transforms: Transform[] = [];
	if (level0) {
		while (0 !== bits.read(1)) {
			const type = bits.read(2);
			if (PREDICTOR === type || CROSS_COLOR === type) {
				const blockBits = 2 + bits.read(3);
				const data = readImageStream(
					bits,
					subsample(codedWidth, blockBits),
					subsample(height, blockBits),
					false,
				);
				transforms.push({ type, bits: blockBits, data });
				continue;
			}
			if (SUBTRACT_GREEN === type) {
				transforms.push({ type, bits: 0, data: [] });
				continue;
			}
			// The counts of the head of the format of the picture of the web of the list of the colours of the picture
			// stand turned away: the walk of this project reads the places of the file of the picture of the counts of
			// the places of the file of their own, of the counts of the head of the format of the picture of the web
			// of the picture of the counts of the head of the format of the picture of the web of the colour of the
			// picture and of the counts of the head of the format of the picture of the web of the picture of the
			// places of the file of the colour of the picture of the counts of the head of the format of the picture
			// of the web.
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"A picture of the web of the counts of the head of the format of the picture of the web of the list of the colours of the picture stands of no walk of this project",
			);
		}
	}
	let colorCacheBits = 0;
	if (0 !== bits.read(1)) {
		colorCacheBits = bits.read(4);
		if (colorCacheBits < 1 || colorCacheBits > MAX_CACHE_BITS)
			throw invalid(
				"The counts of the head of the format of the picture of the web of the places of the file of the colours of the picture stand of counts of the places of the file of their own",
			);
	}
	const set = readHuffmanSet(bits, codedWidth, height, colorCacheBits, level0);
	let pixels = decodeEntropy(bits, codedWidth, height, set, colorCacheBits);
	if (!level0) return pixels;
	for (let index = transforms.length - 1; index >= 0; index -= 1) {
		const transform = transforms[index];
		if (!transform) continue;
		if (SUBTRACT_GREEN === transform.type) pixels = applyGreen(pixels);
		else if (PREDICTOR === transform.type)
			pixels = applyPredictor(pixels, width, height, transform);
		else pixels = applyColour(pixels, width, height, transform);
	}
	return pixels;
}

/** The places of the picture of the picture of the web of no count of the places of the file of their own, of the
 * counts of the head of the format of the picture of the web of the colour of the places of the file. */
export function readVp8lPicture(payload: Buffer): BmpImage {
	if (payload.length < 5 || 0x2f !== payload[0])
		throw invalid(
			"The picture of the web of the counts of the head of the format of the picture of the web stands of no counts of the head of the format of the picture of the web",
		);
	const bits = new BitReader(payload.subarray(1));
	const width = bits.read(14) + 1;
	const height = bits.read(14) + 1;
	bits.read(1);
	if (0 !== bits.read(3))
		throw invalid(
			"The picture of the web stands of counts of the head of the format of the picture of the web of their own",
		);
	const pixels = readImageStream(bits, width, height, true);
	const out: Buffer = Buffer.alloc(width * height * 4, 0x00);
	for (let at = 0; at < width * height; at += 1) {
		const pixel = pixels[at] ?? 0;
		out[at * 4] = pixel & 0xff;
		out[at * 4 + 1] = (pixel >> 8) & 0xff;
		out[at * 4 + 2] = (pixel >> 16) & 0xff;
		out[at * 4 + 3] = (pixel >> 24) & 0xff;
	}
	return {
		width,
		height,
		bitsPerPixel: 32,
		palette: Buffer.alloc(0),
		pixels: out,
	};
}
