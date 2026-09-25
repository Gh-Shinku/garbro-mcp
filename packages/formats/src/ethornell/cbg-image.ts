// Format reference: GARbro "ArcFormats/Ethornell/ImageCBG.cs", classes `CompressedBGFormat`, `CbgReader`,
// `HuffmanTree` and `ParallelCbgDecoder`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	RGB565_MASKS,
	writeBmp8,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { MsbBitReader, updateDscKey } from "./codecs.js";

/** `CompressedBGFormat.ReadMetaData`: `CompressedBG___`. */
const MARK = "CompressedBG___";
const MARK_SIZE = MARK.length;
const HEADER_SIZE = 0x30;
const WIDTH_AT = 0x10;
const HEIGHT_AT = 0x12;
const BITS_AT = 0x14;
const INTERMEDIATE_AT = 0x20;
const KEY_AT = 0x24;
const ENCODED_LENGTH_AT = 0x28;
const CHECK_SUM_AT = 0x2c;
const CHECK_XOR_AT = 0x2d;
const VERSION_AT = 0x2e;
/** The reference takes the first walk for every version below the second one. */
const FIRST_WALK_MAX_VERSION = 2;
/** `CbgReader.Unpack`: the second walk refuses a shorter encoded stream. */
const SECOND_WALK_MIN_ENCODED = 0x80;
/** `ReadWeightTable` values and the places of a picture stand as words of their own. */
const LEAF_COUNT = 0x100;
const BITS_PER_PLACE = 8;
const VARINT_TAIL = 0x7f;
const VARINT_MORE = 0x80;
const VARINT_MAX_LENGTH = 32;
/** The counter of the reference's own weight loop. */
const CHILD_COUNT = 2;
/** `UpdateKey` returns a byte and the mask of a byte is ... */
const BYTE_MASK = 0xff;
/** A guard of this port: the places a picture can hold. */
const MAX_PICTURE_PLACES = 0x10000000;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidPicture("A picture of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/** `CompressedBGFormat.ReadMetaData`: the head of a compressed picture of the engine. */
export interface CbgHeader {
	width: number;
	height: number;
	bitsPerPixel: number;
	intermediateLength: number;
	key: number;
	encodedLength: number;
	checkSum: number;
	checkXor: number;
	version: number;
}

export function readCbgHeader(data: Buffer): CbgHeader | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, MARK_SIZE) !== MARK) return undefined;
	const header: CbgHeader = {
		width: data.readUInt16LE(WIDTH_AT),
		height: data.readUInt16LE(HEIGHT_AT),
		bitsPerPixel: data.readInt32LE(BITS_AT),
		intermediateLength: data.readInt32LE(INTERMEDIATE_AT),
		key: data.readUInt32LE(KEY_AT),
		encodedLength: data.readInt32LE(ENCODED_LENGTH_AT),
		checkSum: data[CHECK_SUM_AT] ?? 0,
		checkXor: data[CHECK_XOR_AT] ?? 0,
		version: data.readUInt16LE(VERSION_AT),
	};
	if (header.width <= 0 || header.height <= 0) return undefined;
	if (header.intermediateLength < 0 || header.encodedLength < 0)
		return undefined;
	if (
		32 !== header.bitsPerPixel &&
		24 !== header.bitsPerPixel &&
		16 !== header.bitsPerPixel &&
		8 !== header.bitsPerPixel
	) {
		return undefined;
	}
	const pixelSize = header.bitsPerPixel / BITS_PER_PLACE;
	if (header.width * pixelSize * header.height > MAX_PICTURE_PLACES) {
		return undefined;
	}
	// The reference refuses a sixteen bit picture of the second walk alone.
	if (16 === header.bitsPerPixel && FIRST_WALK_MAX_VERSION === header.version) {
		return undefined;
	}
	return header;
}

/** `ReadInteger`: a count of places, seven bits to a letter with the high bit of the last one clear. */
function readInteger(
	data: Buffer,
	at: number,
): { value: number; at: number } | undefined {
	let value = 0;
	let length = 0;
	let cursor = at;
	for (;;) {
		if (cursor >= data.length || length >= VARINT_MAX_LENGTH) return undefined;
		const code = data[cursor] ?? 0;
		cursor += 1;
		value |= (code & VARINT_TAIL) << length;
		length += 7;
		if (0 === (code & VARINT_MORE)) break;
	}
	return { value: value >>> 0, at: cursor };
}

