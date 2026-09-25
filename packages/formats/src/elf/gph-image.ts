// Port of GARbro "ArcFormats/elf/ImageGPH.cs" (tag "GPH", class `GphFormat`, reader `GphReader`), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is four bits a place. A frame carries two Huffman trees in front of the places
// they code - one of the tokens (a place of its own, or a run whose count stands in the token) and one of
// the places of the window a run reaches back to - and the places themselves stand in a window of 0x1400
// bytes. The trees are read with the reader of the reference: a window of sixteen bits that takes a byte at
// a time, most significant bit first, with a node per bit (a set bit an inner node of two children, a clear
// one a leaf whose value is the next nine bits for a token and the next eight for an offset). Every count
// and every index below is the reference's own arithmetic; the walk was checked against a transcription of
// the same reader over a fixture built the way the format reads it.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp4 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `GphFormat.Signature`: the letters `GPH` and the byte 0x1D. */
export const GPH_MARK: readonly number[] = [0x47, 0x50, 0x48, 0x1d];
const MARK = Buffer.from(GPH_MARK as number[]);
const MARK_SIZE = MARK.length;
const HEAD_SIZE = 0x0a;
const COUNT_AT = 4;
const FRAME_AT = 6;
/** A frame: the count of its places, the flags, and then its own palette and the box of the picture. */
const FRAME_FLAGS_AT = 4;
const FRAME_BOX_AT = 6;
const FLAG_OWN_PALETTE = 4;
const PALETTE_PLACES = 0x20;
const PALETTE_COLORS = 0x10;
/** The places the reader skips between the box of a frame and its trees. */
const READER_SKIP = 8;
/** The box of a picture: four words, the right and the bottom one above the left and the top. */
const BOX_SIZE = 8;
const BOX_WIDTH = 2;
const COLOR_PLACES = 0x3c;
const COLOR_MAX = 0xff;
/** The window the places of a picture stand in, and the two trees of its walk. */
const WINDOW_SIZE = 0x1400;
const TABLE_SIZE = 0x100;
const TABLE_SMALL = 0x10;
const LENGTH_TABLE_SIZE = 0x200;
const OFFSET_TABLE_AT = 0x100;
const TOKEN_ROOT = 0x200;
const OFFSET_ROOT = 0x100;
const TOKEN_MASK = 0x3ff;
const OFFSET_MASK = 0x1ff;
const NODE_TABLE_SIZE = 0x600;
const OFFSET_NODES_AT = 0x400;
const TOKEN_LEAF_MASK = 0x1ff;
const OFFSET_LEAF_MASK = 0xff;
const TOKEN_LITERAL = 0x100;
const TOKEN_COUNT_BASE = 3;
const TOKEN_COUNT_MASK = 0xff;
const STEP_LIMIT = 8;
const WINDOW_BITS = 9;
const BYTE_BITS = 8;
const HIGH_BYTE = 0xff00;
const INNER_BIT = 0x10000;
const OFFSET_LEAF_SHIFT = 1;

/** The sixteen colours of the engine, for a frame that carries none of its own. */
const DEFAULT_PALETTE: readonly (readonly [number, number, number])[] = [
	[0x00, 0x00, 0x00],
	[0x00, 0x00, 0xaa],
	[0x00, 0xaa, 0x00],
	[0x00, 0xaa, 0xaa],
	[0xaa, 0x00, 0x00],
	[0xaa, 0x00, 0xaa],
	[0xaa, 0xaa, 0x00],
	[0xaa, 0xaa, 0xaa],
	[0x88, 0x88, 0x88],
	[0x00, 0x00, 0xff],
	[0x00, 0xff, 0x00],
	[0x00, 0xff, 0xff],
	[0xff, 0x00, 0x00],
	[0xff, 0x00, 0xff],
	[0xff, 0xff, 0x00],
	[0xff, 0xff, 0xff],
];

