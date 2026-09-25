// Format reference: GARBro "Legacy/Nekotaro/ImageNCG.cs", class `NcgFormat` with the `NcgReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head is four bytes of the picture's own units: where it stands, how wide and how tall. */
const HEAD_SIZE = 4;
/** The colour map: sixteen colours of three bytes each, keyed with the engine's own name. */
const PALETTE_KEY = Buffer.from("NEKOTARO", "latin1");
const PALETTE_COLOURS = 16;
const PALETTE_BYTES = PALETTE_COLOURS * 3;
const PALETTE_ENTRY_SIZE = 4;
/** A picture of this engine never reaches past the screen it was drawn for. */
const SCREEN_WIDTH = 640;
const SCREEN_HEIGHT = 400;
/** The units of the head, and the two grids the blocks of the picture are named in. */
const LEFT_UNIT = 8;
const TOP_UNIT = 2;
const WIDE_UNIT = 8;
const TALL_UNIT = 2;
const BLOCK_GRID = SCREEN_WIDTH / WIDE_UNIT;
const QUARTER_GRID = SCREEN_WIDTH / 4;
/** A block of the first part of the picture is eight pixels wide and two tall; of the second, four. */
const WIDE_BLOCK = 8;
const QUARTER_BLOCK = 4;
const BLOCK_ROWS = 2;
/** How the commands of the first part are told apart, and the two bytes that end a part. */
const COMMAND_SHIFT = 6;
const END_FIRST = 0xff;
const REPEAT_FIRST = 0x7f;
const END_SECOND = 0xfe;
const SINGLE_BLOCK = 0x80;
/** The depth the picture is told by, which is the number of colours its map holds. */
const BITS_PER_PIXEL = 4;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface NcgLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `NcgFormat.ReadMetaData`: every value of the head stands in its own unit - the place in eights and twos,
 * the size in eights and twos - and the picture has to fit the screen it was drawn for. The reference tells
 * this picture by a word of its own and by **nothing at all**, which is why its own list of words carries a
 * second, empty entry; this port asks for the shape of the head alone, as that empty entry does.
 */
export function readNcgLayout(data: Buffer): NcgLayout | undefined {
	if (data.length < HEAD_SIZE + PALETTE_BYTES) return undefined;
	const offsetX = (data[0] ?? 0) * LEFT_UNIT;
	const offsetY = (data[1] ?? 0) * TOP_UNIT;
	const width = (data[2] ?? 0) * WIDE_UNIT;
	const height = (data[3] ?? 0) * TALL_UNIT;
	if (0 === width || 0 === height) return undefined;
	if (offsetX + width > SCREEN_WIDTH || offsetY + height > SCREEN_HEIGHT) {
		return undefined;
	}
	// The reader walks the picture in blocks of four by two and of eight by two, so both sides of it have
	// to stand in whole ones.
	if (width % QUARTER_BLOCK !== 0 || height % BLOCK_ROWS !== 0)
		return undefined;
	if (width * height > LIMIT) return undefined;
	return { width, height, offsetX, offsetY };
}

/**
 * `NcgReader.ReadPalette`: sixteen colours of three bytes each, green first and blue last, every one of them
 * keyed with a byte of the engine's own name - the bytes of that name taken in the order blue, red, green -
 * and then spread from four bits over the whole byte.
 */
export function readNcgPalette(data: Buffer): Buffer {
	const palette = Buffer.alloc(PALETTE_COLOURS * PALETTE_ENTRY_SIZE, 0x00);
	let key = 0;
	for (let colour = 0; colour < PALETTE_COLOURS; colour += 1) {
		const at = HEAD_SIZE + colour * 3;
		let green = data[at] ?? 0;
		let red = data[at + 1] ?? 0;
		let blue = data[at + 2] ?? 0;
		blue = ((~blue & 0xff) - (PALETTE_KEY[key++ & 7] ?? 0)) & 0xff;
		red = ((~red & 0xff) - (PALETTE_KEY[key++ & 7] ?? 0)) & 0xff;
		green = ((~green & 0xff) - (PALETTE_KEY[key++ & 7] ?? 0)) & 0xff;
		palette[colour * PALETTE_ENTRY_SIZE] = (blue * 0x11) & 0xff;
		palette[colour * PALETTE_ENTRY_SIZE + 1] = (green * 0x11) & 0xff;
		palette[colour * PALETTE_ENTRY_SIZE + 2] = (red * 0x11) & 0xff;
	}
	return palette;
}

