// Format reference: GARbro "Legacy/Izumi/ImageMAI3.cs", classes `Mai3Format` and the `Mai3Reader` beside
// it (tag `MI3`, the picture of the Izumi engine, of four places to a pixel). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { paletteTriples, writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The picture opens with a word of its own and its own head behind it. */
const MARK = Buffer.from("MAI03\x1a", "latin1");
const HEAD_SIZE = 14;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xa;
const OFFSET_FIELD = 0xc;
const FLAG_FIELD = 0xd;
/** The places of a place of a picture and of a place of its colour map. */
const PLACE_BITS = 4;
const COLOURS = 16;
/** The colour map stands of four places to a colour, taken of their own places. */
const COLOUR_BITS = 4;
const COLOUR_SPREAD = 0x11;
const PALETTE_BYTES = (COLOURS * COLOUR_BITS * 3) / 8;
/** The buffer the places of a picture are read into, and how it stands of its own places. */
const BUFFER_SIZE = 0x6d0;
const BUFFER_MOVE_SOURCE = 0x10;
const BUFFER_MOVE_DESTINATION = 0x370;
const BUFFER_MOVE_PLACES = 0x360;
/** The three planes standing over the plane a line of the buffer is read into. */
const PLANE_STEP = 0x1b0;
/** The four lines of a group of sixteen places. */
const LINE_HEAD_PLACES = 0x1c0;
const LINE_HEAD_TAIL = 0x10;
/** The four lines of a group of sixteen places: two of the places and two of the places behind them. */
const LINE_HEADS = [
	LINE_HEAD_PLACES,
	LINE_HEAD_TAIL,
	LINE_HEAD_PLACES,
	LINE_HEAD_TAIL,
];
const PIXEL_PLACES = 0x100;
const PIXEL_RUNS = 0x10;
const LIMIT = 256 * 1024 * 1024;

