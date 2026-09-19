// Format reference: GARbro "Legacy/Uncanny/ImageCII.cs", classes `CiiFormat`, `CiiMetaData` and `CiiReader`
// (an Uncanny picture of four, eight or twenty four bits a pixel: two of them stand behind a colour map and
// may be walked along, and one of twenty four bits carries a colour of its own on top of every block of four
// pixels). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4, writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x08;
const TYPE_FIELD = 0x00;
const FLAGS_FIELD = 0x01;
const WIDTH_FIELD = 0x02;
const HEIGHT_FIELD = 0x04;
const COLORS_FIELD = 0x06;
/** The word at nought that says a picture is one of twenty four bits, and the place that says it is walked
 *  along. */
const TYPE_24 = 5;
const TYPE_8 = 3;
const TYPE_4 = 2;
const COMPRESSED_MASK = 0x80;
/** The escape of the walk: the highest place of a count says it stands for a byte over and over. */
const RUN_MASK = 0x80;
const RUN_LIMIT = 0x7f;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CiiLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	isCompressed: boolean;
	/** How many colours the colour map holds, which the head gives. */
	colors: number;
	stride: number;
	/** The size of the picture, with a row of nothing behind an odd number of rows. */
	size: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CiiFormat.ReadMetaData`: the file begins with a word of two bytes at nought whose kind says how deep a
 * pixel is — five means twenty four bits, and the kinds three and two, with the highest place of the word left
 * out, mean eight and four — the width and the height stand at two and four as words of two bytes and both
 * have to stand above nought, and the count of colours stands at six. A picture of eight bits or less may
 * hold no more colours than a pixel of it can name. The highest place of the byte at one says the picture is
 * walked along.
 */
export function readCiiLayout(
	data: Buffer,
	fileLength = data.length,
): CiiLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const type = data.readUInt16LE(TYPE_FIELD);
	let bitsPerPixel: number;
	if (TYPE_24 === type) bitsPerPixel = 24;
	else if (TYPE_8 === (type & 0x7fff)) bitsPerPixel = 8;
	else if (TYPE_4 === (type & 0x7fff)) bitsPerPixel = 4;
	else return undefined;
	const width = data.readInt16LE(WIDTH_FIELD);
	const height = data.readInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const colors = data.readUInt16LE(COLORS_FIELD);
	if (bitsPerPixel <= 8 && 1 << bitsPerPixel < colors) return undefined;
	const stride = Math.floor((width * bitsPerPixel) / 8);
	const size = stride * ((height + 1) & ~1);
	if (size > LIMIT) return undefined;
	if (HEADER_SIZE >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		isCompressed: 0 !== ((data[FLAGS_FIELD] ?? 0) & COMPRESSED_MASK),
		colors,
		stride,
		size,
	};
}

/** The colour map of a picture of eight bits or less, spread over four byte entries as a bitmap wants it. */
export function readCiiPalette(stored: Buffer, layout: CiiLayout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (layout.bitsPerPixel > 8) return palette;
	// The count of colours stands in the head itself, so the map stands where the head ends.
	stored.copy(
		palette,
		0,
		HEADER_SIZE,
		Math.min(HEADER_SIZE + layout.colors * 4, stored.length),
	);
	return palette;
}

/**
 * `CiiReader.UnpackRle`: a byte whose highest place stands is a count of up to a hundred and twenty eight —
 * the seven places below it, plus one — that stands in front of the byte the picture takes over and over; any
 * other byte is a count of up to a hundred and twenty eight bytes that stand as they are. The walk ends where
 * the picture is whole or where the file does.
 */
export function unpackCiiRle(
	stored: Buffer,
	position: number,
	output: Buffer,
): void {
	let src = position;
	let dst = 0;
	while (dst < output.length) {
		if (src >= stored.length) break;
		const count = stored[src] ?? 0;
		src += 1;
		if (0 !== (count & RUN_MASK)) {
			if (src >= stored.length) {
				throw invalidPicture("Uncanny picture is cut short of its walk");
			}
			const value = stored[src] ?? 0;
			src += 1;
			let run = (count & RUN_LIMIT) + 1;
			while (run > 0 && dst < output.length) {
				output[dst] = value;
				dst += 1;
				run -= 1;
			}
		} else {
			const run = count + 1;
			const available = Math.min(run, output.length - dst, stored.length - src);
			stored.copy(output, dst, src, src + available);
			dst += available;
			src += run;
			if (available < run) break;
		}
	}
}

/**
 * `CiiReader.Unpack24bpp`: the picture stands in blocks of two by two pixels, every block carrying two signed
 * bytes that turn into the three colours of a pixel's own — one that steps the blue one way and the red the
 * other, one that steps the green against both — and then four bytes that stand on top of them, one for every
 * pixel of the block: the first two for the pixels of a row, the second two for the row behind them. Every
 * byte of the block is the colour it carries added to the one the block gave and held between nought and the
 * whole of a byte.
 */
export function unpackCii24(stored: Buffer, layout: CiiLayout): Buffer {
	const blocksWide = Math.floor(layout.width / 2);
	const blocksHigh = Math.floor(layout.height / 2);
	const output: Buffer = Buffer.alloc(layout.size, 0x00);
	let position = HEADER_SIZE;
	let lower = 0;
	let upper = layout.stride;
	const clamp = (value: number): number => {
		if (value < 0) return 0;
		if (value > 0xff) return 0xff;
		return value;
	};
	for (let y = 0; y < blocksHigh; y += 1) {
		for (let x = 0; x < blocksWide; x += 1) {
			// A block is two signed bytes and then four that stand on top of them.
			if (position + 6 > stored.length) {
				throw invalidPicture("Uncanny picture is cut short of its blocks");
			}
			const first = stored.readInt8(position);
			const second = stored.readInt8(position + 1);
			const blue = (29145 * second - 21601 * first) >> 14;
			const green = (-5312 * first - 11083 * second) >> 14;
			const red =
				(3 * (first + 24 * (first + 2 * (first + (first << 7)))) +
					10638 * second) >>
				14;
			position += 2;
			for (const start of [lower, upper]) {
				let at = start;
				for (let pixel = 0; pixel < 2; pixel += 1) {
					const value = stored[position] ?? 0;
					position += 1;
					output[at] = clamp(value + blue);
					output[at + 1] = clamp(value + green);
					output[at + 2] = clamp(value + red);
					at += 3;
				}
			}
			lower += 6;
			upper += 6;
		}
		lower += layout.stride;
		upper += layout.stride;
	}
	return output;
}

/**
 * `CiiReader.Unpack`: a picture of eight bits or less reads the count of its colour map at six, the map
 * behind it, and then either stands as it stands or is walked along; a picture of twenty four bits reads its
 * blocks.
 */
export function unpackCii(stored: Buffer, layout: CiiLayout): Buffer {
	if (layout.bitsPerPixel > 8) return unpackCii24(stored, layout);
	const output: Buffer = Buffer.alloc(layout.size, 0x00);
	const position = HEADER_SIZE + layout.colors * 4;
	if (layout.isCompressed) {
		unpackCiiRle(stored, position, output);
		return output;
	}
	if (position + output.length > stored.length) {
		throw invalidPicture("Uncanny picture is cut short of its pixels");
	}
	stored.copy(output, 0, position, position + output.length);
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const uncannyCiiImageDescriptor: FormatDescriptor = {
	id: "uncanny-cii-image",
	name: "Uncanny image format",
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
			source: "Legacy/Uncanny/ImageCII.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const uncannyCiiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: uncannyCiiImageDescriptor,
	// The reference registers no word at all and is found by its extension alone.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readCiiLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCiiLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Uncanny picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: layout.isCompressed || layout.bitsPerPixel > 8,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					colors: layout.colors,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression:
					layout.bitsPerPixel > 8
						? "blocks"
						: layout.isCompressed
							? "runs"
							: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCiiLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Uncanny picture");
		}
		const pixels = unpackCii(stored, layout);
		const { width, height, bitsPerPixel } = layout;
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (4 === bitsPerPixel) {
			// The four bit writer takes its colour map as red, green and blue triples, while the map of the
			// file stands in the blue, green, red and left alone order of the reference's own reader.
			const entries = readCiiPalette(stored, layout);
			const triples: Buffer = Buffer.alloc(16 * 3, 0x00);
			for (let entry = 0; entry < 16; entry += 1) {
				triples[entry * 3] = entries[entry * 4 + 2] ?? 0;
				triples[entry * 3 + 1] = entries[entry * 4 + 1] ?? 0;
				triples[entry * 3 + 2] = entries[entry * 4] ?? 0;
			}
			return Readable.from([writeBmp4(width, height, pixels, triples)]);
		}
		if (8 === bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(width, height, pixels, readCiiPalette(stored, layout)),
			]);
		}
		// A picture of twenty four bits stands with a row of nought behind it where its height is odd, so the
		// rows of the bitmap are gathered the way a bitmap lays its own rows out with.
		const tight: Buffer = Buffer.alloc(width * 3 * height, 0x00);
		for (let row = 0; row < height; row += 1) {
			const from = row * layout.stride;
			const available = Math.min(width * 3, layout.size - from);
			if (available <= 0) break;
			pixels.copy(tight, row * width * 3, from, from + available);
		}
		return Readable.from([writeBmp24(width, height, tight)]);
	},
});
