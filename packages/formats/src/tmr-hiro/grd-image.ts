// Format reference: GARBro "ArcFormats/Tmr-Hiro/ImageGRD.cs", class `GrdFormat` with the `GrdReader` beside
// it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head holds two words of its own version, the size of the screen it was drawn on and where it stands. */
const FORMAT_FIELD = 0;
// The head names the width of the screen as well, which the reference reads and never looks at again.
const SCREEN_HEIGHT_FIELD = 4;
const BITS_FIELD = 6;
const LEFT_FIELD = 8;
const RIGHT_FIELD = 0x0a;
const TOP_FIELD = 0x0c;
const BOTTOM_FIELD = 0x0e;
/** The places the four channels stand at, and how long each of them is. */
const ALPHA_SIZE_FIELD = 0x10;
const RED_SIZE_FIELD = 0x14;
const GREEN_SIZE_FIELD = 0x18;
const BLUE_SIZE_FIELD = 0x1c;
const HEAD_SIZE = 0x20;
/** The two bytes that tell a picture of this engine, and the depths it is drawn in. */
const LAYOUTS = [1, 2];
const PACK_TYPES = [1, 0xa1, 0xa2];
const BITS_24 = 24;
const BITS_32 = 32;
/** The three ways a channel is packed, as the second byte of the head names them. */
const PACK_RLE = 1;
const PACK_HUFFMAN_LZ77 = 0xa2;
/** The word of a packed channel: how long it unfolds to, how long it is stored, then a table of counts. */
const HUFFMAN_HEADER_SIZE = 8;
const HUFFMAN_LEAVES = 0x100;
const HUFFMAN_NODES = 0x200;
const HUFFMAN_ROOT = 0x1fe;
/** The head of a channel packed with the word of its own before the runs of it begin. */
const LZ77_HEADER_SIZE = 12;
const LZ77_SPECIAL_FIELD = 8;
/** The RLE of a channel: a count above this many stands for one byte written over and over. */
const RLE_REPEAT = 0x7f;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface TmrHiroGrdLayout {
	format: number;
	packType: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
	alphaSize: number;
	redSize: number;
	greenSize: number;
	blueSize: number;
}

