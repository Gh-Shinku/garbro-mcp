// Format reference: GARbro "Legacy/KApp/ImageCGD.cs", classes `CgdKToolFormat`, `CgdSpielFormat`,
// `CgdMetaData`, `KTool` and `KTool.HuffmanDecoder` (KApp and Spiel pictures behind the engine's own RLE or
// Huffman). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'ktool210' and 'spiel100', the eight byte marks of the two heads. */
const KTOOL_SIGNATURE = Buffer.from("ktool210", "latin1");
const SPIEL_SIGNATURE = Buffer.from("spiel100", "latin1");
/** The word at eight that both heads have to hold. */
const VERSION_ONE = 1;
const KTOOL_HEADER_SIZE = 0x18;
const KTOOL_STREAM_FIELD = 0x10;
const KTOOL_STREAM_FLAG = 0x7fffffff;
const SPIEL_HEADER_SIZE = 0x20;
const SPIEL_STREAM_FIELD = 0x10;
const SPIEL_WIDTH_FIELD = 0x18;
const SPIEL_HEIGHT_FIELD = 0x1a;
const SPIEL_DEPTH_FIELD = 0x1e;
const SPIEL_COMPRESSION_FIELD = 0x1f;
/** The inner head every KApp picture carries, whichever the outer head is. */
const INNER_UNPACKED_SIZE_FIELD = 0x00;
const INNER_COMPRESSION_FIELD = 0x08;
const INNER_HEADER_SIZE_FIELD = 0x0a;
const INNER_ID_FIELD = 0x0c;
const INNER_WIDTH_FIELD = 0x10;
const INNER_HEIGHT_FIELD = 0x12;
const INNER_DEPTH_FIELD = 0x14;
const INNER_HEAD_SIZE = 0x10;
/** The two words the inner head may carry. */
const CGD_IDS = [0x973768, 0xb29ea4];
/** The compression of the inner head: as they stand, four kinds of run, or the engine's Huffman. */
const COMPRESSION_STORED = 0x00;
const COMPRESSION_RUNS = [0x01, 0x02, 0x03, 0x04];
const COMPRESSION_HUFFMAN = 0x10;
const DEPTHS = [24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** The engine's Huffman tree holds two hundred and fifty seven leaves and up to two hundred and fifty six
 *  branches, with one place beyond them holding a value larger than any code. */
const HUFFMAN_TREE_SIZE = 514;
const HUFFMAN_SENTINEL = 513;
const HUFFMAN_FIRST_BRANCH = 257;
const HUFFMAN_EXTRA_LEAF = 0x100;
const HUFFMAN_LEAF_LIMIT = 0x100;

export interface CgdPictureLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
	unpackedSize: number;
	compression: number;
	/** The reference hands twenty four bit KApp pictures out as `Rgb24` and Spiel ones as `Bgr24`. */
	rgbOrder: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * The inner head both pictures carry, read from a window that begins at it. `absoluteOffset` is where the
 * window stands in the file, which is what the place of the stream is worked out from.
 */
function readCgdInnerWindow(
	window: Buffer,
	absoluteOffset: number,
	fileLength: number,
	rgbOrder: boolean,
): CgdPictureLayout | undefined {
	if (window.length < INNER_DEPTH_FIELD + 2) return undefined;
	const unpackedSize = window.readInt32LE(INNER_UNPACKED_SIZE_FIELD);
	// The word behind the unpacked size is not read by the reference.
	const compression = window.readUInt16LE(INNER_COMPRESSION_FIELD) & 0xff;
	const headerSize = window.readUInt16LE(INNER_HEADER_SIZE_FIELD);
	const id = window.readUInt32LE(INNER_ID_FIELD);
	if (headerSize < INNER_HEAD_SIZE || !CGD_IDS.includes(id)) return undefined;
	const width = window.readUInt16LE(INNER_WIDTH_FIELD);
	const height = window.readUInt16LE(INNER_HEIGHT_FIELD);
	const bitsPerPixel = window.readUInt16LE(INNER_DEPTH_FIELD);
	const dataOffset = absoluteOffset + INNER_HEAD_SIZE + headerSize;
	if (width === 0 || height === 0 || !DEPTHS.includes(bitsPerPixel)) {
		return undefined;
	}
	// The reference takes the declared size as it stands and hands it to `ImageData.Create`, which needs
	// exactly a picture of that size; a head that disagrees with its own measurements is turned away.
	if (unpackedSize !== width * height * (bitsPerPixel >> 3)) return undefined;
	if (unpackedSize > LIMIT || dataOffset >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		dataOffset,
		unpackedSize,
		compression,
		rgbOrder,
	};
}

/**
 * `CgdKToolFormat.ReadMetaData`: the head begins with `ktool210`, the word at eight is one and the word at
 * `0x10` holds the place of the picture with its highest bit cleared. The picture itself begins with the
 * engine's inner head.
 */
export function readCgdKToolLayout(
	data: Buffer,
	fileLength = data.length,
): CgdPictureLayout | undefined {
	if (data.length < KTOOL_HEADER_SIZE) return undefined;
	if (!data.subarray(0, KTOOL_SIGNATURE.length).equals(KTOOL_SIGNATURE)) {
		return undefined;
	}
	if (data.readInt32LE(8) !== VERSION_ONE) return undefined;
	const offset = data.readUInt32LE(KTOOL_STREAM_FIELD) & KTOOL_STREAM_FLAG;
	return readCgdInnerWindow(data.subarray(offset), offset, fileLength, true);
}

/**
 * `CgdSpielFormat.ReadMetaData`: the head begins with `spiel100`, the word at eight is one, the width and
 * the height stand at `0x18` and `0x1A` as words, the depth and the compression behind them as bytes, and
 * the place of the stream at `0x10`. The size is the picture worked out from its own measurements.
 */
export function readCgdSpielLayout(
	data: Buffer,
	fileLength = data.length,
): CgdPictureLayout | undefined {
	if (data.length < SPIEL_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SPIEL_SIGNATURE.length).equals(SPIEL_SIGNATURE)) {
		return undefined;
	}
	if (data.readInt32LE(8) !== VERSION_ONE) return undefined;
	const width = data.readUInt16LE(SPIEL_WIDTH_FIELD);
	const height = data.readUInt16LE(SPIEL_HEIGHT_FIELD);
	const bitsPerPixel = data[SPIEL_DEPTH_FIELD] ?? 0;
	const compression = data[SPIEL_COMPRESSION_FIELD] ?? 0;
	const dataOffset = data.readUInt32LE(SPIEL_STREAM_FIELD);
	if (width === 0 || height === 0 || !DEPTHS.includes(bitsPerPixel)) {
		return undefined;
	}
	const unpackedSize = width * height * (bitsPerPixel >> 3);
	if (
		unpackedSize > LIMIT ||
		dataOffset < SPIEL_HEADER_SIZE ||
		dataOffset >= fileLength
	) {
		return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel,
		dataOffset,
		unpackedSize,
		compression,
		rgbOrder: false,
	};
}

