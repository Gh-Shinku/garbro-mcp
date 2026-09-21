// Format reference: GARBro "ArcFormats/Leaf/ImagePX.cs", classes `PxFormat` and `PxReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32, writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
} from "../shared/fixed-archive.js";

/** The head of the file, and of one block within it. */
const HEADER_SIZE = 0x20;
const BLOCK_HEADER_SIZE = 0x20;
/** The width of the block a packed block is built in, whatever its own width says. */
const MAX_BLOCK_SIZE = 1024;
/** A palette and a colour map both keep four bytes an entry. */
const COLOUR_ENTRY_SIZE = 4;
/** The ways the head of a picture names. */
const KIND_BLOCKS = 0x0c;
const KIND_STORED = 0x90;
const KIND_OFFSETS = 0x40;
const KIND_OFFSETS_OTHER = 0x44;
/** The four ways of the head that keep a picture in one piece. */
const WHOLE_KINDS = [1, 4, 7];
/** How deep a picture may be. */
const DEPTH_COLOURS = 32;
const GRAY_DEPTH = 8;
/** Where a stored picture of the second kind begins, and how long its own head is. */
const STORED_HEADER_SIZE = 0x20;
const STORED_START = 0x40;
/** The mark and the way the second head of the stored kind carries. */
const STORED_MARK = "Leaf";
const STORED_MARK_AT = 0x14;
const STORED_KIND = 0x0a;
/** The way a block names itself, and what it hands over. */
const BLOCK_WAY_PALETTE = 0;
const BLOCK_WAY_ONE = 1;
const BLOCK_WAY_RUNS = 4;
const BLOCK_WAY_COLOUR_MAP = 7;
/** The bits a block of the fourth way may be stored in. */
const BITS_8 = 8;
const BITS_9 = 9;
const BITS_20 = 0x20;
const BITS_30 = 0x30;
/** The bite a run of the fourth way reads its place, its length and its column from. */
const RUN_LENGTH_SHIFT = 9;
const RUN_TOGGLE = 0x180000;
const RUN_COLUMN_SHIFT = 21;
const RUN_PLACE_MASK = 0x1ff;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface LeafPxLayout {
	/** Which way the head of the picture keeps it. */
	kind: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	pixelSize: number;
	stride: number;
	frameCount: number;
	/** The size of a block, and how many stand across and down, for the first way only. */
	blockSize: number;
	blocksWidth: number;
	blocksHeight: number;
}

interface PxState {
	output: Buffer;
	stride: number;
	pixelSize: number;
	/** The size the head of the picture names, which a placed block is cut to. */
	width: number;
	height: number;
	/** The palette a block of the ninth way reads its colours from. */
	palette?: Buffer;
	/** The buffer a packed block is built in before it is placed. */
	block: Buffer;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
}

interface PxBlock {
	width: number;
	height: number;
	x: number;
	y: number;
	way: number;
	bits: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `PxFormat.ReadMetaData`: which way the head of a picture keeps it, and the picture's own size. */
export function readLeafPxLayout(data: Buffer): LeafPxLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const kind = data.readUInt16LE(0x10);
	let width = 0;
	let height = 0;
	let bitsPerPixel = 32;
	let frameCount = 1;
	let blockSize = 0;
	let blocksWidth = 0;
	let blocksHeight = 0;
	if (KIND_BLOCKS === kind) {
		// The head of this way keeps the picture in blocks of its own size, packed one after another.
		frameCount = data.readInt32LE(0);
		if (!isSaneCount(frameCount)) return undefined;
		blockSize = data.readInt32LE(4);
		if (blockSize <= 0) return undefined;
		bitsPerPixel = data.readUInt16LE(0x12);
		width = data.readUInt16LE(0x14);
		height = data.readUInt16LE(0x16);
		if (DEPTH_COLOURS !== bitsPerPixel || 0 === width || 0 === height) {
			return undefined;
		}
		blocksWidth = data.readUInt16LE(0x1c);
		blocksHeight = data.readUInt16LE(0x1e);
		if (0 === blocksWidth || 0 === blocksHeight) return undefined;
	} else if (KIND_STORED === kind) {
		// The head of this way keeps the picture whole, one frame after another behind a second head.
		if (data.length < 0x40) return undefined;
		if (
			data.toString("latin1", STORED_MARK_AT, STORED_MARK_AT + 4) !==
			STORED_MARK
		) {
			return undefined;
		}
		frameCount = data.readInt32LE(4);
		if (!isSaneCount(frameCount)) return undefined;
		if (data.readUInt16LE(0x30) !== STORED_KIND) return undefined;
		width = data.readUInt32LE(0x20);
		height = data.readUInt32LE(0x24);
		bitsPerPixel = data.readUInt16LE(0x32);
	} else if (KIND_OFFSETS === kind || KIND_OFFSETS_OTHER === kind) {
		// The head of this way names the place of every block, which are placed over one another.
		frameCount = data.readInt32LE(0);
		if (!isSaneCount(frameCount)) return undefined;
		width = data.readUInt32LE(0x14);
		height = data.readUInt32LE(0x18);
		bitsPerPixel = 32;
	} else if (WHOLE_KINDS.includes(kind)) {
		// The head of the remaining ways keeps one picture of its own, block by block.
		bitsPerPixel = data.readUInt16LE(0x12);
		if (DEPTH_COLOURS !== bitsPerPixel && GRAY_DEPTH !== bitsPerPixel) {
			return undefined;
		}
		width = data.readUInt32LE(0x14);
		height = data.readUInt32LE(0x18);
	} else {
		return undefined;
	}
	if (0 === width || 0 === height) return undefined;
	const pixelSize = bitsPerPixel >> 3;
	const stride = width * pixelSize;
	const total = stride * height;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		kind,
		width,
		height,
		bitsPerPixel,
		pixelSize,
		stride,
		frameCount,
		blockSize,
		blocksWidth,
		blocksHeight,
	};
}

