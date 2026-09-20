// Format reference: GARbro ArcFormats/Bishop/ImageBSG.cs (classes `BsgFormat` and `BsgReader`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The header the reference reads before it looks for its two marks. */
const HEADER_SIZE = 0x60;
const GRAPHICS_MARK = "BSS-Graphics\0";
const COMPOSITION_MARK = "BSS-Composition\0";
/** A composition puts one header in front of the other. */
const COMPOSITION_SIZE = 0x20;
const UNPACKED_SIZE_AT = 0x12;
const WIDTH_AT = 0x16;
const HEIGHT_AT = 0x18;
const OFFSET_X_AT = 0x20;
const OFFSET_Y_AT = 0x22;
const COLOR_MODE_AT = 0x30;
const COMPRESSION_MODE_AT = 0x31;
const DATA_OFFSET_AT = 0x32;
const DATA_SIZE_AT = 0x36;
const PALETTE_OFFSET_AT = 0x3a;
/** The three colour modes: an alpha channel, none, and a colour map. */
const MODE_BGRA = 0;
const MODE_BGR = 1;
const MODE_INDEXED = 2;
const MAXIMUM_COLOR_MODE = 2;
/** The three ways a channel is stored. */
const STORED = 0;
const RUN_CODED = 1;
const BACK_REFERENCED = 2;
const PALETTE_COLOURS = 0x100;
const PALETTE_BYTES = PALETTE_COLOURS * 4;
/** The length word and control byte the back referencing walk counts inside its own stream. */
const WALK_PREFIX = 5;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface BsgLayout {
	readonly width: number;
	readonly height: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly colorMode: number;
	readonly compressionMode: number;
	readonly dataOffset: number;
	readonly dataSize: number;
	readonly paletteOffset: number;
	readonly unpackedSize: number;
	readonly bitsPerPixel: number;
}

/** Whether a null terminated mark stands at an offset. */
function markAt(data: Buffer, at: number, mark: string): boolean {
	if (at + mark.length > data.length) return false;
	return data.toString("latin1", at, at + mark.length) === mark;
}

/** `BsgFormat.ReadMetaData`. */
export function readBsgLayout(data: Buffer): BsgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	let base = 0;
	if (markAt(data, 0, COMPOSITION_MARK)) base = COMPOSITION_SIZE;
	if (!markAt(data, base, GRAPHICS_MARK)) return undefined;
	const colorMode = data[base + COLOR_MODE_AT] ?? 0;
	if (colorMode > MAXIMUM_COLOR_MODE) return undefined;
	return {
		width: data.readUInt16LE(base + WIDTH_AT),
		height: data.readUInt16LE(base + HEIGHT_AT),
		offsetX: data.readInt16LE(base + OFFSET_X_AT),
		offsetY: data.readInt16LE(base + OFFSET_Y_AT),
		colorMode,
		compressionMode: data[base + COMPRESSION_MODE_AT] ?? 0,
		dataOffset: data.readInt32LE(base + DATA_OFFSET_AT) + base,
		dataSize: data.readInt32LE(base + DATA_SIZE_AT),
		paletteOffset: data.readInt32LE(base + PALETTE_OFFSET_AT) + base,
		unpackedSize: data.readInt32LE(base + UNPACKED_SIZE_AT),
		bitsPerPixel: MODE_INDEXED === colorMode ? 8 : 32,
	};
}

/** The bytes one output pixel takes, which is also the step a channel walks with. */
export function bsgPixelSize(layout: BsgLayout): number {
	return MODE_INDEXED === layout.colorMode ? 1 : 4;
}

function writeSample(output: Buffer, at: number, value: number): void {
	if (at < 0 || at >= output.length)
		throw invalidPicture("Bishop picture outgrew its unpacked size");
	output[at] = value & 0xff;
}

/**
 * `BsgReader.UnpackRle`: a signed count, where a count that is not negative is one more literal byte and a
 * negative one is `1 - count` copies of the byte that follows it.
 */