export interface GphLayout {
	/** The count of the frames of the file; the reference reads the first of them alone. */
	frameCount: number;
	frameOffset: number;
	frameLength: number;
	flags: number;
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	/** `GphMetaData.DataOffset`; the flags of the frame stand two places above it. */
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `GphFormat.ReadMetaData`. */
export function readGphLayout(data: Buffer): GphLayout | undefined {
	if (data.length < HEAD_SIZE || !data.subarray(0, MARK_SIZE).equals(MARK)) {
		return undefined;
	}
	const frameCount = data.readUInt16LE(COUNT_AT);
	const frameOffset = data.readInt32LE(FRAME_AT);
	if (0 === frameCount || frameOffset < 0 || frameOffset > data.length) {
		return undefined;
	}
	const dataOffset = frameOffset;
	if (dataOffset + FRAME_BOX_AT + BOX_SIZE > data.length) return undefined;
	const frameLength = data.readInt32LE(dataOffset);
	const flags = data.readUInt16LE(dataOffset + FRAME_FLAGS_AT);
	const boxAt =
		dataOffset +
		FRAME_BOX_AT +
		(0 === (flags & FLAG_OWN_PALETTE) ? PALETTE_PLACES : 0);
	if (boxAt + BOX_SIZE > data.length) return undefined;
	const left = data.readInt16LE(boxAt) * BOX_WIDTH;
	const top = data.readInt16LE(boxAt + 2);
	const right = (data.readInt16LE(boxAt + 4) + 1) * BOX_WIDTH;
	const bottom = data.readInt16LE(boxAt + 6) + 1;
	const width = right - left;
	const height = bottom - top;
	// The reference builds its output out of the stride and the height as they stand, so a frame that
	// declares no places of a picture is a broken one here rather than a picture of no places.
	if (width <= 0 || height <= 0) return undefined;
	return {
		frameCount,
		frameOffset,
		frameLength,
		flags,
		offsetX: left,
		offsetY: top,
		width,
		height,
		dataOffset,
	};
}

/** `GphReader.ReadPalette` and `GphReader.SetDefaultPalette`: sixteen colours, red then green then blue. */
export function gphPalette(data: Buffer, layout: GphLayout): Buffer {
	const palette = Buffer.alloc(PALETTE_COLORS * 3, 0);
	if (0 !== (layout.flags & FLAG_OWN_PALETTE)) {
		for (let i = 0; i < PALETTE_COLORS; i += 1) {
			const colour = DEFAULT_PALETTE[i] ?? [0, 0, 0];
			palette[i * 3] = colour[0];
			palette[i * 3 + 1] = colour[1];
			palette[i * 3 + 2] = colour[2];
		}
		return palette;
	}
	// `GphReader.Unpack` starts at `DataOffset + 2`, the place the flags of the frame end at.
	let at = layout.dataOffset + FRAME_BOX_AT;
	for (let i = 0; i < PALETTE_COLORS; i += 1) {
		const first = data[at++] ?? 0;
		const red = (first >> 2) & COLOR_PLACES;
		const blue = (first << 2) & COLOR_PLACES;
		const second = data[at++] ?? 0;
		const green = (second << 2) & COLOR_PLACES;
		palette[i * 3] = clampGphColour(red);
		palette[i * 3 + 1] = clampGphColour(green);
		palette[i * 3 + 2] = clampGphColour(blue);
	}
	return palette;
}

/** `GphReader.Clamp`: a colour of six places turned into a place of eight. */
function clampGphColour(colour: number): number {
	return Math.floor((colour * COLOR_MAX) / COLOR_PLACES) & 0xff;
}

/**
 * The reader of the reference: a window of sixteen bits that takes a byte at a time, most significant bit
 * first. `bits` holds what it has read and `count` the number of places that stand valid at the top of it.
 */
class GphBitsReader {
	bits = 0;
	count = 0;
	at: number;
	/** `GphReader.NodeTable`: the token nodes from 0 and the offset nodes from 0x400. */
	readonly nodes = new Int16Array(NODE_TABLE_SIZE);
	readonly lengths = new Uint8Array(LENGTH_TABLE_SIZE);
	readonly tokens = new Int16Array(LENGTH_TABLE_SIZE);
	nextNode = 0;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	/** `GphReader.ReadNext`. */
	refill(): void {
		this.bits &= HIGH_BYTE;
		if (this.at < this.data.length) this.bits |= this.data[this.at] ?? 0;
		this.at += 1;
	}