/** `ImageFormat.ReadPalette` and `ReadColorMap`: four bytes an entry, blue first. */
function readColours(
	data: Buffer,
	at: number,
	count: number,
): Buffer | undefined {
	if (count < 0 || at + count * COLOUR_ENTRY_SIZE > data.length) {
		return undefined;
	}
	return Buffer.from(data.subarray(at, at + count * COLOUR_ENTRY_SIZE));
}

/** `PxReader.PutBlock`: a block built in the wide buffer is placed where its own head says. */
function putBlock(state: PxState, block: PxBlock): void {
	const left = Math.max(0, block.x);
	const top = Math.max(0, block.y);
	// The block is cut to the size the head of the picture names, not to the buffer it stands in: a
	// picture of the colour-map way keeps a buffer of its block's own size behind that head.
	const right = Math.min(block.x + block.width, state.width);
	const bottom = Math.min(block.y + block.height, state.height);
	const rowSize = (right - left) * 4;
	if (rowSize <= 0) return;
	let row = top * state.stride + left * 4;
	for (let y = top; y < bottom; y += 1) {
		const source = (left - block.x + (y - block.y) * MAX_BLOCK_SIZE) * 4;
		state.block.copy(state.output, row, source, source + rowSize);
		row += state.stride;
	}
}

/** `PxReader.UnpackBlock_1_8`: the picture stands as it is. */
function unpackBlock18(state: PxState, data: Buffer, at: number): void {
	const size = Math.min(state.output.length, data.length - at);
	if (size > 0) data.copy(state.output, 0, at, at + size);
}

/** `PxReader.UnpackBlock_1_20`: every pixel is handed over with the alpha the picture's own colour holds. */
function unpackBlock120(
	state: PxState,
	data: Buffer,
	at: number,
	block: PxBlock,
): void {
	let source = at;
	let dst = 0;
	for (let y = 0; y < block.height; y += 1) {
		for (let x = 0; x < block.width; x += 1) {
			if (source + 4 > data.length || dst + 4 > state.output.length) return;
			const alpha = data[source + 3] ?? 0;
			const red = data[source + 2] ?? 0;
			if (0 !== alpha) {
				state.output[dst + 3] = ((alpha << 1) | (red >> 7)) + 0xff;
			} else {
				state.output[dst + 3] = 0xff;
			}
			data.copy(state.output, dst, source, source + 3);
			source += 4;
			dst += 4;
		}
	}
}

/**
 * `PxReader.UnpackBlock_4_9`: a run of codes names a place in the wide block, how many pixels follow, and
 * whether the colours behind them carry an alpha of their own. The alpha of a colour comes from a byte of its
 * own, and the colour itself from the palette a block of the first way handed over.
 */
