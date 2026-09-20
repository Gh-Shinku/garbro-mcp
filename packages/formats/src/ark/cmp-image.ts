import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { RGB555_MASKS, writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The name the reference tells a picture of this engine by; it declares no word of its own. */
const EXTENSION = "cmp";
const HEADER_SIZE = 5;
/** The width and the height of the picture, and whether a third of the file stands for its shape. */
const WIDTH_FIELD = 0x00;
const HEIGHT_FIELD = 0x02;
const ALPHA_FLAG_FIELD = 0x04;
/** The width and the height of the shape, where the file carries one. */
const ALPHA_WIDTH_FIELD = 0x05;
const ALPHA_HEIGHT_FIELD = 0x07;
/** How many places the tree of codes knows, and the weights of them. */
const SYMBOLS = 32;
const LEAF_SYMBOL = 0xff;
/** The size of the walk of codes, which closes the head. */
const TABLE_SIZE = SYMBOLS * 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CmpLayout {
	width: number;
	height: number;
	hasAlpha: boolean;
	alphaWidth: number;
	alphaHeight: number;
	frequencies: Uint32Array;
	/** Where the walk of codes begins and how many bytes it stands in. */
	dataOffset: number;
	packedLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** A place of the tree of codes: a place of the walk, or a join of two places. */
interface CmpNode {
	symbol: number;
	frequency: number;
	left?: CmpNode;
	right?: CmpNode;
}

/**
 * `CmpFormat.ReadMetaData`: the width of the picture stands in the word at nought and its height in the word
 * behind it; where the byte at four stands, the words behind it are the width and the height of the shape of
 * the picture. Thirty two weights stand behind that — how often every place of the picture is walked — and the
 * size of the walk of codes closes the head. The walk of codes stands behind the head and reaches to the end
 * of the file.
 */
export function readCmpLayout(
	data: Buffer,
	fileLength = data.length,
): CmpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (width * height > LIMIT) return undefined;
	const hasAlpha = 0 !== (data[ALPHA_FLAG_FIELD] ?? 0);
	let position = HEADER_SIZE;
	let alphaWidth = 0;
	let alphaHeight = 0;
	if (hasAlpha) {
		if (data.length < HEADER_SIZE + 4) return undefined;
		alphaWidth = data.readUInt16LE(ALPHA_WIDTH_FIELD);
		alphaHeight = data.readUInt16LE(ALPHA_HEIGHT_FIELD);
		position += 4;
	}
	if (data.length < position + TABLE_SIZE + 4) return undefined;
	const frequencies = new Uint32Array(SYMBOLS);
	for (let index = 0; index < SYMBOLS; index += 1) {
		frequencies[index] = data.readUInt32LE(position + index * 4);
	}
	const packedLength = data.readInt32LE(position + TABLE_SIZE);
	const dataOffset = position + TABLE_SIZE + 4;
	if (packedLength < 0 || fileLength - dataOffset !== packedLength) {
		return undefined;
	}
	return {
		width,
		height,
		hasAlpha,
		alphaWidth,
		alphaHeight,
		frequencies,
		dataOffset,
		packedLength,
	};
}

export function buildCmpTree(frequencies: Uint32Array): CmpNode {
	const tree: CmpNode[] = [];
	for (let symbol = 0; symbol < SYMBOLS; symbol += 1) {
		tree.push({
			symbol,
			frequency: frequencies[symbol] ?? 0,
		});
	}
	for (let symbol = SYMBOLS; symbol < 255; symbol += 1) {
		tree.push({ symbol, frequency: 0 });
	}
	while (tree.length > 1) {
		const children: CmpNode[] = [];
		for (let index = 0; index < 2; index += 1) {
			let last: CmpNode | undefined;
			let least = 0xffffffff;
			for (const node of tree) {
				if (node.frequency <= least) {
					least = node.frequency;
					last = node;
				}
			}
			if (!last) throw invalidPicture("Ark picture has no tree of codes");
			children.push(last);
			tree.splice(tree.indexOf(last), 1);
		}
		const left = children[0];
		const right = children[1];
		if (!left || !right)
			throw invalidPicture("Ark picture has no tree of codes");
		tree.push({
			symbol: LEAF_SYMBOL,
			frequency: (left.frequency + right.frequency) >>> 0,
			left,
			right,
		});
	}
	const root = tree[0];
	if (!root) throw invalidPicture("Ark picture has no tree of codes");
	return root;
}

/**
 * `CmpReader.UnpackHuffman`: a place of the picture is walked out of the tree of codes, a place to the left
 * for a place of the walk that stands and a place to the right for one that does not, and what the tree gives
 * is not the place itself but how far it stands behind the place before it, the places running all the way
 * round from the last of them to the first.
 */
function unpackCmpPlanes(
	reader: MsbBitReader,
	root: CmpNode,
	output: Uint8Array,
): void {
	let at = 0;
	let previous = 0;
	while (at < output.length) {
		let node = root;
		while (node.symbol > 0x1f) {
			if (!node.left || !node.right) {
				throw invalidPicture("Ark picture walks out of its tree of codes");
			}
			node = reader.readBits(1) !== 0 ? node.left : node.right;
		}
		let symbol = (previous + node.symbol) & 0xff;
		if (symbol > 0x1f) symbol -= 0x20;
		output[at] = symbol;
		at += 1;
		previous = symbol;
	}
}

export function decodeCmp(data: Buffer, layout: CmpLayout): Buffer {
	const planeSize = layout.width * layout.height;
	const planes = new Uint8Array(planeSize * 3);
	const reader = new MsbBitReader(data, layout.dataOffset);
	unpackCmpPlanes(reader, buildCmpTree(layout.frequencies), planes);
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 2, 0x00);
	let red = 0;
	let green = planeSize;
	let blue = planeSize * 2;
	let row = output.length - layout.width * 2;
	while (row >= 0) {
		let at = row;
		for (let x = layout.width; x > 0; x -= 1) {
			const colour =
				((planes[blue] ?? 0) << 10) |
				((planes[green] ?? 0) << 5) |
				(planes[red] ?? 0);
			output.writeUInt16LE(colour & 0xffff, at);
			at += 2;
			blue += 1;
			green += 1;
			red += 1;
		}
		row -= layout.width * 2;
	}
	return writeBmp16(layout.width, layout.height, output, true, RGB555_MASKS);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The reference tells a picture of this engine by the name of the file, which has to be `cmp`. */
function hasCmpName(sourcePath: string | undefined): boolean {
	if (!sourcePath) return false;
	return sourcePath.toLowerCase().endsWith(`.${EXTENSION}`);
}

export const arkCmpImageDescriptor: FormatDescriptor = {
	id: "ark-cmp-image",
	name: "Ark image format",
	extensions: [EXTENSION],
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
			source: "Legacy/Ark/ImageCMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const arkCmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: arkCmpImageDescriptor,
	// The reference registers no word at all and reads a picture of this engine only by the name of the file.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!hasCmpName(sourcePath)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const wanted = Number(
				source.size < BigInt(0x1000) ? source.size : BigInt(0x1000),
			);
			const header = Buffer.from(await source.readAt(0n, wanted));
			return readCmpLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCmpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Ark picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 16,
					hasAlpha: layout.hasAlpha,
				},
			}),
			// The planes are walked out and gathered into a bitmap of sixteen bits.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 16 },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCmpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Ark picture");
		return Readable.from([decodeCmp(stored, layout)]);
	},
});