/**
 * `CbgReader.ReadEncoded`: every place of the stored stream carries the key of the engine, and the sum and
 * the exclusive or of the places are checked against the head.
 */
export function decodeCbgPayload(data: Buffer, header: CbgHeader): Buffer {
	if (HEADER_SIZE + header.encodedLength > data.length) {
		throw invalidPicture(
			"A picture of the engine of no places of the file of it",
		);
	}
	const payload = Buffer.from(
		data.subarray(HEADER_SIZE, HEADER_SIZE + header.encodedLength),
	);
	// The reference starts its key from the key of the head and a magic of nothing.
	const state = { key: header.key, magic: 0 };
	let sum = 0;
	let xor = 0;
	for (let at = 0; at < payload.length; at += 1) {
		payload[at] = ((payload[at] ?? 0) - updateDscKey(state)) & BYTE_MASK;
		sum = (sum + (payload[at] ?? 0)) & BYTE_MASK;
		xor ^= payload[at] ?? 0;
	}
	if (sum !== header.checkSum || xor !== header.checkXor) {
		throw invalidPicture(
			"The stream of the engine of no places of the file of it",
		);
	}
	return payload;
}

/** A node of the tree of the engine: a leaf of a weight or a join of two nodes. */
interface CbgNode {
	valid: boolean;
	isParent: boolean;
	weight: number;
	left: number;
	right: number;
}

/**
 * `HuffmanTree`: the weights of the leaves are joined two at a time, the lightest first. The second walk of
 * the reference takes the first valid node it meets as the first child and only then looks for a lighter
 * one, which the flag carries over.
 */
export function buildCbgHuffmanTree(
	weights: readonly number[],
	secondWalk = false,
): CbgNode[] {
	const nodes: CbgNode[] = [];
	let rootWeight = 0;
	for (const weight of weights) {
		const value = weight >>> 0;
		nodes.push({
			valid: 0 !== value,
			isParent: false,
			weight: value,
			left: -1,
			right: -1,
		});
		rootWeight = (rootWeight + value) >>> 0;
	}
	for (;;) {
		let weight = 0;
		const children: number[] = [];
		for (let i = 0; i < CHILD_COUNT; i += 1) {
			let minimum = 0xffffffff;
			let child = -1;
			let at = 0;
			if (secondWalk) {
				for (; at < nodes.length; at += 1) {
					const node = nodes[at];
					if (node?.valid) {
						minimum = node.weight;
						child = at;
						at += 1;
						break;
					}
				}
				at = Math.max(at, i + 1);
			}
			for (; at < nodes.length; at += 1) {
				const node = nodes[at];
				if (node?.valid && node.weight < minimum) {
					minimum = node.weight;
					child = at;
				}
			}
			children.push(child);
			if (-1 === child) continue;
			const taken = nodes[child];
			if (taken) taken.valid = false;
			weight = (weight + (taken?.weight ?? 0)) >>> 0;
		}
		nodes.push({
			valid: true,
			isParent: true,
			left: children[0] ?? -1,
			right: children[1] ?? -1,
			weight,
		});
		if (weight >= rootWeight) break;
	}
	return nodes;
}

/** `HuffmanTree.DecodeToken`: the walk from the last node, a bit at a time. */
export function decodeCbgToken(
	bits: MsbBitReader,
	nodes: readonly CbgNode[],
): number {
	let at = nodes.length - 1;
	for (;;) {
		const bit = bits.readBits(1);
		const node = nodes[at];
		if (!node)
			throw invalidPicture("The tree of the engine of no places of the node");
		at = 0 === bit ? node.left : node.right;
		if (at < 0 || at >= nodes.length) {
			throw invalidPicture("The tree of the engine of no places of the node");
		}
		if (!nodes[at]?.isParent) return at;
	}
}

/**
 * `CbgReader.UnpackZeros`: runs of literal places and runs of nothing, the length of each read as a count of
 * places. The reference stops at the end of either run of places.
 */