function unpackBlock49(
	state: PxState,
	data: Buffer,
	at: number,
	block: PxBlock,
	cursor: { at: number },
): void {
	const palette = state.palette;
	if (!palette) {
		throw invalid("A picture of the ninth way stands without a palette");
	}
	state.block.fill(0, 0, MAX_BLOCK_SIZE * block.height * 4);
	let dst = 0;
	let hasAlpha = true;
	cursor.at = at;
	for (;;) {
		if (cursor.at + 4 > data.length) {
			throw invalid("The picture's runs reach past the file");
		}
		const code = data.readInt32LE(cursor.at);
		cursor.at += 4;
		if (-1 === code) break;
		if (0 !== (code & RUN_TOGGLE)) hasAlpha = !hasAlpha;
		dst += (code & RUN_PLACE_MASK) * MAX_BLOCK_SIZE;
		dst += code >> RUN_COLUMN_SHIFT;
		const count = (code >> RUN_LENGTH_SHIFT) & 0x3ff;
		for (let index = 0; index < count; index += 1) {
			if (cursor.at + 2 > data.length) {
				throw invalid("The picture's runs reach past the file");
			}
			const alpha = hasAlpha
				? (((data[cursor.at] ?? 0) << 1) - 1) & 0xff
				: 0xff;
			const colourAt = (data[cursor.at + 1] ?? 0) * COLOUR_ENTRY_SIZE;
			cursor.at += 2;
			if (dst * 4 + 4 <= state.block.length) {
				const blue = palette[colourAt] ?? 0;
				const green = palette[colourAt + 1] ?? 0;
				const red = palette[colourAt + 2] ?? 0;
				state.block.writeUInt32LE(
					(blue | (green << 8) | (red << 16) | (alpha << 24)) >>> 0,
					dst * 4,
				);
			}
			dst += 1;
		}
	}
	putBlock(state, block);
}

/** The alpha every colour of the twentieth and thirtieth ways takes from its own byte. */
function runAlpha(colour: number): number {
	return ((((colour >>> 23) + 0xff) << 24) >>> 0) & 0xff000000;
}

/** `PxReader.UnpackBlock_4_20`: runs of whole colours, placed in the wide block. */
function unpackBlock420(
	state: PxState,
	data: Buffer,
	at: number,
	block: PxBlock,
	cursor: { at: number },
): void {
	state.block.fill(0, 0, MAX_BLOCK_SIZE * block.height * 4);
	let dst = 0;
	cursor.at = at;
	for (;;) {
		if (cursor.at + 4 > data.length) {
			throw invalid("The picture's runs reach past the file");
		}
		const next = data.readInt32LE(cursor.at);
		cursor.at += 4;
		if (-1 === next) break;
		if (next < 0 || next > 0xffffff) continue;
		dst += Math.trunc(next / 4);
		if (cursor.at + 8 > data.length) {
			throw invalid("The picture's runs reach past the file");
		}
		cursor.at += 4;
		const count = data.readInt32LE(cursor.at);
		cursor.at += 4;
		for (let index = 0; index < count; index += 1) {
			if (cursor.at + 4 > data.length) {
				throw invalid("The picture's runs reach past the file");
			}
			const colour = data.readUInt32LE(cursor.at);
			cursor.at += 4;
			if (dst * 4 + 4 <= state.block.length) {
				state.block.writeUInt32LE(
					0 !== (colour & 0xff000000)
						? ((colour & 0xffffff) | runAlpha(colour)) >>> 0
						: (colour | 0xff000000) >>> 0,
					dst * 4,
				);
			}
			dst += 1;
		}
	}
	putBlock(state, block);
}

/** `PxReader.UnpackBlock_4_30`: runs of colours that carry a word of their own, left nothing when clear. */
function unpackBlock430(
	state: PxState,
	data: Buffer,
	at: number,
	block: PxBlock,
	cursor: { at: number },
): void {
	state.block.fill(0, 0, MAX_BLOCK_SIZE * block.height * 4);
	let dst = 0;
	cursor.at = at;
	for (;;) {
		if (cursor.at + 4 > data.length) {
			throw invalid("The picture's runs reach past the file");
		}
		const next = data.readInt32LE(cursor.at);
		cursor.at += 4;
		if (-1 === next) break;
		if (0 !== (next & 0xff000000)) continue;
		dst += Math.trunc(next / 4);
		if (cursor.at + 8 > data.length) {
			throw invalid("The picture's runs reach past the file");
		}
		cursor.at += 4;
		const count = data.readInt32LE(cursor.at);
		cursor.at += 4;
		for (let index = 0; index < count; index += 1) {
			if (cursor.at + 6 > data.length) {
				throw invalid("The picture's runs reach past the file");
			}
			const colour = data.readUInt32LE(cursor.at);
			cursor.at += 6;
			if (dst * 4 + 4 <= state.block.length) {
				state.block.writeUInt32LE(
					0 !== (colour & 0xff000000)
						? ((colour & 0xffffff) | runAlpha(colour)) >>> 0
						: 0,
					dst * 4,
				);
			}
			dst += 1;
		}
	}
	putBlock(state, block);
}

