// Format reference: GARBro "ArcFormats/Key/ImageCZ.cs", class `CzFormat` with the `CzDecoder` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two letters every picture of this engine opens with. */
const WORD = Buffer.from("CZ", "latin1");
/** The three words the reference **lists** for detection; its reader knows the second version as well. */
const SIGNATURES = [
	Buffer.from("CZ0", "latin1"),
	Buffer.from("CZ1", "latin1"),
	Buffer.from("CZ3", "latin1"),
];
/** The version byte stands at 2 of the word, and the head holds where it ends, the size and the depth. */
const VERSION_FIELD = 2;
const HEADER_LENGTH_FIELD = 4;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0x0a;
const BITS_FIELD = 0x0c;
const PLAIN_HEADER_SIZE = 0x10;
/** Behind a longer head the picture also names where it stands on a larger canvas. */
const WIDE_HEADER_SIZE = 0x18;
const OFFSET_X_FIELD = 0x10;
const OFFSET_Y_FIELD = 0x12;
/** The depths the reference draws: eight bits through a colour map, thirty two as four bytes a pixel. */
const BITS_8 = 8;
const BITS_32 = 32;
const PALETTE_COLOURS = 0x100;
const PALETTE_ENTRY_SIZE = 4;
/** The part table: how many parts, and for each of them its stored length in pixels and the length it unfolds to. */
const PART_TABLE_ENTRY_SIZE = 8;
const PART_COUNT_LIMIT = 0x10000;
/** The word of a part that stands behind a copy is counted from 0x101, in whole pixels. */
const COPY_BIAS = 0x101;
const PAIR_SIZE = 2;
const LITERAL_CONTROL = 0;
/** A picture this project is willing to hold, and how deep the chains of the copies may run. */
const LIMIT = 256 * 1024 * 1024;
const DEPTH_LIMIT = 32;