function decodeBsgRuns(
	data: Buffer,
	at: number,
	output: Buffer,
	destination: number,
	pixelSize: number,
): { at: number } {
	let position = at;
	if (position + 4 > data.length)
		throw invalidPicture("Bishop run coded channel has no length");
	let remaining = data.readInt32LE(position);
	position += 4;
	while (remaining > 0) {
		if (position >= data.length)
			throw invalidPicture("Bishop run coded channel ends inside a count");
		const count = data.readInt8(position);
		position += 1;
		remaining -= 1;
		if (count >= 0) {
			for (let i = 0; i <= count; i += 1) {
				if (position >= data.length)
					throw invalidPicture(
						"Bishop run coded channel ends inside its bytes",
					);
				writeSample(output, destination, data[position] ?? 0);
				position += 1;
				remaining -= 1;
				destination += pixelSize;
			}
			continue;
		}
		const copies = 1 - count;
		if (position >= data.length)
			throw invalidPicture("Bishop run coded channel ends inside a repeat");
		const value = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		for (let i = 0; i < copies; i += 1) {
			writeSample(output, destination, value);
			destination += pixelSize;
		}
	}
	return { at: position };
}

/**
 * `BsgReader.UnpackLz`: a control byte escapes a back reference of an offset and a count, and every sample
 * is then added to the one before it in its own channel.
 */
function decodeBsgReferences(
	data: Buffer,
	at: number,
	output: Buffer,
	plane: number,
	pixelSize: number,
): { at: number } {
	let position = at;
	if (position >= data.length)
		throw invalidPicture("Bishop referenced channel has no control byte");
	const control = data[position] ?? 0;
	position += 1;
	if (position + 4 > data.length)
		throw invalidPicture("Bishop referenced channel has no length");
	let remaining = data.readInt32LE(position) - WALK_PREFIX;
	position += 4;
	let destination = plane;
	while (remaining > 0) {
		if (position >= data.length)
			throw invalidPicture("Bishop referenced channel ends inside a byte");
		const code = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		let referenced = false;
		if (code === control) {
			if (position >= data.length)
				throw invalidPicture("Bishop referenced channel ends inside an escape");
			let offset = data[position] ?? 0;
			position += 1;
			remaining -= 1;
			// An escape whose offset is the control byte stands for the control byte itself.
			if (offset !== control) {
				if (position >= data.length)
					throw invalidPicture("Bishop referenced channel ends inside a count");
				const count = data[position] ?? 0;
				position += 1;
				remaining -= 1;
				if (offset > control) offset -= 1;
				offset *= pixelSize;
				for (let copy = 0; copy < count; copy += 1) {
					writeSample(output, destination, output[destination - offset] ?? 0);
					destination += pixelSize;
				}
				referenced = true;
			}
		}
		if (!referenced) {
			writeSample(output, destination, code);
			destination += pixelSize;
		}
	}
	for (let i = plane + pixelSize; i < output.length; i += pixelSize)
		output[i] = ((output[i] ?? 0) + (output[i - pixelSize] ?? 0)) & 0xff;
	return { at: position };
}