/**
 * `PxReader.UnpackBlock_7`: the picture of this block stands alone - its own size, its own stride - and its
 * colours come from a map of their own rather than from a palette.
 */
function unpackBlock7(
	state: PxState,
	data: Buffer,
	at: number,
	block: PxBlock,
): PxState {
	const stride = 4 * block.width;
	const output = Buffer.alloc(stride * block.height, 0x00);
	const map = readColours(data, at, 0x100);
	if (!map) throw invalid("The picture's colour map reaches past the file");
	let source = at + 0x100 * COLOUR_ENTRY_SIZE;
	let dst = 0;
	for (let y = 0; y < block.height; y += 1) {
		for (let x = 0; x < block.width; x += 1) {
			if (source >= data.length || dst + 4 > output.length) return state;
			const entry = (data[source] ?? 0) * COLOUR_ENTRY_SIZE;
			source += 1;
			const blue = map[entry] ?? 0;
			const green = map[entry + 1] ?? 0;
			const red = map[entry + 2] ?? 0;
			const alpha = map[entry + 3] ?? 0;
			output[dst] = blue;
			output[dst + 1] = green;
			output[dst + 2] = red;
			output[dst + 3] =
				0 !== alpha ? (((alpha << 1) | (red >> 7)) + 0xff) & 0xff : 0xff;
			dst += 4;
		}
	}
	state.output = output;
	state.stride = stride;
	state.offsetX = block.x;
	state.offsetY = block.y;
	state.bitsPerPixel = 32;
	return state;
}

/** `PxReader.ReadBlock`: the head of a block, then the way it is packed. */
function readBlock(state: PxState, data: Buffer, offset: number): void {
	if (offset + BLOCK_HEADER_SIZE > data.length) {
		throw invalid("A block of the picture reaches past the file");
	}
	const block: PxBlock = {
		width: data.readInt32LE(offset),
		height: data.readInt32LE(offset + 4),
		x: data.readInt32LE(offset + 8),
		y: data.readInt32LE(offset + 0xc),
		way: data.readUInt16LE(offset + 0x10),
		bits: data.readUInt16LE(offset + 0x12),
	};
	if (block.width < 0 || block.height < 0) {
		throw invalid("A block of the picture names no size");
	}
	const at = offset + BLOCK_HEADER_SIZE;
	const cursor = { at };
	if (BLOCK_WAY_PALETTE === block.way) {
		// A block of this way hands over the palette the ninth way's runs read from.
		const palette = readColours(data, at, block.width);
		if (!palette) throw invalid("The picture's palette reaches past the file");
		state.palette = palette;
		return;
	}
	if (BLOCK_WAY_ONE === block.way) {
		if (BITS_8 === block.bits) {
			unpackBlock18(state, data, at);
			return;
		}
		if (BITS_20 === block.bits) {
			unpackBlock120(state, data, at, block);
			return;
		}
	} else if (BLOCK_WAY_RUNS === block.way) {
		if (BITS_8 === block.bits) {
			// The reference throws `NotImplementedException` for this way, so this port refuses it as well.
			throw unsupported(
				"A picture of the Leaf engine whose blocks stand in the eighth way is not ported",
			);
		}
		if (BITS_9 === block.bits) {
			unpackBlock49(state, data, at, block, cursor);
			return;
		}
		if (BITS_20 === block.bits) {
			unpackBlock420(state, data, at, block, cursor);
			return;
		}
		if (BITS_30 === block.bits) {
			unpackBlock430(state, data, at, block, cursor);
			return;
		}
	} else if (BLOCK_WAY_COLOUR_MAP === block.way) {
		unpackBlock7(state, data, at, block);
		return;
	}
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`The Leaf engine's block of way ${block.way} and ${block.bits} bits is not ported`,
	);
}

