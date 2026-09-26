// Port of GARbro "ArcFormats/BlackCyc/ImageDWQ.cs" (tag "DWQ", classes DwqFormat, ResourceHeader,
// DwqBmpReader), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
// A DWQ picture is a 0x40 byte text header that names how the picture behind it stands.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { readPngImage } from "../shared/png-image.js";
import {
	readBmpMetaData,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
	RGB565_MASKS,
} from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x40;
const BMP_HEAD_SIZE = 0x36;
const MAX_COLORS = 0x100;
/** The text header names the kind of the picture behind it, of the sixteenth byte on. */
const PACK_TYPE = /^PACKTYPE=(\d+)(A?) +$/;
const IF_PACK_TYPE = "IF PACKTYPE==";
const IF_BMP = "BMP ";

export interface DwqLayout {
	/** The kind of the picture behind the header: 0 BMP, 1 packed BMP, 2 BMP and mask, 3 packed BMP
	 * and mask, 5 JPEG, 7 JPEG and mask, 8 PNG. */
	packType: number;
	hasAlpha: boolean;
	width: number;
	height: number;
	bitsPerPixel: number;
	baseType: string;
	packedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `ResourceHeader.Read`: the text header of the picture. */
function readHeader(
	data: Buffer,
): { bytes: Buffer; packType: number; aType: boolean } | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const bytes = data.subarray(0, HEAD_SIZE);
	const text = bytes.subarray(0x30, HEAD_SIZE).toString("latin1");
	const match = PACK_TYPE.exec(text);
	if (!match) return undefined;
	const packType = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(packType)) return undefined;
	return { bytes, packType, aType: (match[2] ?? "").length > 0 };
}

/** `DwqFormat.ReadMetaData`. */
export function readDwqLayout(data: Buffer): DwqLayout | undefined {
	const header = readHeader(data);
	if (!header) return undefined;
	if (
		IF_PACK_TYPE ===
		header.bytes.subarray(0, IF_PACK_TYPE.length).toString("latin1")
	) {
		if (
			"0 " !== header.bytes.subarray(0x0d, 0x0f).toString("latin1") ||
			IF_BMP !== header.bytes.subarray(0x2c, 0x30).toString("latin1") ||
			(0 !== header.packType && 1 !== header.packType)
		) {
			return undefined;
		}
		const info = readBmpMetaData(data.subarray(HEAD_SIZE));
		if (!info) return undefined;
		return {
			packType: header.packType,
			hasAlpha: header.aType,
			width: info.width,
			height: info.height,
			bitsPerPixel: info.bitsPerPixel,
			baseType: "BMP",
			packedSize: data.length - HEAD_SIZE,
		};
	}
	let packedSize: number;
	switch (header.packType) {
		case 0:
		case 5:
		case 8:
			packedSize = data.length - HEAD_SIZE;
			break;
		case 2:
		case 3:
		case 7:
			if (data.length < HEAD_SIZE) return undefined;
			packedSize = data.readInt32LE(0x20);
			break;
		default:
			return undefined;
	}
	if (packedSize < 0 || HEAD_SIZE + packedSize > data.length) return undefined;
	return {
		packType: header.packType,
		hasAlpha: header.aType || 7 === header.packType || 3 === header.packType,
		width: header.bytes.readUInt32LE(0x24),
		height: header.bytes.readUInt32LE(0x28),
		bitsPerPixel: 32,
		baseType: header.bytes
			.subarray(0, 0x10)
			.toString("latin1")
			.replace(/\s+$/, ""),
		packedSize,
	};
}

/** The colours of a picture, of the count the head of it names. */
function readPalette(
	data: Buffer,
	at: number,
	declared: number,
	fallback: number,
): Buffer {
	const colors = Math.min(declared, MAX_COLORS);
	const count = 0 === colors ? fallback : colors;
	if (at + count * 4 > data.length) {
		throw invalidPicture("The colours of the picture stand short of the file");
	}
	const palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
	data.copy(palette, 0, at, at + count * 4);
	return palette;
}