	/** The `bits = input.ReadUInt16(); bits = bits >> 8 | bits << 8;` in front of a walk. */
	start(): void {
		const word =
			this.at + 2 <= this.data.length ? this.data.readUInt16LE(this.at) : 0;
		this.bits = ((word >> 8) | (word << 8)) & 0xffff;
		this.at += 2;
		this.count = WINDOW_BITS;
	}

	/** `--bit_count; if (0 == bit_count) { bit_count = 8; ReadNext(); }`. */
	step(): void {
		this.count -= 1;
		if (0 === this.count) {
			this.count = BYTE_BITS;
			this.refill();
		}
	}

	/** `bits <<= 1; if (0 != (bits & 0x10000))`: the one bit a step of a tree stands on. */
	flag(): boolean {
		this.bits <<= 1;
		return 0 !== (this.bits & INNER_BIT);
	}

	/** The closing of a leaf: `bits <<= bit_count - shift; ReadNext(); bits <<= 9 - bit_count;`. */
	skipLeaf(shift: number): void {
		this.bits <<= this.count - shift;
		this.refill();
		this.bits <<= WINDOW_BITS - this.count;
	}

	/** `GphReader.CreateTokenNode` and `GphReader.CreateOffsetNode`, one node of a tree. */
	createNode(offset: boolean): number {
		this.step();
		if (this.flag()) {
			const node = this.nextNode;
			this.nextNode += 1;
			const index = (node << 1) + (offset ? OFFSET_NODES_AT : 0);
			this.nodes[index] = this.createNode(offset);
			this.nodes[index + 1] = this.createNode(offset);
			return node + (offset ? OFFSET_ROOT : TOKEN_ROOT);
		}
		// The token leaf takes one more bit of the window for its own; the offset leaf does not,
		// which is the one place the two trees of the reference part.
		if (offset) {
			const value = (this.bits >> BYTE_BITS) & OFFSET_LEAF_MASK;
			this.skipLeaf(OFFSET_LEAF_SHIFT);
			return value;
		}
		this.step();
		const value = (this.bits >> 7) & TOKEN_LEAF_MASK;
		this.skipLeaf(0);
		return value;
	}

	/** `GphReader.ProcessTokenNode` and `GphReader.ProcessOffsetNode`, the codes of a tree. */
	processNode(offset: boolean, index: number, root: number): void {
		let x = index;
		let node = root;
		let length = 0;
		do {
			length += 1;
			node =
				((node << 1) | ((x >> 7) & 1)) & (offset ? OFFSET_MASK : TOKEN_MASK);
			node = this.nodes[offset ? node + OFFSET_NODES_AT : node] ?? 0;
			if (node < (offset ? OFFSET_ROOT : TOKEN_ROOT)) break;
			x = (x << 1) & 0xff;
		} while (length < STEP_LIMIT);
		const at = index + (offset ? OFFSET_TABLE_AT : 0);
		this.lengths[at] = length;
		this.tokens[at] = node;
	}