export function unpackCbgZeros(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength, 0);
	let destination = 0;
	let decZero = 0;
	let source = 0;
	while (destination < outputLength) {
		const counted = readInteger(input, source);
		if (!counted) return output;
		const count = counted.value;
		source = counted.at;
		if (destination + count > outputLength) break;
		if (0 === decZero) {
			if (source + count > input.length) break;
			input.copy(output, destination, source, source + count);
			source += count;
		}
		decZero ^= 1;
		destination += count;
	}
	return output;
}

/**
 * `CbgReader.ReverseAverageSampling`: every place of a picture carries the mean of the place before it and
 * the place above it, halved where both stand, added to what the walk of the engine left there.
 */
export function reverseCbgAverageSampling(
	output: Buffer,
	width: number,
	height: number,
	pixelSize: number,
): void {
	const stride = width * pixelSize;
	for (let y = 0; y < height; y += 1) {
		const line = y * stride;
		for (let x = 0; x < width; x += 1) {
			const pixel = line + x * pixelSize;
			for (let p = 0; p < pixelSize; p += 1) {
				let average = 0;
				if (x > 0) average += output[pixel + p - pixelSize] ?? 0;
				if (y > 0) average += output[pixel + p - stride] ?? 0;
				if (x > 0 && y > 0) average = Math.trunc(average / 2);
				if (0 !== average) {
					output[pixel + p] = ((output[pixel + p] ?? 0) + average) & BYTE_MASK;
				}
			}
		}
	}
}

/** The side of a block of the second walk and the places of a colour in it. */
const BLOCK_SIDE = 8;
const BLOCK_PLACES = 64;
/** `ParallelCbgDecoder`: the two trees of a block and the table of its places. */
const WALK2_TREE1_LEAVES = 0x10;
const WALK2_TREE2_LEAVES = 0xb0;
const DCT_DATA_SIZE = 0x80;
/** The places of a colour of a block of the second walk and of a picture of three places. */
const COLOUR_PLACES = 4;
const THREE_PLACES = 3;
const BLOCK_BYTES = 32;
const CHANNEL_COUNT = 3;
/** `ParallelCbgDecoder.UnpackAlpha`: the mark of the alpha stream. */
const ALPHA_MARK = 1;
const ALPHA_CONTROL = 0x100;

/** `ParallelCbgDecoder.block_fill_order`. */
const BLOCK_FILL_ORDER: readonly number[] = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
	48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
	22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
	47, 55, 62, 63,
];

/** The constants of the colour walk, kept at the single precision of the reference. */
const SQRT2 = Math.SQRT2;
const SPLIT_1847759065 = 1.847759065;
const SPLIT_1082392200 = 1.0823922;
const SPLIT_2613125930 = 2.61312593;
const RED_FROM_CR = 1.402;
const RED_BASE = 178.956;
const GREEN_FROM_CB = 0.34414;
const GREEN_FROM_CR = 0.71414;
const GREEN_BASE = 135.95984;
const BLUE_FROM_CB = 1.772;
const BLUE_BASE = 226.316;

/** The single precision of the reference's own arithmetic, which `float` carries on every step. */
function single(value: number): number {
	return Math.fround(value);
}

/** `ParallelCbgDecoder.FloatToShort`. */
function floatToShort(value: number): number {
	const scaled = 0x80 + (Math.trunc(value) >> 3);
	if (scaled <= 0) return 0;
	if (scaled <= 0xff) return scaled;
	if (scaled < 0x180) return 0xff;
	return 0;
}

/** `ParallelCbgDecoder.FloatToByte`. */
function floatToByte(value: number): number {
	if (value >= 0xff) return 0xff;
	if (value <= 0) return 0;
	return Math.trunc(value);
}

/** `ReadWeightTable` over the stream behind the walked stream of the head. */
function readCbgWeights(
	data: Buffer,
	at: number,
	count: number,
): { weights: number[]; at: number } {
	const weights: number[] = [];
	let cursor = at;
	for (let i = 0; i < count; i += 1) {
		const weight = readInteger(data, cursor);
		if (!weight) throw invalidPicture("The tree of the engine of no weights");
		weights.push(weight.value);
		cursor = weight.at;
	}
	return { weights, at: cursor };
}

