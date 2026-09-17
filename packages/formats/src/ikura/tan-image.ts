// Format reference: GARbro "ArcFormats/Ikura/ImageTAN.cs", classes `TanFormat`, `TanReader` and `TanMetaData`
// (an eight bit indexed animation frame of the D.O. engine, whose first frame is what the reference hands
// out). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference gates on this extension before it looks inside the file. */
const EXTENSION = "tan";
/** The head declares a count of records of four bytes each, then the measurements. */
const COUNT_FIELD = 0;
const RECORD_SIZE = 4;
const HEADER_TAIL = 4;
/** The colour map of two hundred and fifty six four byte entries stands first behind the head. */
const PALETTE_SIZE = 0x100 * 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface TanLayout {
	width: number;
	height: number;
	/** Where the frame block stands behind the head. */
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `TanFormat.ReadMetaData`: a count of records of four bytes each stands at the start, of which none is
 * refused, and the width and the height are the words behind them. The depth is always reported as eight
 * bits. The data of the frames stands right behind the measurements.
 */
export function readTanLayout(data: Buffer): TanLayout | undefined {
	if (data.length < 2) return undefined;
	const count = data.readUInt16LE(COUNT_FIELD);
	if (0 === count) return undefined;
	const measurements = 2 + count * RECORD_SIZE;
	if (measurements + HEADER_TAIL > data.length) return undefined;
	const width = data.readUInt16LE(measurements);
	const height = data.readUInt16LE(measurements + 2);
	if (0 === width || 0 === height) return undefined;
	const size = width * height;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, dataOffset: measurements + HEADER_TAIL };
}

export interface TanFrame {
	pixels: Buffer;
	/** The colour map as a bitmap wants it: four bytes an entry, blue first, which is how it is stored. */
	palette: Buffer;
}

/**
 * `TanReader.UnpackFrame`: behind the head stands the colour map, then a count of frames and a table of
 * their offsets. The first frame is read from where its offset says behind the table. The walk is a command
 * byte and its payload, of which the first four commands are the values nought to four and every byte above
 * four is a count of pixels that stand in the stream themselves, four fewer than the byte says:
 *
 * | byte | what it does |
 * | --- | --- |
 * | `0` | the byte behind it is a count and the one behind that a value, which is repeated that many times |
 * | `1` | the count is a byte and the distance a byte; a run is copied from behind |
 * | `2` | the count is a byte and the distance a word; a run is copied from behind |
 * | `3` | the byte behind it is a count of pixels to leave as they stand |
 * | `4` | the word behind it is a count of pixels to leave as they stand |
 * | above `4` | the byte less four is a count of pixels that stand in the stream themselves |
 *
 * A run is copied a byte at a time, so one that stands one byte behind repeats the byte before it. A command
 * that reaches outside the picture is refused, which the reference's own array reads and writes answer with an
 * exception (a documented deviation in the message only).
 */
export function unpackTanFrame(
	data: Buffer,
	layout: TanLayout,
	frame = 0,
): TanFrame {
	const paletteStart = layout.dataOffset;
	if (paletteStart + PALETTE_SIZE + 2 > data.length) {
		throw invalidPicture("D.O. animation is cut short of its colour map");
	}
	const palette = Buffer.from(
		data.subarray(paletteStart, paletteStart + PALETTE_SIZE),
	);
	let position = paletteStart + PALETTE_SIZE;
	const count = data.readUInt16LE(position);
	position += 2;
	if (frame >= count) {
		throw invalidPicture("D.O. animation does not hold that frame");
	}
	const tableSize = count * RECORD_SIZE;
	const basePosition = position + tableSize;
	if (basePosition > data.length) {
		throw invalidPicture("D.O. animation is cut short of its frame table");
	}
	const offset = data.readUInt32LE(position + frame * RECORD_SIZE);
	const start = basePosition + offset;
	if (start > data.length) {
		throw invalidPicture("D.O. animation frame stands past its own end");
	}
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	let cursor = start;
	const readByte = (): number => {
		if (cursor >= data.length) {
			throw invalidPicture("D.O. animation is cut short of its frame");
		}
		const value = data[cursor] ?? 0;
		cursor += 1;
		return value;
	};
	const readWord = (): number => {
		const low = readByte();
		return low | (readByte() << 8);
	};
	const copy = (source: number, destination: number, length: number): void => {
		if (source < 0 || destination + length > output.length || length < 0) {
			throw invalidPicture("D.O. animation writes past its own frame");
		}
		for (let index = 0; index < length; index += 1) {
			output[destination + index] = output[source + index] ?? 0;
		}
	};
	let dst = 0;
	while (dst < output.length) {
		const control = readByte();
		if (0 === control) {
			const run = readByte();
			const value = readByte();
			if (dst + run > output.length) {
				throw invalidPicture("D.O. animation writes past its own frame");
			}
			output.fill(value, dst, dst + run);
			dst += run;
		} else if (1 === control) {
			const run = readByte();
			const distance = readByte();
			copy(dst - distance, dst, run);
			dst += run;
		} else if (2 === control) {
			const run = readByte();
			const distance = readWord();
			copy(dst - distance, dst, run);
			dst += run;
		} else if (3 === control) {
			dst += readByte();
		} else if (4 === control) {
			dst += readWord();
		} else {
			const run = control - 4;
			if (dst + run > output.length) {
				throw invalidPicture("D.O. animation writes past its own frame");
			}
			const end = Math.min(cursor + run, data.length);
			if (end > cursor) data.copy(output, dst, cursor, end);
			cursor = end;
			dst += run;
		}
	}
	return { pixels: output, palette };
}

async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<TanLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(6)) return undefined;
	try {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readTanLayout(data);
	} catch {
		return undefined;
	}
}

export const ikuraTanImageDescriptor: FormatDescriptor = {
	id: "ikura-tan-image",
	name: "D.O. animation image",
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
			source: "ArcFormats/Ikura/ImageTAN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikuraTanImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikuraTanImageDescriptor,
	// The reference declares no signature and gates on the extension.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a D.O. animation");
		}
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
					bitsPerPixel: 8,
				},
			}),
			// The first frame is unfolded from a walk and a bitmap header is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				colors: 0x100,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a D.O. animation");
		}
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const frame = unpackTanFrame(data, layout, 0);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				frame.pixels,
				frame.palette,
			),
		]);
	},
});
