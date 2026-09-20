import { decodeJbpCoefficients } from "./jbp-coefficients.js";
import { inverseJbpDct } from "./jbp-dct.js";
import { JbpBitStream, JbpHuffmanTree } from "./jbp-huffman.js";
import { standJbpColours } from "./jbp-ycc.js";

const HEADER_SIZE = 0x24;
const DATA_FIELD = 0x04;
const KIND_FIELD = 0x08;
const WIDTH_FIELD = 0x10;
const HEIGHT_FIELD = 0x12;
const PLACES_FIELD = 0x1c;
const OTHER_PLACES_FIELD = 0x20;
const WALK_FIELD = 0x80;
const WALK_PLACES = 0x10;
const FREQUENCY_SIZE = 0x40;
const QUANT_SIZE = 0x40;
const QUANT_FIELD = 0x80;
const PLACES_PER_SIDE = 16;
const SIDE_PLACES = 4;
const BLOCKS_PER_PLACE = 6;
const PLACES_PER_BLOCK = 64;
const COLOURS_PER_PLACE = 4;

export interface JbpPicture {
	/** How wide and how tall the picture stands, as the words of its head name it. */
	width: number;
	height: number;
	alignedWidth: number;
	alignedHeight: number;
	stride: number;
	pixels: Buffer;
}

export function readJbpHead(
	data: Buffer,
	offset = 0,
): {
	dataPos: number;
	kind: number;
	width: number;
	height: number;
	places: number;
	otherPlaces: number;
} {
	const dataPos = data.readInt32LE(offset + DATA_FIELD) + offset;
	const kind = data.readUInt32LE(offset + KIND_FIELD);
	const width = data.readUInt16LE(offset + WIDTH_FIELD);
	const height = data.readUInt16LE(offset + HEIGHT_FIELD);
	const places = data.readInt32LE(offset + PLACES_FIELD);
	const otherPlaces = data.readInt32LE(offset + OTHER_PLACES_FIELD);
	return { dataPos, kind, width, height, places, otherPlaces };
}

export function alignedJbpPlaces(
	width: number,
	height: number,
	kind: number,
): { width: number; height: number } {
	switch ((kind >>> 28) & 3) {
		case 0:
			return { width: (width + 7) & ~7, height: (height + 7) & ~7 };
		case 1:
			return { width: (width + 0xf) & ~0xf, height: (height + 0xf) & ~0xf };
		case 2:
			return { width: (width + 0x1f) & ~0x1f, height: (height + 0xf) & ~0xf };
		default:
			throw new RangeError(
				"Purple picture stands as no kind of picture at all",
			);
	}
}

function readFrequencies(data: Buffer, at: number): number[] {
	const frequencies: number[] = [];
	for (let at_ = 0; at_ < WALK_PLACES; at_ += 1) {
		frequencies.push(data.readUInt32LE(at + at_ * 4));
	}
	return frequencies;
}