export interface CzLayout {
	version: number;
	headerLength: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `CzFormat.ReadMetaData`: the word names the version as its own third character, the head holds where it
 * ends, the size and the depth, and a head longer than twenty four bytes also names where the picture stands
 * on a larger canvas.
 */
export function readCzLayout(data: Buffer): CzLayout | undefined {
	if (data.length < PLAIN_HEADER_SIZE) return undefined;
	// The reference tells the version by the **character** alone - its own list of words leaves the second
	// one out, even though its reader knows it - so the two letters are all this asks for.
	if (!data.subarray(0, 2).equals(WORD)) return undefined;
	const digit = (data[VERSION_FIELD] ?? 0) - 0x30;
	if (digit < 0 || digit > 3) return undefined;
	const headerLength = data.readUInt32LE(HEADER_LENGTH_FIELD);
	if (headerLength < PLAIN_HEADER_SIZE || headerLength > data.length) {
		return undefined;
	}
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	const wide = headerLength > WIDE_HEADER_SIZE;
	if (wide && data.length < WIDE_HEADER_SIZE) return undefined;
	return {
		version: digit,
		headerLength,
		width,
		height,
		bitsPerPixel,
		offsetX: wide ? data.readInt16LE(OFFSET_X_FIELD) : 0,
		offsetY: wide ? data.readInt16LE(OFFSET_Y_FIELD) : 0,
	};
}

/** Whether a run of two pairs stands inside a part, which every copy of one has to. */
function insidePart(part: Buffer, at: number): boolean {
	return at >= 0 && at + 4 <= part.length;
}

/** The place a pair of bytes of a part names, which is counted from 0x101 in whole pixels. */
function copyOffset(part: Buffer, at: number): number {
	if (at < 0 || at + PAIR_SIZE > part.length) {
		throw invalidImage("A copy of the picture names a place outside its part");
	}
	const word = ((part[at] ?? 0) | ((part[at + 1] ?? 0) << 8)) - COPY_BIAS;
	return word * PAIR_SIZE;
}

/**
 * `CzDecoder.CopyOne`: a byte named by a pair of a part, which may stand for a byte of the part itself or
 * lead to another pair in turn. The reference follows that chain without a bound; this port stops a chain
 * that runs too deep or turns on itself.
 */
function copyOne(
	part: Buffer,
	at: number,
	own: number,
	depth: number,
	seen: Set<number>,
): number {
	if (at < 0 || at + PAIR_SIZE > part.length) {
		throw invalidImage("A copy of the picture names a place outside its part");
	}
	if (depth > DEPTH_LIMIT || seen.has(at)) {
		throw invalidImage("A chain of copies of the picture turns on itself");
	}
	seen.add(at);
	if ((part[at + 1] ?? 0) === LITERAL_CONTROL) return part[at] ?? 0;
	const place = copyOffset(part, at);
	if (place === at) return 0;
	return copyOne(part, place, own, depth + 1, seen);
}

/**
 * `CzDecoder.CopyRange`: two pairs of a part stand behind one copy - the first drawn into the picture, the
 * second either a byte of the part, a byte of the picture the copy has just written, or a chain followed to
 * its end. What a copy drew is remembered by the place of the pair that named it, so a part that names the
 * same copy twice draws it once.
 */
function copyRange(
	part: Buffer,
	at: number,
	destination: number,
	output: Buffer,
	cache: Map<number, { start: number; length: number }>,
	depth: number,
): number {
	// A pair that stands outside the part names nothing to draw, which the reference would read past.
	if (!insidePart(part, at)) {
		throw invalidImage("A copy of the picture names a place outside its part");
	}
	const remembered = cache.get(at);
	if (remembered) {
		copyOverlapped(output, remembered.start, destination, remembered.length);
		return remembered.length;
	}
	const start = destination;
	let cursor = destination;
	const drawByte = (value: number): void => {
		if (cursor < 0 || cursor >= output.length) {
			throw invalidImage("A copy of the picture reaches past it");
		}
		output[cursor] = value;
		cursor += 1;
	};
	if ((part[at + 1] ?? 0) === LITERAL_CONTROL) {
		drawByte(part[at] ?? 0);
	} else {
		const place = copyOffset(part, at);
		if (place === at) {
			drawByte(0);
		} else {
			cursor += copyRange(part, place, cursor, output, cache, depth + 1);
		}
	}
	if ((part[at + 3] ?? 0) === LITERAL_CONTROL) {
		drawByte(part[at + 2] ?? 0);
	} else if (copyOffset(part, at + PAIR_SIZE) === at) {
		drawByte(output[start] ?? 0);
	} else {
		drawByte(
			copyOne(part, copyOffset(part, at + PAIR_SIZE), start, 0, new Set()),
		);
	}
	if (depth > DEPTH_LIMIT) {
		throw invalidImage("A chain of copies of the picture runs too deep");
	}
	cache.set(at, { start, length: cursor - start });
	return cursor - start;
}

/**
 * `CzDecoder.UnpackCz1`: the picture stands in parts, each with its stored length - twice over - and the
 * length it unfolds to. A part is a line of pairs: a pair whose second byte is nothing stands for the byte
 * that comes first, and any other pair stands behind a copy. What a part leaves in the picture is what the
 * parts behind it copy from, since the copies are counted from the place the picture has reached.
 */
function unpackParts(data: Buffer, layout: CzLayout, output: Buffer): void {
	const start = layout.headerLength;
	if (start + 4 > data.length)
		throw invalidImage("The picture ends before its parts");
	const count = data.readInt32LE(start);
	if (count <= 0 || count > PART_COUNT_LIMIT) {
		throw invalidImage("The picture names no part or too many");
	}
	if (start + 4 + count * PART_TABLE_ENTRY_SIZE > data.length) {
		throw invalidImage("The part table of the picture reaches past it");
	}
	const sizes: number[] = [];
	let total = 0;
	let at = start + 4;
	for (let part = 0; part < count; part += 1) {
		const stored = data.readInt32LE(at) * PAIR_SIZE;
		if (stored < 0) throw invalidImage("A part of the picture has no length");
		sizes.push(stored);
		total += stored;
		// The length the part unfolds to stands behind its stored length and is not looked at.
		at += PART_TABLE_ENTRY_SIZE;
	}
	const partsAt = start + 4 + count * PART_TABLE_ENTRY_SIZE;
	if (partsAt + total > data.length) {
		throw invalidImage("The parts of the picture reach past it");
	}
	let cursor = partsAt;
	let destination = 0;
	for (const size of sizes) {
		const part = data.subarray(cursor, cursor + size);
		cursor += size;
		const cache = new Map<number, { start: number; length: number }>();
		for (let pair = 0; pair + PAIR_SIZE <= part.length; pair += PAIR_SIZE) {
			if ((part[pair + 1] ?? 0) === LITERAL_CONTROL) {
				if (destination >= output.length) {
					throw invalidImage("The picture reaches past its own size");
				}
				output[destination] = part[pair] ?? 0;
				destination += 1;
			} else {
				destination += copyRange(
					part,
					copyOffset(part, pair),
					destination,
					output,
					cache,
					0,
				);
			}
		}
	}
}

/** `CzDecoder.UnpackCz3`: every row that is not one of the picture's own key rows is added to the one behind. */
function addRowsByteWise(output: Buffer, layout: CzLayout): void {
	const { width, height, bitsPerPixel } = layout;
	const stride = (width * bitsPerPixel) / 8;
	const third = Math.trunc((height + 2) / 3);
	if (0 === third) return;
	for (let row = 0; row < height; row += 1) {
		if (row % third === 0) continue;
		const at = row * stride;
		for (let column = 0; column < stride; column += 1) {
			output[at + column] =
				(output[at + column] ?? 0) + (output[at + column - stride] ?? 0);
		}
	}
}

/** `CzDecoder.UnpackCz2`: the same, with the pixels standing as whole words rather than as bytes. */
function addRowsWordWise(output: Buffer, layout: CzLayout): void {
	const { width, height, bitsPerPixel } = layout;
	const stride = (width * bitsPerPixel) / 8 / 4;
	const third = Math.trunc((height + 2) / 3);
	if (0 === third) return;
	const words = new Uint32Array(output.length / 4);
	for (let at = 0; at < words.length; at += 1) {
		words[at] = output.readUInt32LE(at * 4);
	}
	for (let row = 0; row < height; row += 1) {
		if (row % third === 0) continue;
		const at = width * row;
		for (let column = 0; column < stride; column += 1) {
			words[at + column] =
				((words[at + column] ?? 0) + (words[at + column - stride] ?? 0)) >>> 0;
		}
	}
	for (let at = 0; at < words.length; at += 1) {
		output.writeUInt32LE(words[at] ?? 0, at * 4);
	}
}

/**
 * `CzDecoder.Unpack`: the colour map of an eight bit picture stands where the head says the picture begins,
 * the parts follow it, and the version named by the word decides whether the rows behind them are added up
 * again. Thirty two bit pictures are stored red first and handed over blue first, as a bitmap keeps them.
 */
export function unpackCz(
	data: Buffer,
	layout: CzLayout,
): {
	pixels: Buffer;
	palette: Buffer | undefined;
} {
	if (BITS_8 !== layout.bitsPerPixel && BITS_32 !== layout.bitsPerPixel) {
		throw unsupported(
			`CZ pictures of ${layout.bitsPerPixel} bits, which the reference draws as thirty two bit ones`,
		);
	}
	const size = layout.width * layout.height * (layout.bitsPerPixel / 8);
	let start = layout.headerLength;
	let palette: Buffer | undefined;
	if (BITS_8 === layout.bitsPerPixel) {
		if (start + PALETTE_COLOURS * PALETTE_ENTRY_SIZE > data.length) {
			throw invalidImage("The picture ends inside its colour map");
		}
		// The colour map stands red first, as the reference reads it, and a bitmap keeps blue first - so the
		// two ends of every colour are exchanged on the way through, the fourth byte standing as it does.
		const stored = data.subarray(
			start,
			start + PALETTE_COLOURS * PALETTE_ENTRY_SIZE,
		);
		palette = Buffer.alloc(PALETTE_COLOURS * PALETTE_ENTRY_SIZE, 0x00);
		for (let colour = 0; colour < PALETTE_COLOURS; colour += 1) {
			const at = colour * PALETTE_ENTRY_SIZE;
			palette[at] = stored[at + 2] ?? 0;
			palette[at + 1] = stored[at + 1] ?? 0;
			palette[at + 2] = stored[at] ?? 0;
			palette[at + 3] = stored[at + 3] ?? 0;
		}
		start += PALETTE_COLOURS * PALETTE_ENTRY_SIZE;
	}
	const output = Buffer.alloc(size, 0x00);
	const inner = { ...layout, headerLength: start };
	switch (layout.version) {
		case 3:
			unpackParts(data, inner, output);
			addRowsByteWise(output, layout);
			break;
		case 2:
			unpackParts(data, inner, output);
			addRowsWordWise(output, layout);
			break;
		case 1:
			unpackParts(data, inner, output);
			break;
		default:
			// The oldest version stores its pixels as they stand, with no parts at all.
			if (start + size > data.length) {
				throw invalidImage("The picture ends before its pixels");
			}
			data.subarray(start, start + size).copy(output);
			break;
	}
	if (BITS_32 === layout.bitsPerPixel) {
		for (let at = 0; at + 4 <= output.length; at += 4) {
			const red = output[at] ?? 0;
			output[at] = output[at + 2] ?? 0;
			output[at + 2] = red;
		}
	}
	return { pixels: output, palette };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const czImageDescriptor: FormatDescriptor = {
	id: "key-cz-image",
	name: "Key compressed image",
	extensions: ["cz", "cz0", "cz1", "cz3"],
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
			source: "ArcFormats/Key/ImageCZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const czImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: czImageDescriptor,
	detection: {
		signatures: SIGNATURES.map((bytes) => ({ bytes })),
		// The second version is not among the words the reference lists, though its own reader knows it.
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PLAIN_HEADER_SIZE)) return false;
		return readCzLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCzLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Key compressed image");
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
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The parts are unfolded and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				version: layout.version,
				headerLength: layout.headerLength,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCzLayout(stored);
		if (!layout) throw invalidImage("Not a Key compressed image");
		const { pixels, palette } = unpackCz(stored, layout);
		if (palette) {
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette),
			]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
