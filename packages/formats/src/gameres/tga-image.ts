// Format reference: GARbro "GameRes/ImageTGA.cs", classes `TgaFormat`, `TgaMetaData` and the `Reader` beside
// them (Truevision Targa). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB555_MASKS,
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 18;
const COLORMAP_TYPE_FIELD = 1;
const IMAGE_TYPE_FIELD = 2;
const COLORMAP_LENGTH_FIELD = 5;
const COLORMAP_DEPTH_FIELD = 7;
const POSITION_X_FIELD = 8;
const POSITION_Y_FIELD = 10;
const WIDTH_FIELD = 0xc;
const HEIGHT_FIELD = 0xe;
const BITS_FIELD = 0x10;
const DESCRIPTOR_FIELD = 0x11;

/** The pictures that stand of a colour map, and the ones that stand of their own colours. */
const MAPPED_TYPES = new Set([1, 9, 32, 33]);
const PLAIN_TYPES = new Set([2, 3, 10, 11]);
/** The types the reference's metadata reader takes but its reader refuses. */
const HUFMAN_TYPES = new Set([9, 32, 33]);
/** The two types whose pixels stand as runs of the bits. */
const RLE_TYPES = new Set([10, 11]);
const MAPPED_DEPTHS = new Set([24, 32]);
const DEPTHS = new Set([8, 15, 16, 24, 32]);
/** The bit of the descriptor whose set state means the rows of the picture stand the right way up already. */
const TOP_DOWN = 0x20;
/** The four bits of the descriptor naming how many alpha bits a place of a colour has. */
const ALPHA_BITS = 0x0f;
const ALPHA_8 = 8;
/** A colour map of a picture of eight bits names at most this many colours. */
const INDEXED_COLOURS = 0x100;
const LIMIT = 256 * 1024 * 1024;

export interface TgaLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	imageType: number;
	colormapType: number;
	colormapOffset: number;
	colormapFirst: number;
	colormapLength: number;
	colormapDepth: number;
	descriptor: number;
	offsetX: number;
	offsetY: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `TgaFormat.ReadMetaData`: the head of the picture, as the reference takes it and with its leniency. */
export function readTgaLayout(data: Buffer): TgaLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const colormapType = data[COLORMAP_TYPE_FIELD] ?? 0;
	if (colormapType > 1) return undefined;
	const imageType = data[IMAGE_TYPE_FIELD] ?? 0;
	const colormapDepth = data[COLORMAP_DEPTH_FIELD] ?? 0;
	if (MAPPED_TYPES.has(imageType)) {
		if (!MAPPED_DEPTHS.has(colormapDepth)) return undefined;
	} else if (!PLAIN_TYPES.has(imageType)) {
		return undefined;
	}
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (!DEPTHS.has(bitsPerPixel)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	// The reference takes a picture of no places at all and produces an empty one; this port turns it away.
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT) return undefined;
	const idLength = data[0] ?? 0;
	const colormapOffset = HEAD_SIZE + idLength;
	return {
		width,
		height,
		bitsPerPixel,
		imageType,
		colormapType,
		colormapOffset,
		colormapFirst: data.readUInt16LE(COLORMAP_LENGTH_FIELD - 2),
		colormapLength: data.readUInt16LE(COLORMAP_LENGTH_FIELD),
		colormapDepth,
		descriptor: data[DESCRIPTOR_FIELD] ?? 0,
		offsetX: data.readInt16LE(POSITION_X_FIELD),
		offsetY: data.readInt16LE(POSITION_Y_FIELD),
	};
}

/** The way a picture keeps its places, which the depth and the descriptor name together. */
interface TgaPlaces {
	kind: "indexed8" | "grey8" | "bgr555" | "bgr24" | "bgr32" | "bgra32";
	bits: number;
}

function placesOf(layout: TgaLayout): TgaPlaces {
	switch (layout.bitsPerPixel) {
		case 8:
			return 1 === layout.colormapType
				? { kind: "indexed8", bits: 8 }
				: { kind: "grey8", bits: 8 };
		case 15:
		case 16:
			return { kind: "bgr555", bits: 16 };
		case 32:
			return { kind: "bgra32", bits: 32 };
		default:
			return ALPHA_8 === (layout.descriptor & ALPHA_BITS)
				? { kind: "bgr32", bits: 32 }
				: { kind: "bgr24", bits: 24 };
	}
}

/** The colour map of a picture, read as the reference reads it: three bytes to a colour, blue first. */
function readTgaPalette(data: Buffer, layout: TgaLayout): Buffer {
	if (MAPPED_DEPTHS.has(layout.colormapDepth)) {
		if (layout.colormapLength > INDEXED_COLOURS) {
			throw invalidPicture(
				"The colour map of the picture names more colours than it holds",
			);
		}
		if (0 === layout.colormapLength) {
			throw invalidPicture(
				"The colour map of the picture names no colour at all",
			);
		}
	}
	const placeSize = Math.trunc(layout.colormapDepth / 8);
	const length = layout.colormapLength * placeSize;
	if (layout.colormapOffset + length > data.length) {
		throw invalidPicture(
			"The colour map of the picture stands past its own end",
		);
	}
	// The reference makes a colour of every entry and hands the entries to a bitmap palette, which stands of
	// four bytes each: the port keeps the three colours and leaves the fourth place empty.
	const palette: Buffer = Buffer.alloc(INDEXED_COLOURS * 4, 0x00);
	for (let index = 0; index < layout.colormapLength; index += 1) {
		palette[index * 4] = data[layout.colormapOffset + index * placeSize] ?? 0;
		palette[index * 4 + 1] =
			data[layout.colormapOffset + index * placeSize + 1] ?? 0;
		palette[index * 4 + 2] =
			data[layout.colormapOffset + index * placeSize + 2] ?? 0;
	}
	return palette;
}