/** A reader over the picture's own bytes, whose every read is bounded by them. */
class NcgReader {
	constructor(
		private readonly data: Buffer,
		private at: number,
	) {}

	readUInt8(): number {
		if (this.at >= this.data.length) {
			throw invalidImage("The picture ends inside one of its parts");
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	/** A byte whose eight bits are read from its highest down, as the reference's own signed shift does. */
	readBitByte(): number[] {
		let signed = this.readUInt8();
		const bits: number[] = [];
		for (let index = 0; index < 8; index += 1) {
			bits.push(0 !== (signed & 0x80) ? 1 : 0);
			signed = (signed << 1) & 0xff;
		}
		return bits;
	}
}

/** `NcgReader.FillBits`: one of four bytes of a block's pattern, laid over what the ones before it set. */
function fillBits(reader: NcgReader, bits: Uint8Array, value: number): void {
	const read = reader.readBitByte();
	for (const [index, set] of read.entries()) {
		if (set) bits[index] = (bits[index] ?? 0) | value;
	}
}

/** Reads the pattern of a block: four bytes, each standing for one of the four bits of a pixel. */
function readPattern(reader: NcgReader, bits: Uint8Array): void {
	bits.fill(0);
	for (let shift = 0; shift < 4; shift += 1) {
		fillBits(reader, bits, 1 << shift);
	}
}

/** Writes one row of a block, which stands two rows tall. */
function drawBlock(
	pixels: Buffer,
	destination: number,
	width: number,
	top: Uint8Array,
	bottom: Uint8Array,
	columns: number,
): void {
	for (let column = 0; column < columns; column += 1) {
		if (
			destination + column >= pixels.length ||
			destination + width + column >= pixels.length
		) {
			throw invalidImage("A block of the picture reaches past it");
		}
		pixels[destination + column] = top[column] ?? 0;
		pixels[destination + width + column] = bottom[column] ?? 0;
	}
}

/**
 * `NcgReader.Unpack`: a picture of blocks, drawn in two parts. The first part places blocks of eight by two
 * pixels, the second blocks of four by two, and both tell their places in their own grid of the screen while
 * the pattern every block is drawn with is read in front of them. Every block that is drawn is marked, and a
 * third walk fills whatever was left unmarked with a pattern of its own, reading it as it goes.
 */
export function unpackNcg(data: Buffer, layout: NcgLayout): Buffer {
	const { width, height } = layout;
	const pixels = Buffer.alloc(width * height, 0x00);
	const quarterWide = width / QUARTER_BLOCK;
	const halfTall = height / BLOCK_ROWS;
	const mark = new Uint8Array(quarterWide * halfTall);
	const reader = new NcgReader(data, HEAD_SIZE + PALETTE_BYTES);
	const bits1 = new Uint8Array(8);
	const bits2 = new Uint8Array(8);
	let control = 0;
	// The first part: blocks of eight by two pixels, placed in their own grid of the screen.
	do {
		readPattern(reader, bits1);
		readPattern(reader, bits2);
		for (;;) {
			control = reader.readUInt8();
			if (END_FIRST === control || REPEAT_FIRST === control) break;
			const place = ((control & 0x3f) << 8) | reader.readUInt8();
			const x = (place % BLOCK_GRID) * WIDE_BLOCK;
			const y = Math.trunc(place / BLOCK_GRID) * BLOCK_ROWS;
			let destination = width * y + x;
			let block = x / QUARTER_BLOCK + quarterWide * (y / BLOCK_ROWS);
			switch (control >> COMMAND_SHIFT) {
				case 0: {
					const across = reader.readUInt8();
					const down = reader.readUInt8();
					const gap = quarterWide - 2 * across;
					for (let row = 0; row < down; row += 1) {
						for (let drawn = 0; drawn < across; drawn += 1) {
							drawBlock(pixels, destination, width, bits1, bits2, WIDE_BLOCK);
							destination += WIDE_BLOCK;
							mark[block] = 1;
							mark[block + 1] = 1;
							block += 2;
						}
						block += gap;
						destination += 2 * width - WIDE_BLOCK * across;
					}
					break;
				}
				case 1: {
					const count = reader.readUInt8();
					for (let drawn = 0; drawn < count; drawn += 1) {
						drawBlock(pixels, destination, width, bits1, bits2, WIDE_BLOCK);
						destination += WIDE_BLOCK;
						mark[block] = 1;
						mark[block + 1] = 1;
					}
					break;
				}
				case 2: {
					const count = reader.readUInt8();
					for (let drawn = 0; drawn < count; drawn += 1) {
						drawBlock(pixels, destination, width, bits1, bits2, WIDE_BLOCK);
						mark[block] = 1;
						mark[block + 1] = 1;
						destination += 2 * width - WIDE_BLOCK;
						block += quarterWide;
					}
					break;
				}
				default: {
					drawBlock(pixels, destination, width, bits1, bits2, WIDE_BLOCK);
					mark[block] = 1;
					mark[block + 1] = 1;
					break;
				}
			}
		}
	} while (END_FIRST !== control);
	// The second part: blocks of four by two pixels, in the finer grid of the screen.
	do {
		readPattern(reader, bits1);
		for (;;) {
			control = reader.readUInt8();
			if (END_FIRST === control || END_SECOND === control) break;
			const place = ((control & 0x7f) << 8) | reader.readUInt8();
			let destination =
				QUARTER_BLOCK * (place % QUARTER_GRID) +
				width * BLOCK_ROWS * Math.trunc(place / QUARTER_GRID);
			let block =
				(place % QUARTER_GRID) + quarterWide * Math.trunc(place / QUARTER_GRID);
			if (0 === (control & SINGLE_BLOCK)) {
				const count = reader.readUInt8();
				for (let drawn = 0; drawn < count; drawn += 1) {
					drawBlock(
						pixels,
						destination,
						width,
						bits1.subarray(0, 4),
						bits1.subarray(4),
						QUARTER_BLOCK,
					);
					mark[block] = 1;
					block += quarterWide;
					destination += BLOCK_ROWS * width - QUARTER_BLOCK;
				}
			} else {
				drawBlock(
					pixels,
					destination,
					width,
					bits1.subarray(0, 4),
					bits1.subarray(4),
					QUARTER_BLOCK,
				);
				mark[block] = 1;
			}
		}
	} while (END_FIRST !== control);
	// The third walk: every block no part of the picture drew is filled with a pattern read here.
	let destination = 0;
	let block = 0;
	for (let row = 0; row < halfTall; row += 1) {
		for (let column = 0; column < quarterWide; column += 1) {
			if (mark[block]) {
				block += 1;
				destination += QUARTER_BLOCK;
			} else {
				block += 1;
				readPattern(reader, bits1);
				drawBlock(
					pixels,
					destination,
					width,
					bits1.subarray(0, 4),
					bits1.subarray(4),
					QUARTER_BLOCK,
				);
				destination += QUARTER_BLOCK;
			}
		}
		destination += width * (BLOCK_ROWS - 1);
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ncgImageDescriptor: FormatDescriptor = {
	id: "nekotaro-ncg-image",
	name: "Nekotaro Game System image",
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
			source: "Legacy/Nekotaro/ImageNCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ncgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ncgImageDescriptor,
	// A picture of this engine writes no word of its own at all: the reference lists a signature of
	// **nothing** beside the word it sometimes carries, which makes every file a candidate that the shape of
	// the head then settles. This port keeps that, as the project's other signatureless formats do.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE + PALETTE_BYTES)) return false;
		return readNcgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readNcgLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Nekotaro Game System picture");
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
					bitsPerPixel: BITS_PER_PIXEL,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The blocks are drawn and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
				colours: PALETTE_COLOURS,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readNcgLayout(stored);
		if (!layout) throw invalidImage("Not a Nekotaro Game System picture");
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				unpackNcg(stored, layout),
				readNcgPalette(stored),
			),
		]);
	},
});
