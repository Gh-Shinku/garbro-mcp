// Format reference: GARbro "ArcFormats/AliceSoft/ImagePMS.cs", class `PmsFormat` with the `PmsReader`
// beside it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	writeBmp8Palette,
	writeBmp16,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word the picture opens with, and the byte behind it that names which of the two it is. */
const SIGNATURE = Buffer.from("PM", "latin1");
const VERSIONS = [1, 2];
/** The head holds the depth behind the word, where the picture stands, its size and its two places. */
const BITS_FIELD = 6;
const OFFSET_X_FIELD = 0x10;
const OFFSET_Y_FIELD = 0x14;
const WIDTH_FIELD = 0x18;
const HEIGHT_FIELD = 0x1c;
const DATA_OFFSET_FIELD = 0x20;
const ALPHA_OFFSET_FIELD = 0x24;
const HEAD_SIZE = 0x30;
/** The two depths the picture is stored in. */
const BITS_8 = 8;
const BITS_16 = 16;
/** The colour map of an eight bit picture, three bytes to a colour. */
const PALETTE_COLOURS = 0x100;
const PALETTE_BYTES = PALETTE_COLOURS * 3;
const PALETTE_ENTRY_SIZE = 4;
/** The bytes of a walk that stand for a code, and the runs they name. */
const CODE = 0xf8;
const ALTERNATE = 0xfc;
const RUN = 0xfd;
const COPY_TWO_ROWS = 0xfe;
const COPY_ONE_ROW = 0xff;
const ALTERNATE_BIAS = 2;
const ALTERNATE_PAIRS = 3;
const RUN_BIAS = 3;
const RUN_BIAS_BYTE = 4;
const COPY_BIAS = 2;
const COPY_BIAS_BYTE = 3;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface PmsLayout {
	bitsPerPixel: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	dataOffset: number;
	alphaOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PmsFormat.ReadMetaData`: the picture opens with `PM` and the byte that names which of the two it is, and
 * its head names the depth, the place it stands at, its size, where its pixels begin and where the plane
 * behind them - the colour map of an eight bit picture or the alpha of a sixteen bit one - stands.
 */
export function readPmsLayout(data: Buffer): PmsLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 2).equals(SIGNATURE)) return undefined;
	if (!VERSIONS.includes(data[2] ?? 0)) return undefined;
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (BITS_8 !== bitsPerPixel && BITS_16 !== bitsPerPixel) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	if (dataOffset < HEAD_SIZE || dataOffset >= data.length) return undefined;
	return {
		bitsPerPixel,
		width,
		height,
		offsetX: data.readInt32LE(OFFSET_X_FIELD),
		offsetY: data.readInt32LE(OFFSET_Y_FIELD),
		dataOffset,
		alphaOffset: data.readUInt32LE(ALPHA_OFFSET_FIELD),
	};
}

/** A reader over the picture's own bytes, whose every read is bounded by them. */
class PmsReader {
	private at: number;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	readUInt8(): number {
		if (this.at >= this.data.length) {
			throw invalidImage("The picture ends inside one of its runs");
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	readUInt16(): number {
		const low = this.readUInt8();
		const high = this.readUInt8();
		return low | (high << 8);
	}
}

/** A place of the picture, which every walk bounds before it writes there. */
function place(output: Buffer, at: number, what: string): void {
	if (at < 0 || at >= output.length) {
		throw invalidImage(`A ${what} of the picture reaches past it`);
	}
}

/**
 * `PmsReader.Unpack16bpp`: the pixels of a sixteen bit picture stand in runs, a byte of every run naming what
 * it holds - a word of its own, a word made of two bytes that carry five, six and five bits between them, one
 * of the pixels above it, a pair of words written over and over, a run of one word, or a run copied from the
 * two rows above it or the one above that. Every run walks the row on.
 */
export function unpackPms16(data: Buffer, layout: PmsLayout): Buffer {
	const { width, height } = layout;
	const output = Buffer.alloc(width * height * 2, 0x00);
	const reader = new PmsReader(data, layout.dataOffset);
	for (let row = 0; row < height; row += 1) {
		for (let x = 0; x < width; ) {
			const destination = row * width + x;
			let count = 1;
			const control = reader.readUInt8();
			if (control < CODE) {
				const high = reader.readUInt8();
				place(output, destination, "pixel");
				output.writeUInt16LE(control | (high << 8), destination * 2);
			} else if (CODE === control) {
				const pixel = reader.readUInt16();
				place(output, destination, "pixel");
				output.writeUInt16LE(pixel, destination * 2);
			} else if (CODE + 1 === control) {
				// The two bytes of this run carry a word between them: five bits in the first, six in its
				// second and the last five spread across the two.
				count = reader.readUInt8() + 1;
				let first = reader.readUInt8();
				let second = reader.readUInt8();
				first =
					((first & 0xe0) << 8) | ((first & 0x18) << 6) | ((first & 7) << 2);
				second = ((second & 0xc0) << 5) | ((second & 0x3c) << 3) | (second & 3);
				for (let drawn = 0; drawn < count; drawn += 1) {
					if (drawn > 0) {
						const next = reader.readUInt8();
						second = ((next & 0xc0) << 5) | ((next & 0x3c) << 3) | (next & 3);
					}
					place(output, destination + drawn, "pixel");
					output.writeUInt16LE(first | second, (destination + drawn) * 2);
				}
			} else if (CODE + 2 === control) {
				place(output, destination, "pixel");
				const above = destination - width + 1;
				if (above < 0)
					throw invalidImage("A pixel of the picture stands above it");
				output.writeUInt16LE(output.readUInt16LE(above * 2), destination * 2);
			} else if (CODE + 3 === control) {
				place(output, destination, "pixel");
				const above = destination - width - 1;
				if (above < 0)
					throw invalidImage("A pixel of the picture stands above it");
				output.writeUInt16LE(output.readUInt16LE(above * 2), destination * 2);
			} else if (ALTERNATE === control) {
				count = (reader.readUInt8() + ALTERNATE_BIAS) * 2;
				const first = reader.readUInt16();
				const second = reader.readUInt16();
				for (let drawn = 0; drawn < count; drawn += 2) {
					place(output, destination + drawn, "pixel");
					place(output, destination + drawn + 1, "pixel");
					output.writeUInt16LE(first, (destination + drawn) * 2);
					output.writeUInt16LE(second, (destination + drawn + 1) * 2);
				}
			} else if (RUN === control) {
				count = reader.readUInt8() + RUN_BIAS;
				const pixel = reader.readUInt16();
				for (let drawn = 0; drawn < count; drawn += 1) {
					place(output, destination + drawn, "pixel");
					output.writeUInt16LE(pixel, (destination + drawn) * 2);
				}
			} else {
				count = reader.readUInt8() + COPY_BIAS;
				const above =
					destination - (COPY_TWO_ROWS === control ? width * 2 : width);
				if (above < 0)
					throw invalidImage("A run of the picture stands above it");
				for (let drawn = 0; drawn < count; drawn += 1) {
					place(output, destination + drawn, "pixel");
					if (above + drawn >= output.length / 2) {
						throw invalidImage("A run of the picture reaches past it");
					}
					output.writeUInt16LE(
						output.readUInt16LE((above + drawn) * 2),
						(destination + drawn) * 2,
					);
				}
			}
			x += count;
		}
	}
	return output;
}

/**
 * `PmsReader.Unpack8bpp`: the same walk a byte at a time. A control byte below 0xF8 **is** the pixel, and the
 * runs behind it stand for a byte read here, a pair of bytes written over and over, one byte written over and
 * over, and runs copied from the two rows above or the one above that - the last of which are copied
 * progressively, so a run that reaches into itself runs on.
 */
export function unpackPms8(
	data: Buffer,
	layout: PmsLayout,
	at = layout.dataOffset,
): Buffer {
	const { width, height } = layout;
	const output = Buffer.alloc(width * height, 0x00);
	const reader = new PmsReader(data, at);
	for (let row = 0; row < height; row += 1) {
		for (let x = 0; x < width; ) {
			const destination = row * width + x;
			let count = 1;
			const control = reader.readUInt8();
			if (control < CODE) {
				place(output, destination, "pixel");
				output[destination] = control;
			} else if (COPY_ONE_ROW === control) {
				count = reader.readUInt8() + COPY_BIAS_BYTE;
				if (destination - width < 0) {
					throw invalidImage("A run of the picture stands above it");
				}
				copyOverlapped(output, destination - width, destination, count);
			} else if (COPY_TWO_ROWS === control) {
				count = reader.readUInt8() + COPY_BIAS_BYTE;
				if (destination - width * 2 < 0) {
					throw invalidImage("A run of the picture stands above it");
				}
				copyOverlapped(output, destination - width * 2, destination, count);
			} else if (RUN === control) {
				count = reader.readUInt8() + RUN_BIAS_BYTE;
				const pixel = reader.readUInt8();
				for (let drawn = 0; drawn < count; drawn += 1) {
					place(output, destination + drawn, "pixel");
					output[destination + drawn] = pixel;
				}
			} else if (ALTERNATE === control) {
				count = (reader.readUInt8() + ALTERNATE_PAIRS) * 2;
				const first = reader.readUInt8();
				const second = reader.readUInt8();
				for (let drawn = 0; drawn < count; drawn += 2) {
					place(output, destination + drawn, "pixel");
					place(output, destination + drawn + 1, "pixel");
					output[destination + drawn] = first;
					output[destination + drawn + 1] = second;
				}
			} else {
				const pixel = reader.readUInt8();
				place(output, destination, "pixel");
				output[destination] = pixel;
			}
			x += count;
		}
	}
	return output;
}

/** `PmsReader.UnpackIndexed`: the colour map stands where the head names it, three bytes to a colour. */
export function readPmsPalette(data: Buffer, offset: number): Buffer {
	const palette = Buffer.alloc(PALETTE_COLOURS * PALETTE_ENTRY_SIZE, 0x00);
	if (offset + PALETTE_BYTES > data.length) {
		throw invalidImage("The picture ends inside its colour map");
	}
	for (let colour = 0; colour < PALETTE_COLOURS; colour += 1) {
		const at = offset + colour * 3;
		palette[colour * PALETTE_ENTRY_SIZE] = data[at + 2] ?? 0;
		palette[colour * PALETTE_ENTRY_SIZE + 1] = data[at + 1] ?? 0;
		palette[colour * PALETTE_ENTRY_SIZE + 2] = data[at] ?? 0;
	}
	return palette;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const pmsImageDescriptor: FormatDescriptor = {
	id: "alicesoft-pms-image",
	name: "AliceSoft image",
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
			source: "ArcFormats/AliceSoft/ImagePMS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pmsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pmsImageDescriptor,
	detection: {
		signatures: VERSIONS.map((version) => ({
			bytes: Buffer.from([0x50, 0x4d, version]),
		})),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readPmsLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPmsLayout(await readStored(source));
		if (!layout) throw invalidImage("Not an AliceSoft picture");
		const bitsPerPixel =
			BITS_16 === layout.bitsPerPixel && 0 !== layout.alphaOffset
				? 32
				: layout.bitsPerPixel;
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
					bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The runs are drawn out and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel,
				dataOffset: layout.dataOffset,
				alphaOffset: layout.alphaOffset,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPmsLayout(stored);
		if (!layout) throw invalidImage("Not an AliceSoft picture");
		if (BITS_8 === layout.bitsPerPixel) {
			if (0 === layout.alphaOffset) {
				throw invalidImage("The picture names no colour map");
			}
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					unpackPms8(stored, layout),
					readPmsPalette(stored, layout.alphaOffset),
				),
			]);
		}
		const pixels = unpackPms16(stored, layout);
		if (0 === layout.alphaOffset) {
			return Readable.from([
				writeBmp16(layout.width, layout.height, pixels, false, RGB565_MASKS),
			]);
		}
		// The alpha of the picture stands in a plane of its own, a byte to the pixel.
		const alpha = unpackPms8(stored, layout, layout.alphaOffset);
		const drawn = Buffer.alloc(layout.width * layout.height * 4, 0x00);
		for (let at = 0; at < layout.width * layout.height; at += 1) {
			const pixel = pixels.readUInt16LE(at * 2);
			// The five and six bit channels are spread over the whole byte, as the conversion the
			// reference hands this picture through does.
			const five = (value: number): number => (value << 3) | (value >> 2);
			const six = (value: number): number => (value << 2) | (value >> 4);
			const red = five((pixel & 0xf800) >> 11);
			const green = six((pixel & 0x07e0) >> 5);
			const blue = five(pixel & 0x001f);
			drawn[at * 4] = blue;
			drawn[at * 4 + 1] = green;
			drawn[at * 4 + 2] = red;
			drawn[at * 4 + 3] = alpha[at] ?? 0;
		}
		return Readable.from([writeBmp32(layout.width, layout.height, drawn)]);
	},
});