/** `BsgReader.Unpack`, which reads one channel for every colour the mode carries. */
export function decodeBsgPixels(data: Buffer, layout: BsgLayout): Buffer {
	// The three ways a channel may be stored, named one by one as the reference's own reader does.
	const known =
		STORED === layout.compressionMode ||
		RUN_CODED === layout.compressionMode ||
		BACK_REFERENCED === layout.compressionMode;
	if (!known)
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unknown Bishop picture compression ${layout.compressionMode}`,
		);
	const pixelSize = bsgPixelSize(layout);
	const output = Buffer.alloc(layout.width * layout.height * pixelSize);
	let position = layout.dataOffset;
	if (STORED === layout.compressionMode) {
		if (layout.dataSize < 0 || position + layout.dataSize > data.length)
			throw invalidPicture("Bishop picture data reaches past the file");
		if (MODE_BGR === layout.colorMode) {
			// Three byte triplets, each written into a four byte pixel whose fourth byte stays clear.
			const triplets = Math.trunc(layout.dataSize / 3);
			for (let index = 0; index < triplets; index += 1) {
				if (position + 3 > data.length)
					throw invalidPicture("Bishop picture ends inside a pixel");
				writeSample(output, index * 4, data[position] ?? 0);
				writeSample(output, index * 4 + 1, data[position + 1] ?? 0);
				writeSample(output, index * 4 + 2, data[position + 2] ?? 0);
				position += 3;
			}
			return output;
		}
		data.copy(
			output,
			0,
			position,
			position + Math.min(layout.dataSize, output.length),
		);
		return output;
	}
	const channels =
		MODE_BGRA === layout.colorMode ? 4 : MODE_BGR === layout.colorMode ? 3 : 1;
	for (let channel = 0; channel < channels; channel += 1) {
		const read =
			BACK_REFERENCED === layout.compressionMode
				? decodeBsgReferences(data, position, output, channel, pixelSize)
				: decodeBsgRuns(data, position, output, channel, pixelSize);
		position = read.at;
	}
	return output;
}

/** The colour map of a colour mapped picture, as the four byte entries a bitmap palette takes. */
export function readBsgPalette(data: Buffer, layout: BsgLayout): Buffer {
	const palette = Buffer.alloc(PALETTE_BYTES);
	if (layout.paletteOffset + PALETTE_BYTES > data.length) return palette;
	data.copy(
		palette,
		0,
		layout.paletteOffset,
		layout.paletteOffset + PALETTE_BYTES,
	);
	return palette;
}

/** `BsgFormat.Read`: the channels reach `ImageData.CreateFlipped`, so the rows are bottom up. */
export function unpackBsgPicture(data: Buffer, layout: BsgLayout): Buffer {
	const pixels = decodeBsgPixels(data, layout);
	if (MODE_INDEXED === layout.colorMode) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			pixels,
			readBsgPalette(data, layout),
			true,
		);
	}
	if (MODE_BGR === layout.colorMode) {
		// The reference calls this mode Bgr32, so the fourth byte of every pixel goes unused.
		const packed = Buffer.alloc(layout.width * layout.height * 3);
		for (let index = 0; index * 4 + 3 <= pixels.length; index += 1) {
			packed[index * 3] = pixels[index * 4] ?? 0;
			packed[index * 3 + 1] = pixels[index * 4 + 1] ?? 0;
			packed[index * 3 + 2] = pixels[index * 4 + 2] ?? 0;
		}
		return writeBmp24(layout.width, layout.height, packed, true);
	}
	return writeBmp32(layout.width, layout.height, pixels, true);
}

export const bishopBsgImageDescriptor: FormatDescriptor = {
	id: "bishop-bsg-image",
	name: "Bishop image",
	extensions: ["bsg"],
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
			source: "ArcFormats/Bishop/ImageBSG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const SIGNATURE = Buffer.from("BSS-", "latin1");

export const bishopBsgImageFormat = defineFixedArchive({
	descriptor: bishopBsgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const head = await source.readAt(0n, HEADER_SIZE);
		return readBsgLayout(head) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readBsgLayout(data);
		if (!layout) throw invalidPicture("Not a Bishop picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: 0n,
			size: source.size,
			compressed: STORED !== layout.compressionMode,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				colorMode: layout.colorMode,
				compressionMode: layout.compressionMode,
			},
		});
		return {
			entries: [entry],
			metadata: {
				width: layout.width,
				height: layout.height,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
				colorMode: layout.colorMode,
				compressionMode: layout.compressionMode,
			},
		};
	},
	async openEntry(source) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readBsgLayout(data);
		if (!layout) throw invalidPicture("Not a Bishop picture");
		return Readable.from([unpackBsgPicture(data, layout)]);
	},
});
