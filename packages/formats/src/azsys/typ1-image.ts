// Format reference: GARbro "ArcFormats/AZSys/ImageTYP1.cs", classes `Typ1Format`, `Typ1MetaData` and the
// `Reader` inside the format (an AZ system picture of eight, twenty four or thirty two bits a pixel, whose
// pixels stand either in one compressed stream behind the head or in four streams of their own — one for
// every byte of a pixel — every one of them behind a word the head gives). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp8Palette, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'TYP1', the word the reference registers. */
const SIGNATURE = Buffer.from("TYP1", "latin1");
/** The head of a picture whose pixels stand in one stream. */
const HEADER_SIZE = 0x0e;
/** The head of a picture whose pixels stand in four streams of their own. */
const CHANNEL_HEADER_SIZE = 0x1e;
const DEPTH_FIELD = 0x04;
const PALETTE_FIELD = 0x05;
const WIDTH_FIELD = 0x06;
const HEIGHT_FIELD = 0x08;
const PACKED_SIZE_FIELD = 0x0a;
const CHANNELS_FIELD = 0x0e;
/** The colour map of an eight bit picture and the four bytes of its own checksum. */
const PALETTE_SIZE = 0x400;
const CHECKSUM_SIZE = 4;
/** How the four streams of a picture of a colour are walked: the fourth of them first and the first last. */
const STREAM_MAP = [3, 2, 1, 0];
/** Which byte of a pixel every one of those streams writes: the fourth, the first, the second and the
 *  third. */
