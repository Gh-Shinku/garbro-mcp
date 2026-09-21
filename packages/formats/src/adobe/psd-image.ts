// Format reference: GARBro "ArcFormats/Adobe/ImagePSD.cs", class `PsdFormat` with the `PsdReader` that
// unpacks through it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp1, writeBmp24, writeBmp32, writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** '8BPS', and the header the metadata stands in. */
const SIGNATURE = Buffer.from("8BPS", "latin1");
const HEADER_SIZE = 0x1a;
const VERSION_FIELD = 4;
const CHANNELS_FIELD = 0x0c;
const HEIGHT_FIELD = 0x0e;
const WIDTH_FIELD = 0x12;
const DEPTH_FIELD = 0x16;
const MODE_FIELD = 0x18;
const MAXIMUM_CHANNELS = 56;
const MAXIMUM_DIMENSION = 30000;
/** The colour modes, of which the reference reads three. */
const MODE_BITMAP = 0;
const MODE_GREYSCALE = 1;
const MODE_RGB = 3;
/** The two kinds of compression the reference unpacks. */
const COMPRESSION_NONE = 0;
const COMPRESSION_RLE = 1;
/** Which of the four output bytes each stored channel takes: the file keeps red first. */
const CHANNEL_MAP = [2, 1, 0, 3];
const OUTPUT_CHANNELS = 4;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;
/** The black and white a bitmap mode is shown in, as a bitmap palette wants it. */
const BITMAP_PALETTE = Buffer.from([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);

export interface PsdLayout {
	width: number;
	height: number;
	channels: number;
	bitsPerChannel: number;
	mode: number;
	/** The bytes one channel of the picture takes, as the reference works it out. */
	channelSize: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedFeature(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `PsdFormat.ReadMetaData`: the file opens with `8BPS`, the version must be one, and the header holds the
 * number of channels, the height and the width -- both of which the reference caps at thirty thousand -- the
 * depth of a channel and the colour mode. The depth the picture reports is the channels times the depth of
 * one of them, which is how the reference works out whether a palette stands in front of the pixels.
 */
export function readPsdLayout(data: Buffer): PsdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (1 !== data.readInt16BE(VERSION_FIELD)) return undefined;
	const channels = data.readInt16BE(CHANNELS_FIELD);
	if (channels < 1 || channels > MAXIMUM_CHANNELS) return undefined;
	const height = data.readUInt32BE(HEIGHT_FIELD);
	const width = data.readUInt32BE(WIDTH_FIELD);
	if (
		width < 1 ||
		width > MAXIMUM_DIMENSION ||
		height < 1 ||
		height > MAXIMUM_DIMENSION
	) {
		return undefined;
	}
	const bitsPerChannel = data.readInt16BE(DEPTH_FIELD);
	if (bitsPerChannel < 1) return undefined;
	const channelSize = Math.trunc((height * width * bitsPerChannel) / 8);
	if (channelSize <= 0 || channels * channelSize > LIMIT) return undefined;
	return {
		width,
		height,
		channels,
		bitsPerChannel,
		mode: data.readInt16BE(MODE_FIELD),
		channelSize,
	};
}

/** What unpacking a picture yields: the bytes, and how a bitmap is to be written out of them. */
export interface PsdPicture {
	kind: "bgr24" | "bgra32" | "grey8" | "bitmap1";
	pixels: Buffer;
	palette: Buffer | undefined;
}

/**
 * `PsdReader.UnpackRLE`: the lengths of the packed rows stand first, one big endian word to a row of every
 * channel in turn, and the rows themselves follow in the same order. A row is a run of control bytes: one
 * from nothing to one hundred and twenty seven stands for that many plus one bytes as they are, and one below
 * nothing stands for `1 - count` copies of the byte behind it.
 *
 * The reference reads a control byte of `-128` as neither and loops on it for ever, so that byte is refused
 * here; a run that would carry a row past its own length is refused as well.
 */
function unpackPsdRle(data: Buffer, layout: PsdLayout, start: number): Buffer {
	const rows = layout.channels * layout.height;
	const lengths: number[] = [];
	let at = start;
	if (at + rows * 2 > data.length) {
		throw invalidImage("The row lengths of the picture are cut short");
	}
	for (let row = 0; row < rows; row += 1) {
		lengths.push(data.readInt16BE(at));
		at += 2;
	}
	const pixels: Buffer = Buffer.alloc(
		layout.channels * layout.channelSize,
		0x00,
	);
	let target = 0;
	for (let row = 0; row < rows; row += 1) {
		const rowEnd = at + (lengths[row] ?? 0);
		if (rowEnd > data.length) {
			throw invalidImage("A packed row of the picture is cut short");
		}
		while (at < rowEnd) {
			const control = data.readInt8(at);
			at += 1;
			if (control >= 0) {
				const count = control + 1;
				if (target + count > pixels.length) {
					throw invalidImage("A run of the picture outgrows it");
				}
				data.copy(pixels, target, at, at + count);
				at += count;
				target += count;
				continue;
			}
			if (-128 === control) {
				throw invalidImage("The picture carries a run that cannot be read");
			}
			const count = 1 - control;
			const value = data[at];
			if (undefined === value) {
				throw invalidImage("A packed row of the picture is cut short");
			}
			at += 1;
			if (target + count > pixels.length) {
				throw invalidImage("A run of the picture outgrows it");
			}
			pixels.fill(value, target, target + count);
			target += count;
		}
	}
	return pixels;
}

/**
 * `PsdReader.Unpack`: behind the header stand the colour mode data, the image resources and the layer and
 * mask information, each introduced by its own length, and the pixels begin with the word that names their
 * compression. The stored channels run one behind the other and the picture is written out of them channel by
 * channel: the file keeps red first, and a bitmap keeps blue first, which is the one order the reference
 * turns around.
 */
export function decodePsd(data: Buffer, layout: PsdLayout): PsdPicture {
	const bpc = layout.bitsPerChannel;
	let kind: PsdPicture["kind"];
	if (MODE_RGB === layout.mode) {
		if (8 !== bpc) throw unsupportedFeature("A PSD with this channel depth");
		if (layout.channels < 3)
			throw unsupportedFeature("A PSD with fewer than three channels");
		kind = 3 === layout.channels ? "bgr24" : "bgra32";
	} else if (MODE_GREYSCALE === layout.mode) {
		if (8 !== bpc) throw unsupportedFeature("A greyscale PSD of this depth");
		kind = "grey8";
	} else if (MODE_BITMAP === layout.mode) {
		if (1 !== bpc) throw unsupportedFeature("A bitmap PSD of this depth");
		kind = "bitmap1";
	} else {
		throw unsupportedFeature(`PSD colour mode ${layout.mode}`);
	}

	let at = HEADER_SIZE;
	const section = (): number => {
		if (at + 4 > data.length) {
			throw invalidImage("A section of the picture is cut short");
		}
		const length = data.readInt32BE(at);
		if (length < 0 || at + 4 + length > data.length) {
			throw invalidImage("A section of the picture is cut short");
		}
		const body = at + 4;
		at = body + length;
		return body;
	};
	// The colour mode data, which the reference reads a palette out of for the modes this port writes and
	// then leaves aside; then the image resources, and the layer and mask information.
	section();
	section();
	section();
	if (at + 2 > data.length) {
		throw invalidImage("The picture ends before its pixels");
	}
	const compression = data.readInt16BE(at);
	at += 2;
	let pixels: Buffer;
	if (COMPRESSION_NONE === compression) {
		if (data.length - at < layout.channels * layout.channelSize) {
			throw invalidImage("The pixels of the picture are cut short");
		}
		// The reference reads whatever is left, which for a bitmap of one bit a pixel is more than the
		// channel size it worked out from the header, since a row is rounded up to whole bytes.
		pixels = Buffer.from(data.subarray(at));
	} else if (COMPRESSION_RLE === compression) {
		pixels = unpackPsdRle(data, layout, at);
	} else {
		throw unsupportedFeature(`PSD compression ${compression}`);
	}
	if (1 === layout.channels) {
		return { kind, pixels, palette: undefined };
	}
	const channels = Math.min(OUTPUT_CHANNELS, layout.channels);
	const output: Buffer = Buffer.alloc(channels * layout.channelSize, 0x00);
	let source = 0;
	for (let channel = 0; channel < channels; channel += 1) {
		let target = CHANNEL_MAP[channel] ?? 0;
		for (let index = 0; index < layout.channelSize; index += 1) {
			output[target] = pixels[source] ?? 0;
			source += 1;
			target += channels;
		}
	}
	return { kind, pixels: output, palette: undefined };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function bitsPerPixelOf(layout: PsdLayout): number {
	if (MODE_BITMAP === layout.mode) return 1;
	if (MODE_GREYSCALE === layout.mode) return 8;
	return 3 === layout.channels ? 24 : 32;
}

export const adobePsdImageDescriptor: FormatDescriptor = {
	id: "adobe-psd-image",
	name: "Adobe Photoshop image",
	extensions: ["psd"],
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
			source: "ArcFormats/Adobe/ImagePSD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const adobePsdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: adobePsdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readPsdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPsdLayout(stored);
		if (!layout) {
			throw invalidImage("Not a Photoshop picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: bitsPerPixelOf(layout),
				},
			}),
			// The picture is reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: bitsPerPixelOf(layout),
				channels: layout.channels,
				mode: layout.mode,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPsdLayout(stored);
		if (!layout) {
			throw invalidImage("Not a Photoshop picture");
		}
		const picture = decodePsd(stored, layout);
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		switch (picture.kind) {
			case "bgr24":
				return Readable.from([
					writeBmp24(layout.width, layout.height, picture.pixels, false),
				]);
			case "bgra32":
				return Readable.from([
					writeBmp32(layout.width, layout.height, picture.pixels, false),
				]);
			case "grey8":
				return Readable.from([
					writeBmp8(layout.width, layout.height, picture.pixels, false),
				]);
			default:
				return Readable.from([
					writeBmp1(
						layout.width,
						layout.height,
						picture.pixels,
						BITMAP_PALETTE,
						false,
					),
				]);
		}
	},
});