	/** `GphReader.GetToken` and `GphReader.GetOffset`, one token of a walk. */
	take(offset: boolean): number {
		const table = offset ? OFFSET_TABLE_AT : 0;
		let token = (this.bits >> BYTE_BITS) & 0xff;
		let length = this.lengths[token + table] ?? 0;
		token = this.tokens[token + table] ?? 0;
		if (length >= this.count) {
			this.count -= 1;
			this.bits <<= this.count;
			length -= this.count;
			this.count = WINDOW_BITS;
			this.refill();
		}
		this.bits <<= length;
		this.count -= length;
		const root = offset ? OFFSET_ROOT : TOKEN_ROOT;
		while (token >= root) {
			this.count -= 1;
			if (0 === this.count) {
				this.count = BYTE_BITS;
				this.refill();
			}
			token = (token << 1) | ((this.bits >> 15) & 1);
			this.bits <<= 1;
			token &= offset ? OFFSET_MASK : TOKEN_MASK;
			token = this.nodes[offset ? token + OFFSET_NODES_AT : token] ?? 0;
		}
		return token;
	}
}

/** `GphReader.Unpack`: the places of a picture out of the two walks of its frame. */
export function unpackGphPicture(data: Buffer, layout: GphLayout): Buffer {
	const stride = layout.width >> 1;
	const output = Buffer.alloc(stride * layout.height, 0);
	if (0 === stride || 0 === layout.height) return output;
	const reader = new GphBitsReader(data, layout.dataOffset + FRAME_BOX_AT);
	if (0 === (layout.flags & FLAG_OWN_PALETTE)) {
		reader.at += PALETTE_PLACES;
	}
	reader.at += READER_SKIP;
	reader.start();

	reader.nextNode = 0;
	const tokenRoot = reader.createNode(false);
	for (let i = 0; i < TABLE_SIZE; i += 1) {
		reader.processNode(false, i, tokenRoot);
	}
	reader.nextNode = 0;
	const offsetRoot = reader.createNode(true);
	for (let i = 0; i < TABLE_SIZE; i += 1) {
		reader.processNode(true, i, offsetRoot);
	}

	/** `GphReader.OffsetTable`: where a place of the window stands for every code of it. */
	const offsetTable = new Uint16Array(TABLE_SIZE);
	if (stride <= TABLE_SMALL) {
		for (let i = 0; i < TABLE_SIZE; i += 1) offsetTable[i] = i + 1;
	} else {
		for (let i = 0; i < TABLE_SIZE; i += 1) {
			let x = i >> 4;
			if (0 !== (i & 8)) {
				x += 1;
				x *= stride;
				x += i & 0x0f;
				x -= 0x0f;
			} else {
				x *= stride;
				x += i & 0x0f;
				x += 1;
			}
			offsetTable[i] = x & 0xffff;
		}
	}

	const window = Buffer.alloc(WINDOW_SIZE, 0);
	let dst = 0;
	let out = 0;
	let total = stride * layout.height;
	/** `GphReader.CopyPixels`: the four bits of a place of the window in their own order. */
	const flush = (count: number): void => {
		let from = 0;
		for (let i = 0; i < count; i += 1) {
			const value = window[from++] ?? 0;
			let place = (value & 0x80) | ((value & 0x20) << 1);
			place |= ((value & 0x08) << 2) | ((value & 0x02) << 3);
			place |= (value & 0x01) | ((value & 0x04) >> 1);
			place |= ((value & 0x10) >> 2) | ((value & 0x40) >> 3);
			output[out++] = place & 0xff;
		}
	};
	while (total > 0) {
		const token = reader.take(false);
		if (token < TOKEN_LITERAL) {
			window[dst++] = token & 0xff;
			if (dst >= WINDOW_SIZE) {
				flush(WINDOW_SIZE);
				dst = 0;
			}
			total -= 1;
			continue;
		}
		const count = (token & TOKEN_COUNT_MASK) + TOKEN_COUNT_BASE;
		const offset = reader.take(true);
		let from = dst - (offsetTable[offset] ?? 0);
		if (from < 0) from += WINDOW_SIZE;
		for (let i = 0; i < count; i += 1) {
			window[dst++] = window[from++] ?? 0;
			if (from >= WINDOW_SIZE) from = 0;
			if (dst >= WINDOW_SIZE) {
				flush(WINDOW_SIZE);
				dst = 0;
			}
		}
		total -= count;
	}
	if (0 !== dst) flush(dst);
	return output;
}

export const elfGphImageDescriptor: FormatDescriptor = {
	id: "elf-gph-image",
	name: "Elf GPH image",
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
			source: "ArcFormats/elf/ImageGPH.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const elfGphImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: elfGphImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readGphLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGphLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the elf engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGphLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the elf engine");
		const pixels = unpackGphPicture(data, layout);
		const palette = gphPalette(data, layout);
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