/** `ParallelCbgDecoder.DecodeDCT`: the places of one channel of a block, out of its coded places. */
function decodeCbgDct(
	channel: number,
	data: Int16Array,
	src: number,
	block: Int16Array,
	table: Float64Array,
	tmp: Float64Array,
): void {
	const row = channel > 0 ? 1 : 0;
	for (let i = 0; i < BLOCK_SIDE; i += 1) {
		let higher = 0;
		for (let r = 1; r < BLOCK_SIDE; r += 1) {
			higher += Math.abs(data[src + r * BLOCK_SIDE + i] ?? 0);
		}
		if (0 === higher) {
			const flat = single(
				(data[src + i] ?? 0) * (table[row * BLOCK_PLACES + i] ?? 0),
			);
			for (let r = 0; r < BLOCK_SIDE; r += 1) {
				tmp[r * BLOCK_SIDE + i] = flat;
			}
			continue;
		}
		const quantized = (place: number): number =>
			single(
				(data[src + place * BLOCK_SIDE + i] ?? 0) *
					(table[row * BLOCK_PLACES + place * BLOCK_SIDE + i] ?? 0),
			);
		let v1 = quantized(0);
		const v2 = quantized(1);
		let v3 = quantized(2);
		let v4 = quantized(3);
		let v5 = quantized(4);
		let v6 = quantized(5);
		let v7 = quantized(6);
		let v8 = quantized(7);

		let v10 = single(v1 + v5);
		let v11 = single(v1 - v5);
		const v12 = single(v3 + v7);
		const v13 = single(single(single(v3 - v7) * SQRT2) - v12);
		v1 = single(v10 + v12);
		v7 = single(v10 - v12);
		v3 = single(v11 + v13);
		v5 = single(v11 - v13);
		const v14 = single(v2 + v8);
		const v15 = single(v2 - v8);
		const v16 = single(v6 + v4);
		const v17 = single(v6 - v4);
		v8 = single(v14 + v16);
		v11 = single(single(v14 - v16) * SQRT2);
		const v9 = single(single(v17 + v15) * SPLIT_1847759065);
		v10 = single(single(SPLIT_1082392200 * v15) - v9);
		const v13b = single(single(-SPLIT_2613125930 * v17) + v9);
		v6 = single(v13b - v8);
		v4 = single(v11 - v6);
		const v2b = single(v10 + v4);

		tmp[0 * BLOCK_SIDE + i] = single(v1 + v8);
		tmp[1 * BLOCK_SIDE + i] = single(v3 + v6);
		tmp[2 * BLOCK_SIDE + i] = single(v5 + v4);
		tmp[3 * BLOCK_SIDE + i] = single(v7 - v2b);
		tmp[4 * BLOCK_SIDE + i] = single(v7 + v2b);
		tmp[5 * BLOCK_SIDE + i] = single(v5 - v4);
		tmp[6 * BLOCK_SIDE + i] = single(v3 - v6);
		tmp[7 * BLOCK_SIDE + i] = single(v1 - v8);
	}
	const places: number[] = [];
	for (let i = 0; i < BLOCK_SIDE; i += 1) {
		const row0 = tmp[i * BLOCK_SIDE + 0] ?? 0;
		const row1 = tmp[i * BLOCK_SIDE + 1] ?? 0;
		const row2 = tmp[i * BLOCK_SIDE + 2] ?? 0;
		const row3 = tmp[i * BLOCK_SIDE + 3] ?? 0;
		const row4 = tmp[i * BLOCK_SIDE + 4] ?? 0;
		const row5 = tmp[i * BLOCK_SIDE + 5] ?? 0;
		const row6 = tmp[i * BLOCK_SIDE + 6] ?? 0;
		const row7 = tmp[i * BLOCK_SIDE + 7] ?? 0;

		const v10 = single(row0 + row4);
		const v11 = single(row0 - row4);
		const v12 = single(row2 + row6);
		const v13 = single(single(single(row2 - row6) * SQRT2) - v12);
		const v14 = single(row1 + row7);
		const v15 = single(row1 - row7);
		const v16 = single(row5 + row3);
		const v17 = single(row5 - row3);

		const v1 = single(v10 + v12);
		const v7 = single(v10 - v12);
		const v3 = single(v11 + v13);
		const v5 = single(v11 - v13);
		const v8 = single(v14 + v16);
		const v11b = single(single(v14 - v16) * SQRT2);
		const v9 = single(single(v17 + v15) * SPLIT_1847759065);
		const v10b = single(v9 - single(v15 * SPLIT_1082392200));
		const v13b = single(v9 - single(v17 * SPLIT_2613125930));
		const v6 = single(v13b - v8);
		const v4 = single(v11b - v6);
		const v2 = single(v10b - v4);

		places.push(
			floatToShort(single(v1 + v8)),
			floatToShort(single(v3 + v6)),
			floatToShort(single(v5 + v4)),
			floatToShort(single(v7 + v2)),
			floatToShort(single(v7 - v2)),
			floatToShort(single(v5 - v4)),
			floatToShort(single(v3 - v6)),
			floatToShort(single(v1 - v8)),
		);
	}
	// The reference writes the places of a colour of a block in the order of the rows of the block.
	for (let i = 0; i < BLOCK_SIDE * BLOCK_SIDE; i += 1) {
		block[i * CHANNEL_COUNT + channel] = places[i] ?? 0;
	}
}