export function decodeJbpPicture(data: Buffer, offset = 0): JbpPicture {
	const head = readJbpHead(data, offset);
	const aligned = alignedJbpPlaces(head.width, head.height, head.kind);
	const blocksX = aligned.width >> SIDE_PLACES;
	const blocksY = aligned.height >> SIDE_PLACES;
	const stride = COLOURS_PER_PLACE * aligned.width;
	const pixels = Buffer.alloc(stride * aligned.height, 0x00);
	const walkAt = head.dataPos + WALK_FIELD;
	const walkWords = Buffer.alloc(WALK_PLACES, 0x00);
	for (let at = 0; at < WALK_PLACES; at += 1) {
		walkWords[at] = ((data[walkAt + at] ?? 0) + 1) & 0xff;
	}
	const treeDc = new JbpHuffmanTree(
		walkWords,
		readFrequencies(data, head.dataPos),
	);
	const treeAc = new JbpHuffmanTree(
		walkWords,
		readFrequencies(data, head.dataPos + FREQUENCY_SIZE),
	);
	const quantAt = walkAt + WALK_PLACES;
	const quantY = new Int16Array(QUANT_SIZE);
	const quantC = new Int16Array(QUANT_SIZE);
	if (0 !== (head.kind & 0x8000000)) {
		for (let at = 0; at < QUANT_SIZE; at += 1) {
			quantY[at] = data[quantAt + at] ?? 0;
			quantC[at] = data[quantAt + at + QUANT_SIZE] ?? 0;
		}
	}
	const bitsAt = quantAt + QUANT_FIELD;
	const bitsDc = new JbpBitStream(data, bitsAt, head.places);
	const bitsAc = new JbpBitStream(data, bitsAt + head.places, head.otherPlaces);
	const tables = decodeJbpCoefficients({
		treeDc,
		bitsDc,
		treeAc,
		bitsAc,
		blocks: { blocksX, blocksY },
	});
	for (let y = 0; y < blocksY; y += 1) {
		let first = y * stride * PLACES_PER_SIDE;
		let second = first + stride * 9;
		for (let x = 0; x < blocksX; x += 1) {
			const base = (y * blocksX + x) * BLOCKS_PER_PLACE * PLACES_PER_BLOCK;
			const placesAt = (place: number): Int16Array =>
				tables.subarray(
					base + place * PLACES_PER_BLOCK,
					base + (place + 1) * PLACES_PER_BLOCK,
				);
			inverseJbpDct(tables, quantY, base + 0 * PLACES_PER_BLOCK);
			inverseJbpDct(tables, quantY, base + 1 * PLACES_PER_BLOCK);
			inverseJbpDct(tables, quantY, base + 2 * PLACES_PER_BLOCK);
			inverseJbpDct(tables, quantY, base + 3 * PLACES_PER_BLOCK);
			inverseJbpDct(tables, quantC, base + 4 * PLACES_PER_BLOCK);
			inverseJbpDct(tables, quantC, base + 5 * PLACES_PER_BLOCK);
			const cb = placesAt(4);
			const cr = placesAt(5);
			standJbpColours({
				output: pixels,
				stride,
				dc: first,
				ac: first + stride,
				y: placesAt(0),
				cb,
				cr,
				cbcrSrc: 0,
			});
			standJbpColours({
				output: pixels,
				stride,
				dc: first + 32,
				ac: first + stride + 32,
				y: placesAt(1),
				cb,
				cr,
				cbcrSrc: 4,
			});
			standJbpColours({
				output: pixels,
				stride,
				dc: second - stride,
				ac: second,
				y: placesAt(2),
				cb,
				cr,
				cbcrSrc: 32,
			});
			standJbpColours({
				output: pixels,
				stride,
				dc: second - stride + 32,
				ac: second + 32,
				y: placesAt(3),
				cb,
				cr,
				cbcrSrc: 36,
			});
			first += 8 * COLOURS_PER_PLACE;
			second += 8 * COLOURS_PER_PLACE;
		}
	}
	return {
		width: head.width,
		height: head.height,
		alignedWidth: aligned.width,
		alignedHeight: aligned.height,
		stride,
		pixels,
	};
}

export function jbpToBgr(picture: JbpPicture): Buffer {
	const packed: Buffer = Buffer.alloc(picture.width * picture.height * 3, 0x00);
	for (let y = 0; y < picture.height; y += 1) {
		for (let x = 0; x < picture.width; x += 1) {
			const from = y * picture.stride + x * COLOURS_PER_PLACE;
			const to = (y * picture.width + x) * 3;
			packed[to] = picture.pixels[from] ?? 0;
			packed[to + 1] = picture.pixels[from + 1] ?? 0;
			packed[to + 2] = picture.pixels[from + 2] ?? 0;
		}
	}
	return packed;
}

export const JBP_HEADER_SIZE = HEADER_SIZE;