/** A cursor over a stream of the engine's own, with a byte and a signed byte at a time. */
class StreamCursor {
	readonly #data: Buffer;
	#position: number;

	constructor(data: Buffer, position: number) {
		this.#data = data;
		this.#position = position;
	}

	readUInt8(): number {
		if (this.#position >= this.#data.length) {
			throw invalidPicture("KApp picture is cut short of its stream");
		}
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	/** Nothing where the stream ends, which is how the walk of the Huffman tree stops. */
	tryReadUInt8(): number | undefined {
		if (this.#position >= this.#data.length) return undefined;
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	readInt8(): number {
		const value = this.readUInt8();
		return value > 0x7f ? value - 0x100 : value;
	}
}

/**
 * `KTool.DecompressRle`: one run stream a byte of the picture apart. Every step of the picture has its own
 * control byte, read as a signed one; a positive control introduces a value that is written that many times,
 * a negative one that many values that stand themselves, and nothing ends the step. A run that reaches past
 * the picture is refused, which the reference's own array write answers with an exception (a documented
 * deviation in the message only).
 */
export function decompressKToolRle(
	source: StreamCursor,
	output: Buffer,
	step: number,
): void {
	const write = (at: number, value: number): void => {
		if (at < 0 || at >= output.length) {
			throw invalidPicture("KApp picture writes past its own end");
		}
		output[at] = value;
	};
	for (let start = 0; start < step; start += 1) {
		let control = source.readInt8();
		let dst = start;
		while (control !== 0) {
			if (control < 0) {
				let count = -control;
				while (count > 0) {
					write(dst, source.readUInt8());
					dst += step;
					count -= 1;
				}
			} else {
				const value = source.readUInt8();
				let count = control;
				while (count > 0) {
					write(dst, value);
					dst += step;
					count -= 1;
				}
			}
			control = source.readInt8();
		}
	}
}

interface HuffmanNode {
	code: number;
	left: number;
	right: number;
}

/**
 * `KTool.HuffmanDecoder`: the dictionary of two hundred and fifty six weights stands as a run stream of its
 * own, with one more leaf of weight one behind it, and the tree is built by taking the two lightest nodes
 * again and again. A branch is told from a leaf by its place in the tree: everything up to `0x100` is a leaf,
 * and the byte the walk reaches is handed out.
 */
export function inflateKToolHuffman(
	source: StreamCursor,
	outputLength: number,
): Buffer {
	const nodes: HuffmanNode[] = new Array(HUFFMAN_TREE_SIZE);
	for (let index = 0; index < HUFFMAN_TREE_SIZE; index += 1) {
		nodes[index] = { code: 0, left: 0, right: 0 };
	}
	const dictionary = Buffer.alloc(HUFFMAN_EXTRA_LEAF, 0x00);
	decompressKToolRle(source, dictionary, 1);
	for (let index = 0; index < HUFFMAN_EXTRA_LEAF; index += 1) {
		const node = nodes[index];
		if (node) node.code = dictionary[index] ?? 0;
	}
	const extra = nodes[HUFFMAN_EXTRA_LEAF];
	if (extra) extra.code = 1;
	// The place beyond the tree holds a value larger than any code, so a scan that finds nothing else finds
	// it as the second of the two and knows only one node is left.
	const sentinel = nodes[HUFFMAN_SENTINEL];
	if (!sentinel) throw invalidPicture("KApp picture has no Huffman tree");
	sentinel.code = 0xffff;
	let root = HUFFMAN_FIRST_BRANCH;
	while (root > 0) {
		let lhs = HUFFMAN_SENTINEL;
		let rhs = HUFFMAN_SENTINEL;
		for (let index = 0; index < root; index += 1) {
			const code = nodes[index]?.code ?? 0;
			if (code !== 0) {
				const lhsCode = nodes[lhs]?.code ?? 0xffff;
				if (code < lhsCode) {
					rhs = lhs;
					lhs = index;
				} else if (code < (nodes[rhs]?.code ?? 0xffff)) {
					rhs = index;
				}
			}
		}
		if (rhs === HUFFMAN_SENTINEL) break;
		const branch = nodes[root];
		if (!branch)
			throw invalidPicture("KApp picture has too many Huffman branches");
		branch.code = (nodes[rhs]?.code ?? 0) + (nodes[lhs]?.code ?? 0);
		branch.left = lhs;
		branch.right = rhs;
		const left = nodes[lhs];
		const right = nodes[rhs];
		if (left) left.code = 0;
		if (right) right.code = 0;
		root += 1;
	}
	const treeRoot = root - 1;
	const output = Buffer.alloc(outputLength, 0x00);
	let dst = 0;
	let bits = 0;
	let mask = 0;
	while (dst < output.length) {
		let token = treeRoot;
		while (token > HUFFMAN_LEAF_LIMIT) {
			if (0 === mask) {
				const byte = source.tryReadUInt8();
				if (byte === undefined) return output.subarray(0, dst);
				bits = byte;
				mask = 0x80;
			}
			const node = nodes[token];
			if (!node)
				throw invalidPicture("KApp picture walks off its Huffman tree");
			token = 0 !== (bits & mask) ? node.right : node.left;
			mask >>= 1;
		}
		output[dst] = token & 0xff;
		dst += 1;
	}
	return output;
}

/** `KTool.Unpack`: the method the head declares chooses the walk, and any other method is refused. */
export function unpackCgdPicture(
	data: Buffer,
	layout: CgdPictureLayout,
): Buffer {
	const source = new StreamCursor(data, layout.dataOffset);
	if (COMPRESSION_STORED === layout.compression) {
		const output = Buffer.alloc(layout.unpackedSize, 0x00);
		data.copy(
			output,
			0,
			layout.dataOffset,
			Math.min(data.length, layout.dataOffset + output.length),
		);
		return output;
	}
	if (COMPRESSION_RUNS.includes(layout.compression)) {
		const output = Buffer.alloc(layout.unpackedSize, 0x00);
		decompressKToolRle(source, output, layout.compression);
		return output;
	}
	if (COMPRESSION_HUFFMAN === layout.compression) {
		return inflateKToolHuffman(source, layout.unpackedSize);
	}
	throw invalidPicture(
		"KApp picture uses a compression this reader does not know",
	);
}

/** Twenty four bit `Rgb24` data has its red and blue bytes the other way round from a bitmap. */
function swapRedBlue(pixels: Buffer): Buffer {
	const swapped = Buffer.from(pixels);
	for (let at = 0; at + 2 < swapped.length; at += 3) {
		const red = swapped[at] ?? 0;
		swapped[at] = swapped[at + 2] ?? 0;
		swapped[at + 2] = red;
	}
	return swapped;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** A window of a source, or nothing where it would reach past the end. */
async function readWindow(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || BigInt(offset + length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

function compound(layout: CgdPictureLayout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.dataOffset),
			size: BigInt(layout.unpackedSize),
			compressed: COMPRESSION_STORED !== layout.compression,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				compression: layout.compression,
			},
		}),
		// The pixels are unfolded from the engine's own walk and a bitmap header is written around them.
		sizeKnown: false,
	};
}

function compressionName(compression: number): string {
	if (COMPRESSION_STORED === compression) return "none";
	if (COMPRESSION_HUFFMAN === compression) return "huffman";
	return "rle";
}

async function openCgdPicture(
	source: ByteSource,
	layout: CgdPictureLayout,
): Promise<Readable> {
	const stored = await readStored(source);
	const pixels = unpackCgdPicture(stored, layout);
	// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
	if (32 === layout.bitsPerPixel) {
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	}
	const ordered = layout.rgbOrder ? swapRedBlue(pixels) : pixels;
	return Readable.from([writeBmp24(layout.width, layout.height, ordered)]);
}

export const cgdKToolImageDescriptor: FormatDescriptor = {
	id: "kapp-cgd-ktool-image",
	name: "KApp compressed image format",
	extensions: [],
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
			source: "Legacy/KApp/ImageCGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cgdKToolImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cgdKToolImageDescriptor,
	detection: { signatures: [{ bytes: KTOOL_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(KTOOL_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, KTOOL_HEADER_SIZE));
			if (
				!header.subarray(0, KTOOL_SIGNATURE.length).equals(KTOOL_SIGNATURE) ||
				header.readInt32LE(8) !== VERSION_ONE
			) {
				return false;
			}
			const offset =
				header.readUInt32LE(KTOOL_STREAM_FIELD) & KTOOL_STREAM_FLAG;
			const window = await readWindow(source, offset, INNER_DEPTH_FIELD + 2);
			if (!window) return false;
			return (
				readCgdInnerWindow(window, offset, Number(source.size), true) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCgdKToolLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a KApp picture");
		}
		return {
			entries: [compound(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: compressionName(layout.compression),
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = readCgdKToolLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a KApp picture");
		}
		return openCgdPicture(source, layout);
	},
});

export const cgdSpielImageDescriptor: FormatDescriptor = {
	id: "kapp-cgd-spiel-image",
	name: "Spiel compressed image format",
	extensions: [],
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
			source: "Legacy/KApp/ImageCGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cgdSpielImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cgdSpielImageDescriptor,
	detection: { signatures: [{ bytes: SPIEL_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SPIEL_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, SPIEL_HEADER_SIZE));
			return readCgdSpielLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCgdSpielLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Spiel picture");
		}
		return {
			entries: [compound(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: compressionName(layout.compression),
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = readCgdSpielLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Spiel picture");
		}
		return openCgdPicture(source, layout);
	},
});