/** `ParallelCbgDecoder.DecodeGrayscale`: one channel of a block, every colour place of the picture. */
function decodeCbgBlockGray(
	data: Int16Array,
	output: Buffer,
	dst: number,
	width: number,
	table: Float64Array,
	block: Int16Array,
	tmp: Float64Array,
): void {
	const blocks = width / BLOCK_SIDE;
	let src = 0;
	for (let i = 0; i < blocks; i += 1) {
		decodeCbgDct(0, data, src, block, table, tmp);
		src += BLOCK_PLACES;
		for (let j = 0; j < BLOCK_PLACES; j += 1) {
			const y = j >> 3;
			const x = j & 7;
			const place = (y * width + x) * COLOUR_PLACES;
			const value = (block[j * CHANNEL_COUNT] ?? 0) & BYTE_MASK;
			output[dst + place] = value;
			output[dst + place + 1] = value;
			output[dst + place + 2] = value;
		}
		dst += BLOCK_BYTES;
	}
}

/** `ParallelCbgDecoder.DecodeRGB`: the three channels of a block, as full range YCbCr. */
function decodeCbgBlockRgb(
	data: Int16Array,
	output: Buffer,
	dst: number,
	width: number,
	table: Float64Array,
	block: Int16Array,
	tmp: Float64Array,
): void {
	const blocks = width / BLOCK_SIDE;
	for (let i = 0; i < blocks; i += 1) {
		let src = i * BLOCK_PLACES;
		for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
			decodeCbgDct(channel, data, src, block, table, tmp);
			src += width * BLOCK_SIDE;
		}
		for (let j = 0; j < BLOCK_PLACES; j += 1) {
			const cy = block[j * CHANNEL_COUNT] ?? 0;
			const cb = block[j * CHANNEL_COUNT + 1] ?? 0;
			const cr = block[j * CHANNEL_COUNT + 2] ?? 0;
			const red = single(
				single(single(cy + single(RED_FROM_CR * cr)) - RED_BASE),
			);
			const fromGreen = single(cy - single(GREEN_FROM_CB * cb));
			const green = single(
				single(single(fromGreen - single(GREEN_FROM_CR * cr)) + GREEN_BASE),
			);
			const blue = single(
				single(single(cy + single(BLUE_FROM_CB * cb)) - BLUE_BASE),
			);
			const y = j >> 3;
			const x = j & 7;
			const place = (y * width + x) * COLOUR_PLACES;
			output[dst + place] = floatToByte(blue);
			output[dst + place + 1] = floatToByte(green);
			output[dst + place + 2] = floatToByte(red);
		}
		dst += BLOCK_BYTES;
	}
}

