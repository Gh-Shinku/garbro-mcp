// Format reference: GARbro "Legacy/Ponytail/ImageTSZ.cs", classes `TszFormat` and `TszReader` (a Ponytail
// Soft picture of four bits: its places stand column by column, the columns of a pair standing one after the
// other in a pair of half lines, and every step of the walk gives a run of places of a column whose places
// stand beside those of the column behind it). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'NMI ', the word the reference registers. */
const SIGNATURE = Buffer.from("NMI ", "latin1");
const HEADER_SIZE = 0x10;
/** The word the head carries behind the word of the format. */
const VERSION = "2.05";
const VERSION_FIELD = 0x04;
/** The width of the picture stands in the word at `0x0C` in fours of places, its height in the word behind. */
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x0e;
/** The colours of the picture stand behind the head: sixteen of them, three bytes apiece. */
export const PALETTE_FIELD = 0x10;
export const PALETTE_COLORS = 16;
export const PALETTE_SIZE = PALETTE_COLORS * 3;
/** How many places stand in a word of the line buffer, and how the two columns of a pair are kept. */
const WORD_PLACES = 16;
/** The ways a step of the walk takes, which stand in the places before the step itself. */
const STEPS = 5;
/** The greatest run a step of the walk names. */
const MAXIMUM_COUNT = 0x7fff;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `TszReader.s_bit_mask`: the places below the highest of a count of them. */
const BIT_MASK = new Uint16Array([
	0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff,
	0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff,
]);
/** `TszReader.s_pattern1`, which stands for the places of a word that keep their colour. */
const PATTERN_1 = new Uint16Array([
	0xffff, 0xeeee, 0xdddd, 0xcccc, 0xbbbb, 0xaaaa, 0x9999, 0x8888, 0x7777,
	0x6666, 0x5555, 0x4444, 0x3333, 0x2222, 0x1111, 0x0000,
]);
/** `TszReader.s_pattern2`, which stands for the places of a word that take one. */
const PATTERN_2 = new Uint16Array([
	0x0000, 0x0001, 0x0010, 0x0011, 0x0100, 0x0101, 0x0110, 0x0111, 0x1000,
	0x1001, 0x1010, 0x1011, 0x1100, 0x1101, 0x1110, 0x1111,
]);

export interface TszLayout {
	/** The places of the picture, in four places of a byte. */
	width: number;
	height: number;
	/** How many bytes stand in a row of the picture. */
	stride: number;
	/** How many pairs of columns the picture stands in. */
	groups: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `TszFormat.ReadMetaData`: the word `NMI ` stands at the beginning of the file with the word `2.05` behind it,
 * the width of the picture stands in the word at `0x0C` in fours of places and its height in the word behind
 * it.
 */
export function readTszLayout(
	data: Buffer,
	fileLength = data.length,
): TszLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", VERSION_FIELD, VERSION_FIELD + VERSION.length) !==
		VERSION
	) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD) << 2;
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (width * height > LIMIT) return undefined;
	return {
		width,
		height,
		stride: width >> 1,
		groups: width >> 2,
	};
}

/**
 * `TszReader.ReadPalette`: sixteen colours stand behind the head, three bytes apiece — the red of the colour
 * first, then its green and its blue — every byte standing for a colour of four places, which is thirty four
 * places of a colour of eight bits.
 */
export function readTszPalette(data: Buffer): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_COLORS * 3, 0x00);
	for (let entry = 0; entry < PALETTE_COLORS; entry += 1) {
		const at = PALETTE_FIELD + entry * 3;
		palette[entry * 3] = ((data[at] ?? 0) * 0x11) & 0xff;
		palette[entry * 3 + 1] = ((data[at + 1] ?? 0) * 0x11) & 0xff;
		palette[entry * 3 + 2] = ((data[at + 2] ?? 0) * 0x11) & 0xff;
	}
	return palette;
}

/** Where the walk of the picture stands: the word it holds and how many of its places are still there. */
export interface TszCursor {
	data: Buffer;
	position: number;
	bits: number;
	count: number;
}

/** `TszReader.RotU16L`. */
function rotU16L(value: number, count: number): number {
	if (0 === count) return value & 0xffff;
	return ((value << count) | (value >>> (WORD_PLACES - count))) & 0xffff;
}

/** `TszReader.RotU16R`. */
function rotU16R(value: number, count: number): number {
	if (0 === count) return value & 0xffff;
	return ((value >>> count) | (value << (WORD_PLACES - count))) & 0xffff;
}