/** `Reader.ReadRaw`: the places of the picture as they stand, turned the right way up if they stand that way. */
function readRaw(
	data: Buffer,
	layout: TgaLayout,
	stride: number,
	imageOffset: number,
): Buffer {
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	if (0 !== (layout.descriptor & TOP_DOWN)) {
		if (imageOffset + pixels.length > data.length) {
			throw invalidPicture("The picture stands short of the places it names");
		}
		data.copy(pixels, 0, imageOffset, imageOffset + pixels.length);
		return pixels;
	}
	for (let row = layout.height - 1; row >= 0; row -= 1) {
		if (stride > data.length - imageOffset) {
			throw invalidPicture("The picture stands short of the places it names");
		}
		data.copy(pixels, row * stride, imageOffset, imageOffset + stride);
		imageOffset += stride;
	}
	return pixels;
}

/** `Reader.ReadRLE`: the places of the picture as runs of the bits name them. */
function readRle(
	data: Buffer,
	layout: TgaLayout,
	stride: number,
	imageOffset: number,
	pixelSize: number,
): Buffer {
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let at = imageOffset;
	for (let dst = 0; dst < pixels.length; ) {
		if (at >= data.length) break;
		const packet = data[at] ?? 0;
		at += 1;
		const count = (packet & 0x7f) + 1;
		if (0 !== (packet & 0x80)) {
			if (at + pixelSize > data.length) break;
			data.copy(pixels, dst, at, at + pixelSize);
			at += pixelSize;
			const source = dst;
			dst += pixelSize;
			for (let i = 1; i < count && dst < pixels.length; i += 1) {
				pixels.copy(pixels, dst, source, source + pixelSize);
				dst += pixelSize;
			}
		} else {
			const length = count * pixelSize;
			const held = Math.min(length, Math.max(0, data.length - at));
			data.copy(pixels, dst, at, at + held);
			at += held;
			if (held !== length) break;
			dst += length;
		}
	}
	if (0 !== (layout.descriptor & TOP_DOWN)) return pixels;
	// The rows of the picture stand the other way up; the reference turns them about before it hands them over.
	const flipped: Buffer = Buffer.alloc(pixels.length, 0x00);
	let dst = 0;
	for (let row = layout.height - 1; row >= 0; row -= 1) {
		pixels.copy(flipped, dst, row * stride, row * stride + stride);
		dst += stride;
	}
	return flipped;
}

/** The places of the picture, read as the way the head names them stands. */
function unpackTga(
	data: Buffer,
	layout: TgaLayout,
	places: TgaPlaces,
): { pixels: Buffer; stride: number } {
	const stride = layout.width * Math.trunc((places.bits + 7) / 8);
	let imageOffset = layout.colormapOffset;
	if (1 === layout.colormapType) {
		imageOffset += Math.trunc(
			(layout.colormapLength * layout.colormapDepth) / 8,
		);
	}
	if (RLE_TYPES.has(layout.imageType)) {
		const pixelSize = Math.trunc((layout.bitsPerPixel + 7) / 8);
		return {
			pixels: readRle(data, layout, stride, imageOffset, pixelSize),
			stride,
		};
	}
	return { pixels: readRaw(data, layout, stride, imageOffset), stride };
}

/** `TgaFormat.Read`: the picture, handed over as a bitmap of the places it stands of. */
export function renderTgaImage(data: Buffer): Buffer {
	const layout = readTgaLayout(data);
	if (!layout) throw invalidPicture("Invalid Truevision Targa picture");
	if (HUFMAN_TYPES.has(layout.imageType)) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"A picture of this engine standing of Huffman, delta and runlength coding is not read",
		);
	}
	const places = placesOf(layout);
	const { pixels } = unpackTga(data, layout, places);
	switch (places.kind) {
		case "indexed8":
			return writeBmp8Palette(
				layout.width,
				layout.height,
				pixels,
				readTgaPalette(data, layout),
			);
		case "grey8":
			return writeBmp8(layout.width, layout.height, pixels);
		case "bgr555":
			return writeBmp16(
				layout.width,
				layout.height,
				pixels,
				false,
				RGB555_MASKS,
			);
		case "bgr24":
			return writeBmp24(layout.width, layout.height, pixels);
		default:
			return writeBmp32(layout.width, layout.height, pixels);
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresTgaImageDescriptor: FormatDescriptor = {
	id: "gameres-tga-image",
	name: "Truevision Targa image",
	extensions: ["tga"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		// The reference can write pictures; this project only takes them apart.
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "GameRes/ImageTGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresTgaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresTgaImageDescriptor,
	// The reference registers no signature of its own: the head of the picture is what decides, and a file
	// whose name does not end in `tga` is not offered it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readTgaLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readTgaLayout(await readStored(source));
		if (!layout) throw invalidPicture("Invalid Truevision Targa picture");
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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		return Readable.from([renderTgaImage(await readStored(source))]);
	},
});
