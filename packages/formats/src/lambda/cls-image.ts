// Format reference: GARBro "ArcFormats/Lambda/ImageCLS.cs", class `ClsFormat` with the `ClsReader` beside it.
// The container of the same engine (`ArcCLS.cs`, the `DAT/CLS` archive) is ported as `lambda-cls` and claims
// the same word of its own, so this format stands behind it: a caller that knows a file is one texture asks
// for this one by name. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word the texture opens with, and the longer mark the reference reads behind it. */
const SIGNATURE = Buffer.from("CLS_", "latin1");
const MARK = Buffer.from("CLS_TEXFILE", "latin1");
const MARK_SIZE = 0x18;
/** Where the head names the place that names the frame. */
const FRAME_POINTER_FIELD = 0x14;
/** The frame's own head, counted from the place it stands at. */
const FRAME_VERSION_FIELD = 4;
const FRAME_VERSION = 1;
const WIDTH_FIELD = 0x1c;
const HEIGHT_FIELD = 0x20;
const OFFSET_X_FIELD = 0x24;
const OFFSET_Y_FIELD = 0x28;
const COMPRESSED_FIELD = 0x30;
const FORMAT_FIELD = 0x31;
/** The three depths the reference knows, as the byte that names them. */
const FORMATS = new Map([
	[2, 8],
	[4, 24],
	[5, 32],
]);
/** Where the channels of a frame stand, how long they are, and where an eight bit one keeps its colours. */
const CHANNEL_OFFSETS = 0x48;
const CHANNEL_SIZES = 0x58;
const PALETTE_OFFSET = 0x68;
// The length of the colour map follows the place it stands at, which the reader takes in turn.
const PALETTE_ENTRY_SIZE = 4;
/** The three ways a channel is stored, and the two bytes that name the packed ones. */
const METHOD_STORED = 0;
const METHOD_PACKED = 1;
const RLE_LITERAL_LIMIT = 0x81;
const RLE_RUN_BIAS = 0x101;
const RLE_LITERAL_BIAS = 1;
/** Which byte of a pixel every channel of the picture lands in. */
const CHANNEL_ORDER = [2, 1, 0, 3];
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface ClsLayout {
	/** The place the frame's own head stands at. */
	frameOffset: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	channels: number;
	compressed: boolean;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function field(data: Buffer, at: number): number {
	if (at + 4 > data.length)
		throw invalidImage("The picture ends inside its head");
	return data.readUInt32LE(at);
}

/**
 * `ClsFormat.ReadMetaData`: the texture opens with its own longer mark, and the head names a place that names
 * the frame in turn. The frame's head holds the version, which has to be one, the size and the place of the
 * picture on a larger canvas, whether the channels are packed, and the byte that names the depth behind the
 * three the reference knows - eight, twenty four and thirty two bits.
 */
export function readClsLayout(data: Buffer): ClsLayout | undefined {
	if (data.length < MARK_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const pointer = field(data, FRAME_POINTER_FIELD);
	if (pointer + 4 > data.length) return undefined;
	const frameOffset = data.readInt32LE(pointer);
	if (frameOffset < 0 || frameOffset + FORMAT_FIELD + 1 > data.length) {
		return undefined;
	}
	if (data.readUInt16LE(frameOffset + FRAME_VERSION_FIELD) !== FRAME_VERSION) {
		return undefined;
	}
	const width = field(data, frameOffset + WIDTH_FIELD);
	const height = field(data, frameOffset + HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	const bitsPerPixel = FORMATS.get(data[frameOffset + FORMAT_FIELD] ?? 0);
	if (undefined === bitsPerPixel) return undefined;
	return {
		frameOffset,
		width,
		height,
		offsetX: data.readInt32LE(frameOffset + OFFSET_X_FIELD),
		offsetY: data.readInt32LE(frameOffset + OFFSET_Y_FIELD),
		bitsPerPixel,
		channels: bitsPerPixel / 8,
		compressed: 0 !== data[frameOffset + COMPRESSED_FIELD],
	};
}

/** A reader over the picture's own bytes, whose every read is bounded by them. */
class ClsReader {
	private at = 0;

	constructor(private readonly data: Buffer) {}

	seek(at: number): void {
		this.at = at;
	}

	/** The next bytes of the picture, which no read may reach past. */
	readBytes(count: number): Buffer {
		if (count < 0 || this.at + count > this.data.length) {
			throw invalidImage("The picture ends inside one of its channels");
		}
		const bytes = this.data.subarray(this.at, this.at + count);
		this.at += count;
		return bytes;
	}

	readUInt8(): number {
		return this.readBytes(1)[0] ?? 0;
	}

	readInt32(): number {
		if (this.at + 4 > this.data.length) {
			throw invalidImage("The picture ends inside one of its channels");
		}
		const value = this.data.readInt32LE(this.at);
		this.at += 4;
		return value;
	}

	/** The word the packed channels open with, which is stored most significant byte first. */
	readUInt16BE(): number {
		const bytes = this.readBytes(2);
		return ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
	}

	readInto(destination: Buffer, offset: number, count: number): void {
		this.readBytes(count).copy(destination, offset);
	}
}

/**
 * `ClsReader.ReadV0`: a channel whose rows are stored as they stand. When a row is narrower than the picture
 * the rest of it is left as the channel was, which is how the reference leaves it - the place is filled once
 * and used for every channel of the picture.
 */
function readStoredChannel(
	reader: ClsReader,
	destination: Buffer,
	size: number,
	width: number,
	height: number,
): void {
	const rowWidth = Math.trunc(size / height);
	if (rowWidth === width) {
		reader.readInto(destination, 0, width * height);
		return;
	}
	let at = 0;
	for (let row = 0; row < height; row += 1) {
		reader.readInto(destination, at, Math.max(0, Math.min(rowWidth, width)));
		at += width;
	}
}

/**
 * `ClsReader.ReadV1`: the rows of a channel are cut into chunks whose lengths stand **first**, one after
 * another, with the bodies of the chunks behind them - which is what the reference's own first walk implies,
 * since it reads a length and then steps on by two bytes alone while counting the body into the length of the
 * channel. A row is packed with two kinds of run, a count of bytes that stand as they are and a count of one
 * byte written over and over, and a row shorter than the picture is filled with nothing. The reference
 * records the lengths of the first `height` chunks and unpacks those alone, so the bodies behind them are
 * never read.
 */
function readPackedChannel(
	reader: ClsReader,
	destination: Buffer,
	size: number,
	width: number,
	height: number,
): void {
	const rowSizes: number[] = [];
	let left = size;
	while (left > 0) {
		const chunkSize = reader.readUInt16BE();
		if (rowSizes.length < height) rowSizes.push(chunkSize);
		left -= chunkSize + 2;
	}
	if (left < 0)
		throw invalidImage("A chunk of the picture is longer than its channel");
	let at = 0;
	for (const chunkSize of rowSizes) {
		let budget = chunkSize;
		let room = width;
		while (budget > 0) {
			const rle = reader.readUInt8();
			budget -= 1;
			if (rle < RLE_LITERAL_LIMIT) {
				const count = rle + RLE_LITERAL_BIAS;
				room -= count;
				budget -= count;
				reader.readInto(destination, at, count);
				at += count;
			} else {
				const count = RLE_RUN_BIAS - rle;
				room -= count;
				const value = reader.readUInt8();
				budget -= 1;
				for (let written = 0; written < count; written += 1) {
					if (at >= destination.length) {
						throw invalidImage("A run of the picture reaches past it");
					}
					destination[at] = value;
					at += 1;
				}
			}
			if (at > destination.length) {
				throw invalidImage("A run of the picture reaches past it");
			}
		}
		for (let filled = 0; filled < room; filled += 1) {
			if (at >= destination.length) {
				throw invalidImage("The rows of the picture reach past it");
			}
			destination[at] = 0;
			at += 1;
		}
	}
}

function readChannel(
	reader: ClsReader,
	destination: Buffer,
	size: number,
	layout: ClsLayout,
): void {
	if (!layout.compressed) {
		readStoredChannel(reader, destination, size, layout.width, layout.height);
		return;
	}
	const method = reader.readUInt16BE();
	if (method > METHOD_PACKED) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Lambda channel method ${method}`,
		);
	}
	const payload = size - 2;
	if (METHOD_STORED === method) {
		readStoredChannel(
			reader,
			destination,
			payload,
			layout.width,
			layout.height,
		);
	} else {
		readPackedChannel(
			reader,
			destination,
			payload,
			layout.width,
			layout.height,
		);
	}
}

/**
 * `ClsReader.Unpack`: the channels of the picture stand at their own places - each counted from the frame's own head, as the
 * reference's `SetPosition` counts them - and every one of them lands in
 * its own byte of a pixel - red first, then green, then blue, and the fourth where the reference puts it.
 */
export function unpackCls(
	data: Buffer,
	layout: ClsLayout,
): {
	pixels: Buffer;
	palette: Buffer | undefined;
} {
	const reader = new ClsReader(data);
	const { channels, frameOffset, width, height } = layout;
	const offsets: number[] = [];
	reader.seek(frameOffset + CHANNEL_OFFSETS);
	for (let channel = 0; channel < channels; channel += 1) {
		offsets.push(reader.readInt32());
	}
	const sizes: number[] = [];
	reader.seek(frameOffset + CHANNEL_SIZES);
	for (let channel = 0; channel < channels; channel += 1) {
		sizes.push(reader.readInt32());
	}
	const plane = width * height;
	if (1 === channels) {
		reader.seek(frameOffset + PALETTE_OFFSET);
		const paletteOffset = reader.readInt32();
		const paletteSize = reader.readInt32();
		const colours = Math.trunc(paletteSize / PALETTE_ENTRY_SIZE);
		const palette = Buffer.alloc(colours * PALETTE_ENTRY_SIZE, 0x00);
		reader.seek(frameOffset + paletteOffset);
		reader.readInto(palette, 0, palette.length);
		const channel = Buffer.alloc(plane, 0x00);
		reader.seek(frameOffset + (offsets[0] ?? 0));
		readChannel(reader, channel, sizes[0] ?? 0, layout);
		return { pixels: channel, palette };
	}
	if (!layout.compressed) {
		// The reference hands the first channel over as it stands, without drawing anything together.
		const stored = sizes[0] ?? 0;
		const needed = plane * channels;
		if (stored < needed) {
			throw invalidImage("The stored picture is shorter than the one it names");
		}
		reader.seek(frameOffset + (offsets[0] ?? 0));
		return {
			pixels: Buffer.from(reader.readBytes(needed)),
			palette: undefined,
		};
	}
	const pixels = Buffer.alloc(plane * channels, 0x00);
	// The reference fills one place of a channel and uses it for every one of them, so what a channel leaves
	// behind is what the next one reads.
	const channel = Buffer.alloc(plane, 0x00);
	for (let number = 0; number < channels; number += 1) {
		reader.seek(frameOffset + (offsets[number] ?? 0));
		readChannel(reader, channel, sizes[number] ?? 0, layout);
		const order = CHANNEL_ORDER[number];
		if (undefined === order) continue;
		for (let at = 0; at < plane; at += 1) {
			pixels[at * channels + order] = channel[at] ?? 0;
		}
	}
	return { pixels, palette: undefined };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const clsImageDescriptor: FormatDescriptor = {
	id: "lambda-cls-image",
	name: "Lambda engine texture",
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
			source: "ArcFormats/Lambda/ImageCLS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const clsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: clsImageDescriptor,
	// The archive of the same engine claims the same word, so a texture stands behind it.
	detection: { signatures: [{ bytes: SIGNATURE }], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MARK_SIZE)) return false;
		return readClsLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readClsLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Lambda engine texture");
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
			// The channels are drawn together and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				compressed: layout.compressed,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readClsLayout(stored);
		if (!layout) throw invalidImage("Not a Lambda engine texture");
		const { pixels, palette } = unpackCls(stored, layout);
		if (palette) {
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette),
			]);
		}
		if (32 === layout.bitsPerPixel) {
			return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