function readWord(cursor: TszCursor): number {
	if (cursor.position + 2 > cursor.data.length) {
		throw invalidPicture("NMI picture is cut short of its walk");
	}
	const word = cursor.data.readUInt16LE(cursor.position);
	cursor.position += 2;
	return word;
}

/** `TszReader.GetNextBit`: the walk takes the highest place of the word it holds and stands another word under
 * it every sixteen places. */
export function nextBit(cursor: TszCursor): boolean {
	cursor.count -= 1;
	if (cursor.count < 0) {
		cursor.bits = readWord(cursor);
		cursor.count = WORD_PLACES - 1;
	}
	const bit = 0 !== (cursor.bits & 0x8000);
	cursor.bits = (cursor.bits << 1) & 0xffff;
	return bit;
}

/** `TszReader.GetBits`: as many places were asked for as stand in the word at hand; where fewer stand there,
 * the word behind the word at hand is stood under it. */
export function getBits(cursor: TszCursor, count: number): number {
	if (count > WORD_PLACES || count < 0) {
		throw invalidPicture("NMI picture asks for more places than a word holds");
	}
	cursor.count -= count;
	if (cursor.count < 0) {
		cursor.bits = rotU16L(cursor.bits, count);
		const missing = -cursor.count;
		let word = rotU16L(readWord(cursor), missing);
		const mask = BIT_MASK[missing] ?? 0;
		const above = word & ~mask & 0xffff;
		word = (word & mask) | cursor.bits;
		cursor.bits = above;
		cursor.count = WORD_PLACES - missing;
		return word & 0xffff;
	}
	cursor.bits = rotU16L(cursor.bits, count);
	const mask = BIT_MASK[count] ?? 0;
	const bits = cursor.bits & mask;
	cursor.bits = cursor.bits & ~mask & 0xffff;
	return bits;
}

/** `TszReader.GetBitLength`: how many places a step of the walk names — one where the place at hand does not
 * stand, and otherwise as many as the run of places that stand before it says, less the highest of them. */
export function readBitLength(cursor: TszCursor): number {
	if (!nextBit(cursor)) return 1;
	let count = 1;
	while (nextBit(cursor)) {
		count += 1;
		if (count >= WORD_PLACES) {
			throw invalidPicture("NMI picture names a run that stands too far");
		}
	}
	return (getBits(cursor, count) | (1 << count)) & 0xffff;
}

/** `TszReader.CopyOverlapped` over the places of the line buffer, which the reference copies two bytes at a
 * time; a run whose places stand before the place at hand stands over and over. */
function copyOverlappedPlaces(
	line: Uint16Array,
	source: number,
	target: number,
	count: number,
): void {
	if (
		count < 0 ||
		source < 0 ||
		target < 0 ||
		source + count > line.length ||
		target + count > line.length
	) {
		throw invalidPicture("NMI picture walks beyond its own line");
	}
	if (target > source) {
		let remaining = count;
		let at = target;
		while (remaining > 0) {
			const preceding = Math.min(at - source, remaining);
			for (let index = 0; index < preceding; index += 1) {
				line[at + index] = line[source + index] ?? 0;
			}
			at += preceding;
			remaining -= preceding;
		}
		return;
	}
	for (let index = 0; index < count; index += 1) {
		line[target + index] = line[source + index] ?? 0;
	}
}

/**
 * `TszReader.Unpack`: the places of the picture stand column by column, the two columns of a pair standing one
 * behind the other in the two halves of a line buffer. Every step of the walk gives a run of places of the
 * column at hand, and the way the run stands is named by the run of places in front of the step:
 *
 * | the places in front of the step | what the step does |
 * | ------------------------------- | ------------------ |
 * | none | places of the column before the one at hand, standing a whole line behind it, taken from four places the step names |
 * | one | the same, taken from a byte the step names |
 * | two | one place of the line buffer, taken from the file as it stands |
 * | three | places of the column at hand, taken from four places the step names |
 * | four | one place of the column before the one at hand, which the byte the step gives keeps in part and stands in part |
 */
