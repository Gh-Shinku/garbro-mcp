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

/**
 * `CbgReader.UnpackV1`: the weights of the tree stand at the head of the walked stream and the coded places
 * behind them. The reference reads the weights from the walked stream and the codes through the bit reader
 * of the picture, which by then stands past that stream; this port reads the codes from the walked stream
 * itself, which is where the sum and the exclusive or of the head say they stand.
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
	const bits = new MsbBitReader(payload, at);
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

/** `CompressedBGFormat.Read`: the picture of the engine as a bitmap. */
export function renderCbgPicture(data: Buffer, header: CbgHeader): Buffer {
	if (header.version >= FIRST_WALK_MAX_VERSION) {
		if (FIRST_WALK_MAX_VERSION === header.version) {
			if (header.encodedLength < SECOND_WALK_MIN_ENCODED) {
				throw invalidPicture(
					"A picture of the engine of no places of the file of it",
				);
			}
			throw unsupported(
				"The second walk of the engine (the walk of the places of the file of the colour of it)",
			);
		}
		throw unsupported("The version of the picture of the engine");
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