const CHANNEL_MAP = [3, 0, 1, 2];
/** The depths the reference reads. */
const DEPTHS = [8, 24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Typ1Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	hasPalette: boolean;
	/** Whether the pixels stand in four streams of their own rather than in one. */
	separateChannels: boolean;
	/** What the head says the one stream holds, where the pixels stand in one. */
	packedSize: number;
	channels: [number, number, number, number];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Typ1Format.ReadMetaData`: the file begins with the word `TYP1`, the depth of a pixel stands at four and a
 * byte at five that names a colour map, the width and the height stand at six and eight as words, and a word
 * of four bytes at `0x0A` says what the one stream of a picture holds. Where that word, the size of the
 * colour map a picture of eight bits would carry and the fourteen bytes of the head come to the size of the
 * file, the pixels stand in one stream and the colour map is wherever the depth says it is; where they do
 * not, the pixels stand in four streams of their own and the head gives the size of every one of them at
 * `0x0E`, four bytes apart.
 */
export function readTyp1Layout(
	data: Buffer,
	fileLength = data.length,
): Typ1Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const bitsPerPixel = data[DEPTH_FIELD] ?? 0;
	const hasPaletteField = 0 !== (data[PALETTE_FIELD] ?? 0);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const packedSize = data.readUInt32LE(PACKED_SIZE_FIELD);
	const paletteSize = 8 === bitsPerPixel ? PALETTE_SIZE : 0;
	if (packedSize + paletteSize + HEADER_SIZE === fileLength) {
		return {
			width,
			height,
			bitsPerPixel,
			hasPalette: paletteSize > 0,
			separateChannels: false,
			packedSize,
			channels: [0, 0, 0, 0],
		};
	}
	if (data.length < CHANNEL_HEADER_SIZE) return undefined;
	const channels: [number, number, number, number] = [
		data.readUInt32LE(CHANNELS_FIELD),
		data.readUInt32LE(CHANNELS_FIELD + 4),
		data.readUInt32LE(CHANNELS_FIELD + 8),
		data.readUInt32LE(CHANNELS_FIELD + 12),
	];
	return {
		width,
		height,
		bitsPerPixel,
		hasPalette: hasPaletteField,
		separateChannels: true,
		packedSize,
		channels,
	};
}

/** The colour map of a picture that carries one, spread over four byte entries as a bitmap wants it. */
export function readTyp1Palette(stored: Buffer, layout: Typ1Layout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (!layout.hasPalette) return palette;
	// Where the map stands: behind the head of fourteen bytes where the pixels stand in one stream, and
	// behind the head of thirty bytes where they stand in four.
	const at = layout.separateChannels ? CHANNEL_HEADER_SIZE : HEADER_SIZE;
	stored.copy(palette, 0, at, Math.min(at + PALETTE_SIZE, stored.length));
	return palette;
}

/** What a stream of the picture holds, read as the reference reads it: what the stream gives, no more. */
async function inflateStream(
	stored: Buffer,
	at: number,
	expected: number,
): Promise<Buffer> {
	if (at > stored.length) {
		throw invalidPicture("AZ system picture is cut short of its streams");
	}
	return inflateZlibBufferCapped(stored.subarray(at), expected);
}

export interface Typ1Picture {
	pixels: Buffer;
	palette: Buffer;
	/** The depth the picture is handed out at, which is a byte a pixel or four. */
	bitsPerPixel: number;
}

/**
 * `Reader.Unpack`: a picture whose pixels stand in one stream has that stream behind the head and, where it
 * carries a colour map, behind the map; one whose pixels stand in four streams of their own has one behind
 * every word the head gives, every stream standing four bytes of its checksum behind where the one before it
 * ends. An eight bit picture reads its whole picture from the first of its streams, and a picture of a colour
 * reads one byte a pixel from every one of its four, the fourth of them writing the fourth byte of a pixel,
 * the first the first, the second the second and the third the third.
 */
export async function unpackTyp1(
	stored: Buffer,
	layout: Typ1Layout,
): Promise<Typ1Picture> {
	if (!DEPTHS.includes(layout.bitsPerPixel)) {
		throw invalidPicture("AZ system picture of an impossible colour depth");
	}
	const pixelSize = 8 === layout.bitsPerPixel ? 1 : 4;
	const plane = layout.width * layout.height;
	const pixels: Buffer = Buffer.alloc(plane * pixelSize, 0x00);
	const palette = readTyp1Palette(stored, layout);
	if (!layout.separateChannels) {
		const at = HEADER_SIZE + (layout.hasPalette ? PALETTE_SIZE : 0);
		const inflated = await inflateStream(stored, at, pixels.length);
		inflated.copy(pixels, 0, 0, Math.min(inflated.length, pixels.length));
		return { pixels, palette, bitsPerPixel: layout.bitsPerPixel };
	}
	if (8 === layout.bitsPerPixel) {
		const at =
			CHANNEL_HEADER_SIZE +
			(layout.hasPalette ? PALETTE_SIZE + CHECKSUM_SIZE : CHECKSUM_SIZE);
		const inflated = await inflateStream(stored, at, pixels.length);
		inflated.copy(pixels, 0, 0, Math.min(inflated.length, pixels.length));
		return { pixels, palette, bitsPerPixel: layout.bitsPerPixel };
	}
	let start = CHANNEL_HEADER_SIZE;
	for (let stream = 0; stream < 4; stream += 1) {
		const length = layout.channels[STREAM_MAP[stream] ?? 0] ?? 0;
		if (0 === length) continue;
		if (start + length > stored.length) {
			throw invalidPicture("AZ system picture is cut short of its streams");
		}
		const inflated = await inflateStream(stored, start + CHECKSUM_SIZE, plane);
		let dst = CHANNEL_MAP[stream] ?? 0;
		for (let index = 0; index < inflated.length; index += 1) {
			if (dst >= pixels.length) break;
			pixels[dst] = inflated[index] ?? 0;
			dst += pixelSize;
		}
		start += length;
	}
	return { pixels, palette, bitsPerPixel: layout.bitsPerPixel };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const azSysTyp1ImageDescriptor: FormatDescriptor = {
	id: "az-sys-typ1-image",
	name: "AZ system image format",
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
			source: "ArcFormats/AZSys/ImageTYP1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const azSysTyp1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azSysTyp1ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CHANNEL_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, CHANNEL_HEADER_SIZE));
			return readTyp1Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readTyp1Layout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not an AZ system picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					separateChannels: layout.separateChannels,
				},
			}),
			// The streams are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "deflate",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8 === layout.bitsPerPixel ? 8 : 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readTyp1Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an AZ system picture");
		}
		const picture = await unpackTyp1(stored, layout);
		const { width, height } = layout;
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (8 === picture.bitsPerPixel) {
			if (layout.hasPalette) {
				return Readable.from([
					writeBmp8Palette(width, height, picture.pixels, picture.palette),
				]);
			}
			return Readable.from([writeBmp8(width, height, picture.pixels)]);
		}
		return Readable.from([writeBmp32(width, height, picture.pixels)]);
	},
});