/** `ParallelCbgDecoder.UnpackBlock`: one run of blocks of rows. */
function unpackCbgBlock(
	blockData: Buffer,
	offset: number,
	length: number,
	output: Buffer,
	dst: number,
	width: number,
	bitsPerPixel: number,
	tree1: readonly CbgNode[],
	tree2: readonly CbgNode[],
	table: Float64Array,
	block: Int16Array,
	tmp: Float64Array,
): void {
	if (offset < 0 || length <= 0 || offset + length > blockData.length) {
		throw invalidPicture("The block of the engine of no places of the file");
	}
	const source = blockData.subarray(offset, offset + length);
	const size = readInteger(source, 0);
	if (!size) return;
	const places = size.value;
	const bits = new MsbBitReader(source, size.at);
	const data = new Int16Array(places);
	let acc = 0;
	for (
		let i = 0;
		i < places && bits.byteOffset < source.length;
		i += BLOCK_PLACES
	) {
		const count = decodeCbgToken(bits, tree1);
		if (0 !== count) {
			let value = bits.readBits(count);
			if (0 === value >> (count - 1)) {
				value = value - (1 << count) + 1;
			}
			acc += value;
		}
		data[i] = acc;
	}
	const carried = bits.bitsInByte;
	if (0 !== carried) bits.readBits(carried);
	for (
		let i = 0;
		i < places && bits.byteOffset < source.length;
		i += BLOCK_PLACES
	) {
		let index = 1;
		while (index < BLOCK_PLACES && bits.byteOffset < source.length) {
			const code = decodeCbgToken(bits, tree2);
			if (0 === code) break;
			if (0xf === code) {
				index += 0x10;
				continue;
			}
			index += code & 0xf;
			if (index >= BLOCK_FILL_ORDER.length) break;
			const count = code >> 4;
			let value = bits.readBits(count);
			if (0 !== count && 0 === value >> (count - 1)) {
				value = value - (1 << count) + 1;
			}
			const place = i + (BLOCK_FILL_ORDER[index] ?? 0);
			if (place >= 0 && place < places) data[place] = value;
			index += 1;
		}
	}
	if (8 === bitsPerPixel) {
		decodeCbgBlockGray(data, output, dst, width, table, block, tmp);
	} else {
		decodeCbgBlockRgb(data, output, dst, width, table, block, tmp);
	}
}

/** `ParallelCbgDecoder.UnpackAlpha`: the alpha places of a thirty two bit picture. */
function unpackCbgAlpha(
	blockData: Buffer,
	offset: number,
	output: Buffer,
	width: number,
): boolean {
	if (offset < 0 || offset >= blockData.length) return false;
	const alpha = blockData.subarray(offset);
	if (alpha.length < 4 || ALPHA_MARK !== alpha.readInt32LE(0)) return false;
	let at = 4;
	let dst = 3;
	let control = 1 << 1;
	while (dst < output.length) {
		control >>= 1;
		if (1 === control) {
			if (at >= alpha.length) return false;
			control = (alpha[at] ?? 0) | ALPHA_CONTROL;
			at += 1;
		}
		if (0 !== (control & 1)) {
			if (at + 2 > alpha.length) return false;
			const value = (alpha[at] ?? 0) | ((alpha[at + 1] ?? 0) << 8);
			at += 2;
			let x = value & 0x3f;
			if (x > 0x1f) x |= -0x40;
			let y = (value >> 6) & 7;
			if (0 !== y) y |= -8;
			const count = ((value >> 9) & 0x7f) + 3;
			let source = dst + (x + y * width) * COLOUR_PLACES;
			if (source < 0 || source >= dst) return false;
			for (let i = 0; i < count; i += 1) {
				output[dst] = output[source] ?? 0;
				source += COLOUR_PLACES;
				dst += COLOUR_PLACES;
			}
		} else {
			if (at >= alpha.length) return false;
			output[dst] = alpha[at] ?? 0;
			at += 1;
			dst += COLOUR_PLACES;
		}
	}
	return true;
}

/**
 * `CbgReader.UnpackV2`: the table of the places of the colour stands in the walked stream of the head, and
 * the two trees, the places of the runs of blocks and the blocks themselves stand behind it in the clear.
 * The reference walks the runs of blocks side by side with `Task.Run`; every run writes a region of its
 * own, so this port walks them one after another.
 */