export function decodeTsz(data: Buffer, layout: TszLayout): Buffer {
	const palette = readTszPalette(data);
	const pixels: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const line = new Uint16Array(layout.height * 2);
	const cursor: TszCursor = {
		data,
		position: PALETTE_FIELD + PALETTE_SIZE,
		bits: 0,
		count: 0,
	};
	let previousRow = layout.height;
	let outputAt = 0;
	for (let group = 0; group < layout.groups; group += 1) {
		let y = 0;
		let dst = 0;
		if (0 !== (group & 1)) dst += layout.height;
		while (y < layout.height) {
			let control = 0;
			while (nextBit(cursor)) {
				control += 1;
				if (control >= STEPS) {
					throw invalidPicture(
						"NMI picture takes a way its walk does not know",
					);
				}
			}
			let count: number;
			if (0 === control) {
				count = readBitLength(cursor);
				const offset = getBits(cursor, 4) + previousRow - 8;
				copyOverlappedPlaces(line, dst + offset, dst, count);
			} else if (1 === control) {
				count = readBitLength(cursor);
				const offset = (data[cursor.position] ?? 0) + previousRow - 0x80;
				cursor.position += 1;
				copyOverlappedPlaces(line, dst + offset, dst, count);
			} else if (2 === control) {
				line[dst] = readWord(cursor);
				count = 1;
			} else if (3 === control) {
				count = readBitLength(cursor);
				const offset = getBits(cursor, 4) - 0x10;
				copyOverlappedPlaces(line, dst + offset, dst, count);
			} else {
				const value = data[cursor.position] ?? 0;
				cursor.position += 1;
				let nibble = value >> 4;
				const mask1 = PATTERN_1[value >> 4] ?? 0;
				const mask2 = PATTERN_2[value & 0x0f] ?? 0;
				if (dst + previousRow < 0 || dst + previousRow >= line.length) {
					throw invalidPicture("NMI picture walks beyond its own line");
				}
				let pixel = (line[dst + previousRow] ?? 0) & mask1;
				for (let index = 0; index < 4; index += 1) {
					const carry = nibble & 1;
					nibble >>= 1;
					pixel = (pixel | (-carry & mask2)) & 0xffff;
					pixel = rotU16R(pixel, 1);
				}
				pixel = rotU16L(pixel, 4);
				line[dst] = pixel;
				count = 1;
			}
			if (count <= 0 || count > MAXIMUM_COUNT) {
				throw invalidPicture("NMI picture names a run that stands too far");
			}
			dst += count;
			y += count;
		}
		if (0 !== (group & 1)) {
			gatherTszScanline(line, pixels, outputAt, layout);
			outputAt += 4;
		}
		previousRow = -previousRow;
	}
	return writeBmp4(layout.width, layout.height, pixels, palette);
}

/** `TszReader.CopyScanline`: the two halves of the line buffer stand for the two columns of a pair, eight
 * places of a pair of columns standing in every four bytes of a row. */
export function gatherTszScanline(
	line: Uint16Array,
	output: Buffer,
	at: number,
	layout: TszLayout,
): void {
	let dst = at;
	for (let row = 0; row < layout.height; row += 1) {
		const first = line[row] ?? 0;
		const second = line[row + layout.height] ?? 0;
		const b0 = (((first << 4) & 0xf0) | (second & 0x0f)) & 0xff;
		const b1 = ((first & 0xf0) | ((second >> 4) & 0x0f)) & 0xff;
		const b2 = (((first >> 4) & 0xf0) | ((second >> 8) & 0x0f)) & 0xff;
		const b3 = (((first >> 8) & 0xf0) | ((second >> 12) & 0x0f)) & 0xff;
		for (let place = 0; place < 8; place += 2) {
			let pixel =
				(((b0 << place) & 0x80) >> 3) |
				(((b1 << place) & 0x80) >> 2) |
				(((b2 << place) & 0x80) >> 1) |
				((b3 << place) & 0x80);
			pixel |=
				(((b0 << place) & 0x40) >> 6) |
				(((b1 << place) & 0x40) >> 5) |
				(((b2 << place) & 0x40) >> 4) |
				(((b3 << place) & 0x40) >> 3);
			const target = dst + (place >> 1);
			if (target >= output.length) {
				throw invalidPicture("NMI picture walks beyond its own places");
			}
			output[target] = pixel & 0xff;
		}
		dst += layout.stride;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ponytailTszImageDescriptor: FormatDescriptor = {
	id: "ponytail-tsz-image",
	name: "Ponytail Soft NMI image format",
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
			source: "Legacy/Ponytail/ImageTSZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ponytailTszImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ponytailTszImageDescriptor,
	// The reference registers the word `NMI ` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readTszLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readTszLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an NMI picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(PALETTE_FIELD),
				size: source.size - BigInt(PALETTE_FIELD),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
				},
			}),
			// The columns of the picture are gathered into a bitmap of four bits.
		};
		return { entries: [entry], metadata: { image: "bmp", bitsPerPixel: 4 } };
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readTszLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an NMI picture");
		// The rows of the picture are padded to four bytes by the bitmap writer.
		return Readable.from([decodeTsz(stored, layout)]);
	},
});