/** One node of the tree a channel is packed with: how often it stands, and the two it reaches. */
interface HuffmanNode {
	frequency: number;
	left: number;
	right: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GrdFormat.ReadMetaData`: the picture opens with two bytes of its own version and names the screen it was
 * drawn on, where it stands inside it, its depth and how long each of its four channels is. The four lengths
 * and the head have to add up to the whole file, which is what tells a file of this engine from any other.
 */
export function readTmrHiroGrdLayout(
	data: Buffer,
): TmrHiroGrdLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!LAYOUTS.includes(data[0] ?? 0)) return undefined;
	if (!PACK_TYPES.includes(data[1] ?? 0)) return undefined;
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	if (BITS_24 !== bitsPerPixel && BITS_32 !== bitsPerPixel) return undefined;
	const screenHeight = data.readUInt16LE(SCREEN_HEIGHT_FIELD);
	const left = data.readUInt16LE(LEFT_FIELD);
	const right = data.readUInt16LE(RIGHT_FIELD);
	const top = data.readUInt16LE(TOP_FIELD);
	const bottom = data.readUInt16LE(BOTTOM_FIELD);
	const width = Math.abs(right - left);
	const height = Math.abs(bottom - top);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	const alphaSize = data.readInt32LE(ALPHA_SIZE_FIELD);
	const redSize = data.readInt32LE(RED_SIZE_FIELD);
	const greenSize = data.readInt32LE(GREEN_SIZE_FIELD);
	const blueSize = data.readInt32LE(BLUE_SIZE_FIELD);
	if (HEAD_SIZE + alphaSize + redSize + blueSize + greenSize !== data.length) {
		return undefined;
	}
	return {
		format: data.readUInt16LE(FORMAT_FIELD),
		packType: data[1] ?? 0,
		width,
		height,
		bitsPerPixel,
		offsetX: left,
		offsetY: screenHeight - bottom,
		alphaSize,
		redSize,
		greenSize,
		blueSize,
	};
}

/**
 * `GrdReader.UnpackRLE`: a count above a hundred and twenty seven names one byte written over and over that
 * many times, a count below it that many bytes that stand as they are, and a count of nothing is passed over.
 * The walk counts the bytes it reads, and its run is bounded by them rather than by the channel.
 */
export function unpackTmrHiroGrdRle(
	data: Buffer,
	offset: number,
	size: number,
	output: Buffer,
): void {
	const limit = Math.min(offset + size, data.length);
	let at = offset;
	let destination = 0;
	while (at < limit) {
		const count = data[at] ?? 0;
		at += 1;
		if (count > RLE_REPEAT) {
			const times = count & RLE_REPEAT;
			const value = data[at] ?? 0;
			at += 1;
			for (let drawn = 0; drawn < times; drawn += 1) {
				if (destination < output.length) output[destination] = value;
				destination += 1;
			}
		} else if (count > 0) {
			const available = Math.max(
				0,
				Math.min(count, limit - at, output.length - destination),
			);
			data.copy(output, destination, at, at + available);
			at += count;
			destination += available;
		}
	}
}

/**
 * `GrdReader.CreateHuffmanTree`: the channel names how long it unfolds to, how long it is stored, and how
 * often each of the two hundred and fifty six bytes stands. The tree is built by taking the two nodes of the
 * lowest count over and over, out of a list that keeps its own order among counts that stand equal.
 */
export function readTmrHiroGrdHuffmanTree(
	data: Buffer,
	offset: number,
): { nodes: HuffmanNode[]; unpackedSize: number; end: number } | undefined {
	const end = offset + HUFFMAN_HEADER_SIZE + HUFFMAN_LEAVES * 4;
	if (end > data.length) return undefined;
	const unpackedSize = data.readInt32LE(offset);
	const nodes: HuffmanNode[] = [];
	for (let index = 0; index < HUFFMAN_NODES; index += 1) {
		nodes.push({ frequency: 0, left: 0, right: 0 });
	}
	const order: number[] = [];
	for (let leaf = 0; leaf < HUFFMAN_LEAVES; leaf += 1) {
		const node = nodes[leaf];
		if (node)
			node.frequency = data.readUInt32LE(
				offset + HUFFMAN_HEADER_SIZE + leaf * 4,
			);
		// A node of a lower count stands before one of a higher, and equals keep the order they came in.
		let at = 0;
		while (
			at < order.length &&
			(nodes[order[at] ?? 0]?.frequency ?? 0) <= (nodes[leaf]?.frequency ?? 0)
		) {
			at += 1;
		}
		order.splice(at, 0, leaf);
	}
	let last = HUFFMAN_LEAVES;
	while (order.length > 1) {
		const left = order.shift() ?? 0;
		const right = order.shift() ?? 0;
		const node = nodes[last];
		if (!node) break;
		node.frequency =
			(nodes[left]?.frequency ?? 0) + (nodes[right]?.frequency ?? 0);
		node.left = left;
		node.right = right;
		let at = 0;
		while (
			at < order.length &&
			(nodes[order[at] ?? 0]?.frequency ?? 0) <= node.frequency
		) {
			at += 1;
		}
		order.splice(at, 0, last);
		last += 1;
	}
	return { nodes, unpackedSize, end };
}

/**
 * `GrdReader.UnpackHuffman`: the bits of a channel are read from the **lowest** of a byte up, a set bit taking
 * the right branch of a node and a clear one the left, until a node below the two hundred and fifty sixth
 * stands for a byte of its own.
 */
export function unpackTmrHiroGrdHuffman(
	data: Buffer,
	offset: number,
	output: Buffer,
): number {
	const tree = readTmrHiroGrdHuffmanTree(data, offset);
	if (!tree)
		throw invalidImage("The picture ends inside the tree of a channel");
	let at = tree.end;
	let bit = 0;
	let byte = 0;
	const nextBit = (): number | undefined => {
		if (0 === bit) {
			if (at >= data.length) return undefined;
			byte = data[at] ?? 0;
			at += 1;
			bit = 8;
		}
		const value = byte & 1;
		byte >>= 1;
		bit -= 1;
		return value;
	};
	let destination = 0;
	while (destination < tree.unpackedSize) {
		let node = HUFFMAN_ROOT;
		while (node > 0xff) {
			const step = nextBit();
			if (undefined === step) return destination;
			node =
				0 !== step
					? (tree.nodes[node]?.right ?? 0)
					: (tree.nodes[node]?.left ?? 0);
		}
		if (destination < output.length) output[destination] = node;
		destination += 1;
	}
	return destination;
}

/**
 * `GrdReader.UnpackLZ77`: the bytes a channel is packed with open with a word of their own, the ninth of
 * which is the byte the walk watches for. A byte of that value stands for a copy whose place and count follow
 * it - and a place that is that very value again stands for the byte itself - while every other byte stands as
 * it is. The copy is progressive, so a run that reaches into itself runs on.
 */
export function unpackTmrHiroGrdLz77(data: Buffer, output: Buffer): void {
	const special = data[LZ77_SPECIAL_FIELD] ?? 0;
	let at = LZ77_HEADER_SIZE;
	let destination = 0;
	while (destination < output.length) {
		if (at >= data.length) return;
		const value = data[at] ?? 0;
		at += 1;
		if (value !== special) {
			output[destination] = value;
			destination += 1;
			continue;
		}
		const place = data[at] ?? 0;
		at += 1;
		if (place === special) {
			output[destination] = place;
			destination += 1;
			continue;
		}
		const count = data[at] ?? 0;
		at += 1;
		const offset = place > special ? place - 1 : place;
		copyOverlapped(output, destination - offset, destination, count);
		destination += count;
	}
}

/**
 * `GrdReader.UnpackChannel`: one channel of the picture, at its own place in the file and of its own length.
 * The way the second byte of the head names is the only way it is packed: a run of its own, a tree of its own
 * whose bits stand behind another run, or a tree of its own behind a walk of its own.
 */
export function unpackTmrHiroGrdChannel(
	data: Buffer,
	layout: TmrHiroGrdLayout,
	offset: number,
	size: number,
	output: Buffer,
): void {
	if (PACK_RLE === layout.packType) {
		unpackTmrHiroGrdRle(data, offset, size, output);
		return;
	}
	// The bytes the tree unfolds to are held at the length the tree names for itself, which is the packed
	// stream the second walk reads - not the length of the channel they are drawn from.
	const tree = readTmrHiroGrdHuffmanTree(data, offset);
	if (!tree)
		throw invalidImage("The picture ends inside the tree of a channel");
	const packed = Buffer.alloc(tree.unpackedSize, 0x00);
	unpackTmrHiroGrdHuffman(data, offset, packed);
	if (PACK_HUFFMAN_LZ77 === layout.packType) {
		unpackTmrHiroGrdLz77(packed, output);
		return;
	}
	unpackTmrHiroGrdRle(packed, 0, packed.length, output);
}

/**
 * `GrdReader.Unpack`: the four channels of the picture stand one behind the other - its alpha first when it
 * carries one, then its red, its green and its blue - and every one of them fills its own byte of every
 * pixel. The rows of a channel are taken from its **last** one up into the rows of the picture, so what the
 * picture holds stands the other way round from the screen it was drawn on.
 */
export function unpackTmrHiroGrd(
	data: Buffer,
	layout: TmrHiroGrdLayout,
): Buffer {
	const pixelSize = layout.bitsPerPixel / 8;
	const output = Buffer.alloc(layout.width * layout.height * pixelSize, 0x00);
	const plane = layout.width * layout.height;
	const channel = Buffer.alloc(plane, 0x00);
	let at = HEAD_SIZE;
	const draw = (destination: number, size: number): void => {
		for (let filled = 0; filled < plane; filled += 1) channel[filled] = 0;
		unpackTmrHiroGrdChannel(data, layout, at, size, channel);
		let out = destination;
		for (let row = layout.height - 1; row >= 0; row -= 1) {
			let source = row * layout.width;
			for (let column = 0; column < layout.width; column += 1) {
				output[out] = channel[source] ?? 0;
				out += pixelSize;
				source += 1;
			}
		}
		at += size;
	};
	if (BITS_32 === layout.bitsPerPixel && layout.alphaSize > 0) {
		draw(3, layout.alphaSize);
	}
	draw(2, layout.redSize);
	draw(1, layout.greenSize);
	draw(0, layout.blueSize);
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const tmrHiroGrdImageDescriptor: FormatDescriptor = {
	id: "tmr-hiro-grd-image",
	name: "Tmr-Hiro ADV System image",
	extensions: ["grd", ""],
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
			source: "ArcFormats/Tmr-Hiro/ImageGRD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tmrHiroGrdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tmrHiroGrdImageDescriptor,
	// The picture writes no word of its own: the reference tells it by its head, whose four lengths have to
	// add up to the whole file.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readTmrHiroGrdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readTmrHiroGrdLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Tmr-Hiro ADV System picture");
		// The reference draws a picture of thirty two bits with an alpha channel as four bytes a pixel and one
		// without as four as well, the fourth of them left as it was.
		const drawn = BITS_24 === layout.bitsPerPixel ? BITS_24 : BITS_32;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: drawn,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The channels are drawn and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: drawn,
				packType: layout.packType,
				hasAlpha: layout.alphaSize > 0,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readTmrHiroGrdLayout(stored);
		if (!layout) throw invalidImage("Not a Tmr-Hiro ADV System picture");
		const pixels = unpackTmrHiroGrd(stored, layout);
		if (BITS_24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