export function unpackCbgSecondWalk(
	data: Buffer,
	header: CbgHeader,
): { pixels: Buffer; width: number; height: number; hasAlpha: boolean } {
	const payload = decodeCbgPayload(data, header);
	const table = new Float64Array(DCT_DATA_SIZE);
	for (let i = 0; i < DCT_DATA_SIZE; i += 1) {
		table[i] = single((payload[i] ?? 0) * (DCT_TABLE[i % BLOCK_PLACES] ?? 0));
	}
	const width = (header.width + 7) & -8;
	const height = (header.height + 7) & -8;
	const baseOffset = HEADER_SIZE + header.encodedLength;
	const first = readCbgWeights(data, baseOffset, WALK2_TREE1_LEAVES);
	const second = readCbgWeights(data, first.at, WALK2_TREE2_LEAVES);
	const tree1 = buildCbgHuffmanTree(first.weights, true);
	const tree2 = buildCbgHuffmanTree(second.weights, true);
	const blocks = height / BLOCK_SIDE;
	const words = blocks + 1;
	if (second.at + words * 4 > data.length) {
		throw invalidPicture("The places of the file of the blocks of the engine");
	}
	const inputBase = second.at + words * 4 - baseOffset;
	const offsets: number[] = [];
	for (let i = 0; i < words; i += 1) {
		offsets.push(data.readInt32LE(second.at + i * 4) - inputBase);
	}
	const blockData = data.subarray(second.at + words * 4);
	const padSkip = ((width >> 3) + 7) >> 3;
	const output = Buffer.alloc(width * height * COLOUR_PLACES, 0);
	const block = new Int16Array(BLOCK_PLACES * CHANNEL_COUNT);
	const tmp = new Float64Array(BLOCK_PLACES);
	let dst = 0;
	for (let i = 0; i < blocks; i += 1) {
		const offset = (offsets[i] ?? 0) + padSkip;
		const next = i + 1 === blocks ? blockData.length : (offsets[i + 1] ?? 0);
		unpackCbgBlock(
			blockData,
			offset,
			next - offset,
			output,
			dst,
			width,
			header.bitsPerPixel,
			tree1,
			tree2,
			table,
			block,
			tmp,
		);
		dst += width * BLOCK_BYTES;
	}
	let hasAlpha = false;
	if (32 === header.bitsPerPixel) {
		hasAlpha = unpackCbgAlpha(blockData, offsets[blocks] ?? 0, output, width);
	}
	return { pixels: output, width, height, hasAlpha };
}

/**
 * The reference hands the walked places of the second walk over with four places to a colour and the rows
 * of the blocks of eight: a picture of a width that is not a multiple of eight carries the places of the
 * padding of its last block. This port takes those places out, so a bitmap of the size of the head stands.
 */
function cropCbgPicture(
	picture: { pixels: Buffer; width: number; height: number; hasAlpha: boolean },
	width: number,
	height: number,
): Buffer {
	const places = picture.hasAlpha ? COLOUR_PLACES : THREE_PLACES;
	const output = Buffer.alloc(width * height * places, 0);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const from = (y * picture.width + x) * COLOUR_PLACES;
			const to = (y * width + x) * places;
			output[to] = picture.pixels[from] ?? 0;
			output[to + 1] = picture.pixels[from + 1] ?? 0;
			output[to + 2] = picture.pixels[from + 2] ?? 0;
			if (picture.hasAlpha) output[to + 3] = picture.pixels[from + 3] ?? 0;
		}
	}
	return output;
}

/**
 * `CbgReader.UnpackV1`: the weights of the tree stand in the walked stream of the head and the coded places
 * stand behind that stream, in the clear. The picture itself is the bit stream the reference reads the
 * codes through, and the reference leaves it standing right behind the walked stream of the head, so the
 * codes begin at the place behind it.
 */
export function unpackCbgFirstWalk(
	data: Buffer,
	header: CbgHeader,
): { pixels: Buffer; width: number; height: number; pixelSize: number } {
	const payload = decodeCbgPayload(data, header);
	const weights: number[] = [];
	let at = 0;
	for (let i = 0; i < LEAF_COUNT; i += 1) {
		const weight = readInteger(payload, at);
		if (!weight) throw invalidPicture("The tree of the engine of no weights");
		weights.push(weight.value);
		at = weight.at;
	}
	const nodes = buildCbgHuffmanTree(weights);
	const bits = new MsbBitReader(data, HEADER_SIZE + header.encodedLength);
	const packed = Buffer.alloc(header.intermediateLength, 0);
	for (let i = 0; i < packed.length; i += 1) {
		packed[i] = decodeCbgToken(bits, nodes) & BYTE_MASK;
	}
	const pixelSize = header.bitsPerPixel / BITS_PER_PLACE;
	const pixels = unpackCbgZeros(
		packed,
		header.width * pixelSize * header.height,
	);
	reverseCbgAverageSampling(pixels, header.width, header.height, pixelSize);
	return {
		pixels,
		width: header.width,
		height: header.height,
		pixelSize,
	};
}