/** The places of a picture of a bitmap of the file itself, read of the head of it. */
function readPlainPixels(
	data: Buffer,
	width: number,
	height: number,
): { pixels: Buffer; bitsPerPixel: number; stride: number; palette: Buffer } {
	if (data.length < BMP_HEAD_SIZE)
		throw invalidPicture("The head of the picture is cut short");
	const head = data.subarray(0, BMP_HEAD_SIZE);
	if (head.readInt32LE(0x12) !== width || head.readInt32LE(0x16) !== height) {
		throw invalidPicture("The head of the picture names another picture");
	}
	const bitsPerPixel = head.readUInt16LE(0x1c);
	if (
		8 !== bitsPerPixel &&
		16 !== bitsPerPixel &&
		24 !== bitsPerPixel &&
		32 !== bitsPerPixel
	) {
		throw invalidPicture(
			"The picture stands of a depth of places this project does not read",
		);
	}
	let palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
	let at = BMP_HEAD_SIZE;
	if (8 === bitsPerPixel) {
		palette = readPalette(data, at, head.readInt32LE(0x2e), 0);
		at += Math.min(head.readInt32LE(0x2e), MAX_COLORS) * 4;
	}
	const stride = (width * (bitsPerPixel / 8) + 3) & ~3;
	if (at + stride * height > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	const pixels = Buffer.from(data.subarray(at, at + stride * height));
	// The bitmap behind the header of this engine stands of its colours the other way round.
	if (bitsPerPixel >= 24) {
		const size = bitsPerPixel / 8;
		for (let row = 0; row < pixels.length; row += stride) {
			for (let place = 2; place < stride; place += size) {
				const swap = pixels[row + place] ?? 0;
				pixels[row + place] = pixels[row + place - 2] ?? 0;
				pixels[row + place - 2] = swap;
			}
		}
	}
	return { pixels, bitsPerPixel, stride, palette };
}

/** `DwqBmpReader`: the places of a picture of the runs of the file and of the row above them. */
function readPackedPixels(
	data: Buffer,
	width: number,
	height: number,
): { pixels: Buffer; bitsPerPixel: number; stride: number; palette: Buffer } {
	if (data.length < BMP_HEAD_SIZE)
		throw invalidPicture("The head of the picture is cut short");
	const head = data.subarray(0, BMP_HEAD_SIZE);
	if (
		head.readInt32LE(0x12) !== width ||
		Math.abs(head.readInt32LE(0x16)) !== height
	) {
		throw invalidPicture("The head of the picture names another picture");
	}
	const bitsPerPixel = head.readUInt16LE(0x1c);
	if (
		8 !== bitsPerPixel &&
		16 !== bitsPerPixel &&
		24 !== bitsPerPixel &&
		32 !== bitsPerPixel
	) {
		throw invalidPicture(
			"The picture stands of a depth of places this project does not read",
		);
	}
	// The rows of a packed picture stand of the places of it and of no padding of their own.
	const stride = width * (bitsPerPixel / 8);
	let palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
	let at = BMP_HEAD_SIZE;
	if (8 === bitsPerPixel) {
		const declared = head.readInt32LE(0x2e);
		palette = readPalette(data, at, declared, MAX_COLORS);
		at +=
			(0 === Math.min(declared, MAX_COLORS)
				? MAX_COLORS
				: Math.min(declared, MAX_COLORS)) * 4;
	}
	let position = head.readUInt32LE(0x0a);
	const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
	const previous: Buffer = Buffer.alloc(stride, 0x00);
	for (let row = 0; row < height; row += 1) {
		let place = 0;
		while (place < stride) {
			if (position >= data.length)
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			const value = data[position] ?? 0;
			position += 1;
			if (0 !== value) {
				pixels[row * stride + place] = value;
				place += 1;
				continue;
			}
			if (position >= data.length)
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			const count = data[position] ?? 0;
			position += 1;
			// The reference would stand of a run of no places for ever where the count stands of nought.
			if (0 === count)
				throw invalidPicture("The runs of the picture name no places at all");
			if (place + count > stride)
				throw invalidPicture(
					"The runs of the picture stand beyond the row of it",
				);
			place += count;
		}
		for (let column = 0; column < stride; column += 1) {
			const at2 = row * stride + column;
			const value = (pixels[at2] ?? 0) ^ (previous[column] ?? 0);
			pixels[at2] = value;
			previous[column] = value;
		}
	}
	return { pixels, bitsPerPixel, stride, palette };
}

/** The places of a picture of a bitmap handed over as a bitmap of this project. */
/** The places of a picture of this engine as the walks below them unfold them. */
interface DwqPlaces {
	pixels: Buffer;
	bitsPerPixel: number;
	stride: number;
	palette: Buffer;
}

function pictureOf(places: DwqPlaces, width: number, height: number): Buffer {
	if (8 === places.bitsPerPixel) {
		return writeBmp8Palette(width, height, places.pixels, places.palette);
	}
	if (16 === places.bitsPerPixel) {
		return writeBmp16(width, height, places.pixels, false, RGB565_MASKS);
	}
	if (24 === places.bitsPerPixel) {
		return writeBmp24(
			width,
			height,
			unpadded(places.pixels, places.stride, width * 3, height),
		);
	}
	return writeBmp32(
		width,
		height,
		unpadded(places.pixels, places.stride, width * 4, height),
	);
}

function unpadded(
	packed: Buffer,
	stride: number,
	rowLength: number,
	height: number,
): Buffer {
	if (stride === rowLength) return packed;
	const tight: Buffer = Buffer.alloc(rowLength * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		packed.copy(tight, row * rowLength, row * stride, row * stride + rowLength);
	}
	return tight;
}

/** The places of a picture of every one of them standing of four places, of the colours of it. */
function toBgra(places: DwqPlaces, width: number, height: number): Buffer {
	const pixels: Buffer = Buffer.alloc(width * 4 * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		let source = row * places.stride;
		let destination = row * width * 4;
		for (let column = 0; column < width; column += 1) {
			if (8 === places.bitsPerPixel) {
				const index = places.pixels[source] ?? 0;
				source += 1;
				pixels[destination] = places.palette[index * 4] ?? 0;
				pixels[destination + 1] = places.palette[index * 4 + 1] ?? 0;
				pixels[destination + 2] = places.palette[index * 4 + 2] ?? 0;
			} else if (16 === places.bitsPerPixel) {
				const value =
					(places.pixels[source] ?? 0) |
					((places.pixels[source + 1] ?? 0) << 8);
				source += 2;
				const red = (value >> 11) & 0x1f;
				const green = (value >> 5) & 0x3f;
				const blue = value & 0x1f;
				pixels[destination] = (blue << 3) | (blue >> 2);
				pixels[destination + 1] = (green << 2) | (green >> 4);
				pixels[destination + 2] = (red << 3) | (red >> 2);
			} else {
				pixels[destination] = places.pixels[source] ?? 0;
				pixels[destination + 1] = places.pixels[source + 1] ?? 0;
				pixels[destination + 2] = places.pixels[source + 2] ?? 0;
				source += 32 === places.bitsPerPixel ? 4 : 3;
			}
			destination += 4;
		}
	}
	return pixels;
}

/**
 * `DwqFormat.Read`: the picture behind the header, of the kind the header names. A picture of a mask
 * stands of the places of the picture behind it and of the mask behind the picture.
 */
export async function unpackDwqPicture(
	data: Buffer,
	layout: DwqLayout,
): Promise<Buffer> {
	const { width, height } = layout;
	if (0 === width || 0 === height)
		throw invalidPicture("The picture stands of no places of its own");
	const body = data.subarray(HEAD_SIZE, HEAD_SIZE + layout.packedSize);
	let places: DwqPlaces | undefined;
	let picture: Buffer;
	if (5 === layout.packType || 7 === layout.packType) {
		// `DwqFormat.Read` hands the run of these two kinds of picture to the decoder of the platform and
		// returns where the header names no mask; a picture of the kind with a mask has the channel of the
		// mask laid over the places of that picture. This port reads the run with its own reader of the JPEG
		// interchange format and walks the frame with the row length of the header of the picture, so a frame
		// larger than the header keeps the places of the picture itself alone, as it does in the other
		// readers of this project.
		if (!readJpegHeaderFields(body)) {
			throw invalidPicture(
				"The places of the picture stand of no walks of a JPEG",
			);
		}
		const jpeg = readJpegImage(body);
		if (jpeg.width < width || jpeg.height < height) {
			throw invalidPicture(
				"The places of the picture stand short of the head of it",
			);
		}
		const frameStride = jpeg.width * 4;
		const frame: Buffer = Buffer.alloc(width * height * 4, 0x00);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const src = y * frameStride + x * 4;
				const dst = (y * width + x) * 4;
				frame[dst] = jpeg.pixels[src] ?? 0;
				frame[dst + 1] = jpeg.pixels[src + 1] ?? 0;
				frame[dst + 2] = jpeg.pixels[src + 2] ?? 0;
				frame[dst + 3] = 0xff;
			}
		}
		if (5 === layout.packType) return writeBmp32(width, height, frame);
		places = {
			pixels: frame,
			bitsPerPixel: 32,
			stride: width * 4,
			palette: Buffer.alloc(0),
		};
	} else if (8 === layout.packType) {
		const image = await readPngImage(body);
		if (!image)
			throw invalidPicture(
				"The picture behind the header stands of no picture of its own",
			);
		const pixels: Buffer = Buffer.alloc(width * 4 * height, 0x00);
		for (let at = 0; at < width * height; at += 1) {
			const source = at * (image.bitsPerPixel / 8);
			pixels[at * 4] = image.pixels[source] ?? 0;
			pixels[at * 4 + 1] = image.pixels[source + 1] ?? 0;
			pixels[at * 4 + 2] = image.pixels[source + 2] ?? 0;
			pixels[at * 4 + 3] =
				32 === image.bitsPerPixel ? (image.pixels[source + 3] ?? 0) : 0xff;
		}
		return writeBmp32(width, height, pixels);
	}
	if (!places) {
		places =
			0 === layout.packType || 2 === layout.packType
				? readPlainPixels(body, width, height)
				: readPackedPixels(body, width, height);
	}
	if (!layout.hasAlpha) return pictureOf(places, width, height);

	const maskOffset = HEAD_SIZE + layout.packedSize;
	if (maskOffset === data.length) return pictureOf(places, width, height);
	const mask = readPackedPixels(data.subarray(maskOffset), width, height);
	if (8 !== mask.bitsPerPixel) return pictureOf(places, width, height);
	const alpha: Buffer = Buffer.alloc(width * height, 0x00);
	for (let at = 0; at < alpha.length; at += 1) {
		const color = mask.pixels[at] ?? 0;
		// The colour of the mask names the alpha of the place of the picture behind it.
		alpha[at] = Math.trunc(
			((mask.palette[color * 4] ?? 0) +
				(mask.palette[color * 4 + 1] ?? 0) +
				(mask.palette[color * 4 + 2] ?? 0)) /
				3,
		);
	}
	picture = toBgra(places, width, height);
	// The places of the mask of an eight place picture stand of the places of the picture itself.
	for (let at2 = 0; at2 < alpha.length; at2 += 1) {
		picture[at2 * 4 + 3] = alpha[at2] ?? 0;
	}
	return writeBmp32(width, height, picture);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const blackCycDwqImageDescriptor: FormatDescriptor = {
	id: "black-cyc-dwq-image",
	name: "Black Cyc image",
	extensions: ["dwq"],
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
			source: "ArcFormats/BlackCyc/ImageDWQ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blackCycDwqImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackCycDwqImageDescriptor,
	// The reference registers the heads of the pictures behind the header of it, which stand of no
	// word of their own beyond the text header.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readDwqLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readDwqLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Black Cyc engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: 1 === layout.packType || 3 === layout.packType,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					packType: layout.packType,
					baseType: layout.baseType,
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
		const layout = readDwqLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Black Cyc engine");
		return Readable.from([await unpackDwqPicture(data, layout)]);
	},
});