export interface Mai3Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
	hasPalette: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Mai3Format.ReadMetaData`: the head of the picture, of eight places to a word of its own. */
export function readMai3Layout(data: Buffer): Mai3Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD) << 3;
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const dataOffset = data.readUInt16LE(OFFSET_FIELD) & 0x7fff;
	const hasPalette = 0 !== ((data[FLAG_FIELD] ?? 0) & 0x80);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	if (0 === width >> 3) return undefined;
	if (dataOffset >= data.length) return undefined;
	return { width, height, bitsPerPixel: PLACE_BITS, dataOffset, hasPalette };
}

/**
 * The bits of a picture: the reference reads them a word of two places at a time, of the lowest place of
 * the word first, and reads the word behind it as the word before it runs out. A picture whose places end
 * between the two places of a word stands of the one place of it that stands there, and the places behind
 * the end of the picture stand of nothing.
 */
class Mai3Bits {
	private readonly data: Buffer;
	private position: number;
	private word = 0;
	private left = 0;

	constructor(data: Buffer, position: number) {
		this.data = data;
		this.position = position;
		this.moveWord();
	}

	private moveWord(): void {
		// The reference asks the file for a word of two places and holds a picture standing of one place to
		// the word off, so the port reads that one place and nothing behind it.
		if (this.position + 2 <= this.data.length) {
			this.word = this.data.readUInt16LE(this.position);
			this.position += 2;
		} else if (this.position + 1 <= this.data.length) {
			this.word = this.data[this.position] ?? 0;
			this.position += 1;
		} else {
			this.word = 0;
		}
		this.left = 16;
	}

	bit(): number {
		const bit = this.word & 1;
		this.word >>= 1;
		this.left -= 1;
		if (this.left <= 0) {
			if (this.position < this.data.length) this.moveWord();
			else {
				this.word = 0;
				this.left = 16;
			}
		}
		return bit;
	}

	/** `Mai3Reader.GetCount`: the places standing clear in front of the next place that stands. */
	count(limit: number): number {
		let count = 0;
		while (count < limit && 0 === this.bit()) count += 1;
		return count;
	}
}

/** `Mai3Reader.InitPixels`: the places of a picture, of runs of the places of their own. */
function initPixels(): Buffer {
	const pixels: Buffer = Buffer.alloc(PIXEL_PLACES, 0x00);
	let at = PIXEL_PLACES - 1;
	for (let run = COLOURS - 1; run >= 0; run -= 1) {
		let value = run;
		for (let place = 0; place < PIXEL_RUNS; place += 1) {
			pixels[at] = value & 0xf;
			value -= 1;
			at -= 1;
		}
	}
	return pixels;
}

/** `Mai3Reader.GetPixel`: the place of a colour the run of the bits names, turned about in its own run. */
function readPlace(bits: Mai3Bits, pixels: Buffer, previous: number): number {
	let count = bits.count(15);
	// The place of the picture stands of the four places of the place behind it, and the reference keeps it
	// as the one place of a picture: the places standing over it stand of nothing.
	const head = (((previous << 4) & 0xff) + 0xf) & 0xff;
	let source = head - count;
	let destination = source;
	const value = pixels[source] ?? 0;
	source += 1;
	if (count > 0) {
		while (count > 0) {
			pixels[destination] = pixels[source] ?? 0;
			destination += 1;
			source += 1;
			count -= 1;
		}
		pixels[destination] = value;
	}
	return value;
}

/** The places of the picture a line of the buffer stands of, of the place of the colour of every one. */
function patternPlaces(plane: number, place: number): number {
	let value = 0;
	for (let part = 0; part < 4; part += 1) {
		value |= ((place >> part) & 1) << (plane + part * 4);
	}
	return value;
}

/** `Mai3Reader.UnpackLine`: a line of the picture, of the places behind it or of the places of a colour. */
function unpackLine(
	buffer: Uint16Array,
	bits: Mai3Bits,
	pixels: Buffer,
	height: number,
	head: number,
): void {
	let at = head;
	let rows = height;
	const read = (index: number): number => {
		if (index < 0 || index >= buffer.length) {
			throw invalidPicture("The places of the picture stand outside it");
		}
		return buffer[index] ?? 0;
	};
	while (rows > 0) {
		if (0 === bits.bit()) {
			// The places of a line stand of the places behind it, of one of the four planes of the buffer the
			// picture is read into, or of the places of the line before it. The reference reads the place the
			// run stands of as a run of places standing clear in front of the place that stands.
			const plane = bits.count(2);
			let offset = [0, PLANE_STEP, PLANE_STEP * 2][plane] ?? 0;
			if (0 === offset || 0 !== bits.bit()) {
				offset -= [1, 2, 4, 8, 0x10][bits.count(4)] ?? 1;
			} else if (0 === bits.bit()) {
				offset += [2, 4, 8, 0x10][bits.count(3)] ?? 2;
			}
			const length = bits.count(8);
			let count = 1;
			for (let step = 0; step < length; step += 1) {
				count = (count << 1) | bits.bit();
			}
			count += 1;
			let source = at + offset;
			rows -= count;
			while (count > 0) {
				const value = read(source);
				if (at >= buffer.length) {
					throw invalidPicture("The places of the picture stand outside it");
				}
				buffer[at] = value;
				at += 1;
				source += 1;
				count -= 1;
			}
		} else {
			// The place stands of the places of a colour, of the place of the line above it.
			const above = read(at + PLANE_STEP);
			let previous = (above >> 8) & 1;
			previous = (previous << 1) | ((above >> 12) & 1);
			previous = (previous << 1) | (above & 1);
			previous = (previous << 1) | ((above >> 4) & 1);
			const first = readPlace(bits, pixels, previous);
			const second = readPlace(bits, pixels, first);
			const third = readPlace(bits, pixels, second);
			const fourth = readPlace(bits, pixels, third);
			if (at >= buffer.length) {
				throw invalidPicture("The places of the picture stand outside it");
			}
			buffer[at] =
				patternPlaces(0, fourth) |
				patternPlaces(1, third) |
				patternPlaces(2, second) |
				patternPlaces(3, first);
			at += 1;
			rows -= 1;
		}
	}
}

/** `Mai3Reader.CopyOutput`: the places of the picture, of the four planes of the buffer. */
function copyOutput(
	output: Buffer,
	buffer: Uint16Array,
	height: number,
	outputStride: number,
	line: number,
	rows: number,
): void {
	let source = 0x10;
	let destinationLine = line;
	for (let row = 0; row < height; row += 1) {
		const ax = buffer[source] ?? 0;
		const bx = buffer[source + PLANE_STEP] ?? 0;
		const cx = buffer[source + PLANE_STEP * 2] ?? 0;
		const dx = buffer[source + PLANE_STEP * 3] ?? 0;
		source += 1;
		let b0 =
			((bx << 8) & 0xf000) |
			((ax << 4) & 0x0f00) |
			(cx & 0x00f0) |
			((dx >> 4) & 0xf);
		let b1 =
			((bx << 12) & 0xf000) |
			((ax << 8) & 0x0f00) |
			((cx << 4) & 0x00f0) |
			(dx & 0xf);
		let b2 =
			(bx & 0xf000) |
			((ax >> 4) & 0x0f00) |
			((cx >> 8) & 0x00f0) |
			((dx >> 12) & 0xf);
		let b3 =
			((bx << 4) & 0xf000) |
			(ax & 0x0f00) |
			((cx >> 4) & 0x00f0) |
			((dx >> 8) & 0xf);
		let at = destinationLine;
		for (let part = 0; part < rows; part += 1) {
			for (let place = 0; place < 8; place += 2) {
				let value =
					(((b0 << place) & 0x80) >> 3) |
					(((b1 << place) & 0x80) >> 2) |
					(((b2 << place) & 0x80) >> 1) |
					((b3 << place) & 0x80);
				value |=
					(((b0 << place) & 0x40) >> 6) |
					(((b1 << place) & 0x40) >> 5) |
					(((b2 << place) & 0x40) >> 4) |
					(((b3 << place) & 0x40) >> 3);
				if (at >= output.length) {
					throw invalidPicture("The places of the picture stand outside it");
				}
				output[at] = value & 0xff;
				at += 1;
			}
			b0 >>= 8;
			b1 >>= 8;
			b2 >>= 8;
			b3 >>= 8;
		}
		destinationLine += outputStride;
	}
}

/** `Mai3Reader.ReadPalette`: the colour map of a picture, four places to a colour, red first. */
export function readMai3Palette(data: Buffer, offset: number): Buffer {
	const palette: Buffer = Buffer.alloc(COLOURS * 4, 0x00);
	const bits = new MsbBitReader(data, offset);
	for (let colour = 0; colour < COLOURS; colour += 1) {
		const red = bits.readBits(COLOUR_BITS) * COLOUR_SPREAD;
		const green = bits.readBits(COLOUR_BITS) * COLOUR_SPREAD;
		const blue = bits.readBits(COLOUR_BITS) * COLOUR_SPREAD;
		palette[colour * 4] = blue & 0xff;
		palette[colour * 4 + 1] = green & 0xff;
		palette[colour * 4 + 2] = red & 0xff;
	}
	return palette;
}

/** The greys a picture stands of where its head names no colour map of its own. */
function greyPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(COLOURS * 4, 0x00);
	for (let colour = 0; colour < COLOURS; colour += 1) {
		const grey = colour * COLOUR_SPREAD;
		palette[colour * 4] = grey;
		palette[colour * 4 + 1] = grey;
		palette[colour * 4 + 2] = grey;
	}
	return palette;
}

/** `Mai3Reader.Unpack`: the places of the picture, of the groups of sixteen places of it. */
export function unpackMai3Picture(data: Buffer, layout: Mai3Layout): Buffer {
	const palette = layout.hasPalette
		? readMai3Palette(data, layout.dataOffset)
		: greyPalette();
	const bits = new Mai3Bits(
		data,
		layout.dataOffset + (layout.hasPalette ? PALETTE_BYTES : 0),
	);
	const buffer = new Uint16Array(BUFFER_SIZE);
	const outputStride = layout.width >> 1;
	const output: Buffer = Buffer.alloc(outputStride * layout.height, 0x00);
	const pixels = initPixels();
	const groups = (layout.width >> 3) >> 1;
	let line = 0;
	for (let group = 0; group < groups; group += 1) {
		for (const head of LINE_HEADS) {
			if (0x1c0 === head) {
				// The buffer stands of the places of the lines before it, which move on before every pair of
				// lines of the picture.
				moveBuffer(buffer);
			}
			unpackLine(buffer, bits, pixels, layout.height, head);
		}
		copyOutput(output, buffer, layout.height, outputStride, line, 2);
		line += 8;
	}
	if (0 !== ((layout.width >> 3) & 1)) {
		moveBuffer(buffer);
		unpackLine(buffer, bits, pixels, layout.height, LINE_HEAD_PLACES);
		unpackLine(buffer, bits, pixels, layout.height, LINE_HEAD_TAIL);
		copyOutput(output, buffer, layout.height, outputStride, line, 1);
	}
	return writeBmp4(
		layout.width,
		layout.height,
		output,
		paletteTriples(palette),
	);
}

/** `Mai3Reader.MoveBuffer`: the places of the buffer, standing of the places of its own middle. */
function moveBuffer(buffer: Uint16Array): void {
	buffer.copyWithin(
		BUFFER_MOVE_DESTINATION,
		BUFFER_MOVE_SOURCE,
		BUFFER_MOVE_SOURCE + BUFFER_MOVE_PLACES,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mai3ImageDescriptor: FormatDescriptor = {
	id: "izumi-mai3-image",
	name: "Izumi engine image",
	extensions: ["mi3"],
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
			source: "Legacy/Izumi/ImageMAI3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mai3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mai3ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readMai3Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMai3Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Izumi engine");
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
					palette: layout.hasPalette,
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
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMai3Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the Izumi engine");
		return Readable.from([unpackMai3Picture(data, layout)]);
	},
});