/** `ParallelCbgDecoder.DCT_Table`: the table of the places of the colour of a block. */
const DCT_TABLE: readonly number[] = [
	1.0, 1.3870399, 1.30656302, 1.17587554, 1.0, 0.78569496, 0.54119611,
	0.27589938, 1.3870399, 1.9238795, 1.81225491, 1.63098633, 1.3870399,
	1.08979023, 0.75066054, 0.38268343, 1.30656302, 1.81225491, 1.70710683,
	1.5363555, 1.30656302, 1.02655995, 0.70710677, 0.36047992, 1.17587554,
	1.63098633, 1.5363555, 1.3826834, 1.17587554, 0.9238795, 0.6363793,
	0.32442334, 1.0, 1.3870399, 1.30656302, 1.17587554, 1.0, 0.78569496,
	0.54119611, 0.27589938, 0.78569496, 1.08979023, 1.02655995, 0.9238795,
	0.78569496, 0.61731654, 0.42521504, 0.21677275, 0.54119611, 0.75066054,
	0.70710677, 0.6363793, 0.54119611, 0.42521504, 0.29289323, 0.14931567,
	0.27589938, 0.38268343, 0.36047992, 0.32442334, 0.27589938, 0.21677275,
	0.14931567, 0.07612047,
];

/** `CompressedBGFormat.Read`: the picture of the engine as a bitmap. */
export function renderCbgPicture(data: Buffer, header: CbgHeader): Buffer {
	if (header.version > FIRST_WALK_MAX_VERSION) {
		throw unsupported("The version of the picture of the engine");
	}
	if (FIRST_WALK_MAX_VERSION === header.version) {
		if (header.encodedLength < SECOND_WALK_MIN_ENCODED) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of it",
			);
		}
		const second = unpackCbgSecondWalk(data, header);
		const cropped = cropCbgPicture(second, header.width, header.height);
		// The reference hands a picture of the second walk over with four places to a colour, of which the
		// fourth stands only where the walk of the alpha places carried one.
		return second.hasAlpha
			? writeBmp32(header.width, header.height, cropped)
			: writeBmp24(header.width, header.height, cropped);
	}
	const picture = unpackCbgFirstWalk(data, header);
	if (8 === header.bitsPerPixel) {
		// The reference hands a picture of one place to a colour over as a grey picture, which the bitmap
		// writer of this port writes with a grey ramp.
		return writeBmp8(picture.width, picture.height, picture.pixels);
	}
	if (16 === header.bitsPerPixel) {
		return writeBmp16(
			picture.width,
			picture.height,
			picture.pixels,
			false,
			RGB565_MASKS,
		);
	}
	if (32 === header.bitsPerPixel) {
		return writeBmp32(picture.width, picture.height, picture.pixels);
	}
	return writeBmp24(picture.width, picture.height, picture.pixels);
}

export const ethornellCbgImageDescriptor: FormatDescriptor = {
	id: "ethornell-cbg-image",
	name: "BGI/Ethornell compressed image",
	extensions: ["bgi"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Ethornell/ImageCBG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ethornellCbgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ethornellCbgImageDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from(MARK, "latin1") }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readCbgHeader(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const header = readCbgHeader(data);
		if (!header) throw invalidPicture("Not a compressed picture of the engine");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: header.width,
							height: header.height,
							bitsPerPixel: header.bitsPerPixel,
							version: header.version,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: header.width,
				height: header.height,
				bitsPerPixel: header.bitsPerPixel,
				version: header.version,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry) {
		const data = await readStored(source);
		const header = readCbgHeader(data);
		if (!header) throw invalidPicture("Not a compressed picture of the engine");
		return Readable.from([renderCbgPicture(data, header)]);
	},
});