/** `PxReader.Unpack0C`: a table of block numbers, and the blocks themselves behind every frame's table. */
function unpack0C(
	state: PxState,
	data: Buffer,
	layout: LeafPxLayout,
	frame: number,
): void {
	const count = layout.blocksWidth * layout.blocksHeight;
	const tableAt = HEADER_SIZE + frame * count * 2;
	if (tableAt + count * 2 > data.length) {
		throw invalid("The picture's block table reaches past the file");
	}
	const dataAt = HEADER_SIZE + layout.frameCount * count * 2;
	const blockLength =
		2 + (layout.blockSize + 2) * (layout.blockSize + 2) * layout.pixelSize;
	let current = 0;
	let line = 0;
	for (let by = 0; by < layout.blocksHeight; by += 1) {
		for (let bx = 0; bx < layout.blocksWidth; bx += 1) {
			let dst = line + bx * layout.blockSize * layout.pixelSize;
			const number = data.readUInt16LE(tableAt + current * 2);
			current += 1;
			if (0 === number) continue;
			let at = dataAt + (number - 1) * blockLength;
			if (at + blockLength > data.length) {
				throw invalid("A block of the picture reaches past the file");
			}
			const blockWidth = (data[at] ?? 0) - 2;
			const blockHeight = (data[at + 1] ?? 0) - 2;
			at += 2;
			const lineLength = blockWidth * layout.pixelSize;
			for (let y = 0; y < blockHeight; y += 1) {
				if (at + lineLength > data.length) break;
				if (dst + lineLength <= state.output.length) {
					data.copy(state.output, dst, at, at + lineLength);
				}
				at += lineLength + 8;
				dst += state.stride;
			}
		}
		line += layout.blockSize * state.stride;
	}
}

/** `PxReader.Unpack`: which way the head of the picture keeps it. */
export function unpackPxPicture(
	data: Buffer,
	layout: LeafPxLayout,
	frame: number,
): PxState {
	if (frame < 0 || frame >= layout.frameCount) {
		throw invalid("The picture holds no such frame");
	}
	const state: PxState = {
		output: Buffer.alloc(layout.stride * layout.height, 0x00),
		stride: layout.stride,
		pixelSize: layout.pixelSize,
		width: layout.width,
		height: layout.height,
		block: Buffer.alloc(MAX_BLOCK_SIZE * MAX_BLOCK_SIZE * 4, 0x00),
		offsetX: 0,
		offsetY: 0,
		bitsPerPixel: layout.bitsPerPixel,
	};
	if (KIND_BLOCKS === layout.kind) {
		unpack0C(state, data, layout, frame);
	} else if (KIND_STORED === layout.kind) {
		const at =
			STORED_START + frame * (STORED_HEADER_SIZE + state.output.length);
		if (at + state.output.length > data.length) {
			throw invalid("The picture's frame reaches past the file");
		}
		data.copy(state.output, 0, at, at + state.output.length);
	} else if (
		KIND_OFFSETS === layout.kind ||
		KIND_OFFSETS_OTHER === layout.kind
	) {
		const tableAt = HEADER_SIZE;
		const base = HEADER_SIZE + layout.frameCount * 4;
		if (tableAt + layout.frameCount * 4 > data.length) {
			throw invalid("The picture's block table reaches past the file");
		}
		for (let index = 0; index < layout.frameCount; index += 1) {
			readBlock(state, data, base + data.readUInt32LE(tableAt + index * 4));
		}
	} else {
		readBlock(state, data, 0);
	}
	return state;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const leafPxImageDescriptor: FormatDescriptor = {
	id: "leaf-px-image",
	name: "Leaf image",
	extensions: ["px"],
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
			source: "ArcFormats/Leaf/ImagePX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafPxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafPxImageDescriptor,
	// The head of the engine writes no word of its own; the picture is told by its name and its fields.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath || !/\.px$/i.test(sourcePath)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readLeafPxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLeafPxLayout(await readStored(source));
		if (!layout) throw invalid("Not a Leaf engine picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entries: FixedEntry[] = [];
		for (let frame = 0; frame < layout.frameCount; frame += 1) {
			entries.push({
				...createFixedEntry({
					id: frame,
					path:
						1 === layout.frameCount
							? changeExtension(fileName, "bmp")
							: `${changeExtension(fileName, "bmp").replace(/\.bmp$/i, "")}_${frame}.bmp`,
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
						frame,
					},
				}),
				// A picture of the colour-map way is handed over at the size of its own block.
				sizeKnown: false,
			});
		}
		return {
			entries,
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				frameCount: layout.frameCount,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = await readStored(source);
		const layout = readLeafPxLayout(stored);
		if (!layout) throw invalid("Not a Leaf engine picture");
		const state = unpackPxPicture(stored, layout, Number(entry.id));
		const bottomUp = false;
		return Readable.from([
			8 === state.bitsPerPixel
				? writeBmp8(layout.width, layout.height, state.output, bottomUp)
				: writeBmp32(
						state.stride / 4,
						state.output.length / state.stride,
						state.output,
						bottomUp,
					),
		]);
	},
});
