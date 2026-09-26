// Port of GARbro "ArcFormats/Qlie/ImageARGB.cs" (tag "ARGB", class `ArgbFormat`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine opens with the mark `ARGBSaveData1` and a kind of three, and then holds two
// streams side by side: a JPEG, which carries the colours, and a portable network graphic, which carries
// one grey place a pixel as the alpha of the picture. The head names the length of each of the two streams;
// the JPEG starts at the nineteenth byte of the file and the graphic follows it directly.
//
// The reference reads the box of the picture from the JPEG and joins the two streams into a bitmap of the
// Windows imaging stack, taking the graphic as a picture of one grey place a pixel. This port decodes the
// JPEG with its own reader (`shared/jpeg-image.ts`) and the graphic with its own reader
// (`shared/png-image.ts`), and hands the two joined as a bitmap of this project.
//
// Written by the reference as unsupported: nothing. The reference's own `Write` raises, and this port
// creates no archives at all.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { readPngImage } from "../shared/png-image.js";

const SIGNATURE = Buffer.from("ARGBSaveData1\0", "latin1");
/** The kind of picture the mark stands over; the reference reads no other. */
const KIND_AT = 0x10;
const KIND = 3;
const IMAGE_LENGTH_AT = 0x11;
const MASK_LENGTH_AT = 0x15;
/** The JPEG starts here, directly behind the head. */
const IMAGE_AT = 0x19;
const HEAD_SIZE = IMAGE_AT;
const PLACES_BGRA = 4;
const BITS_BGRA = 32;

/** The brightness of a place of the graphic, taken as the grey place the reference reads it as. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
/** The count of places of a pixel of the graphic, whether it carries an alpha of its own or not. */
const PLACES_RGB = 3;

export interface ArgbLayout {
	width: number;
	height: number;
	/** The length of the JPEG, which starts at `IMAGE_AT`. */
	imageLength: number;
	/** The length of the graphic, which follows the JPEG. */
	maskLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/**
 * `ArgbFormat.ReadMetaData`: the head of the picture, whose box is the box of the JPEG it holds. The
 * reference reads the JPEG's head through its own JPEG reader and turns a stream it cannot read into an
 * unknown format; a head that names a JPEG that reaches past the end of the file is turned away here.
 */
export function readArgbLayout(data: Buffer): ArgbLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (KIND !== (data[KIND_AT] ?? 0)) return undefined;
	const imageLength = data.readUInt32LE(IMAGE_LENGTH_AT);
	const maskLength = data.readUInt32LE(MASK_LENGTH_AT);
	if (0 === imageLength) return undefined;
	if (IMAGE_AT + imageLength > data.length) return undefined;
	const fields = readJpegHeaderFields(
		data.subarray(IMAGE_AT, IMAGE_AT + imageLength),
	);
	if (!fields) return undefined;
	if (0 === fields.width || 0 === fields.height) return undefined;
	return {
		width: fields.width,
		height: fields.height,
		imageLength,
		maskLength,
	};
}

/**
 * `ArgbFormat.Read`: the colours of the JPEG with the grey places of the graphic as their alpha. The
 * reference turns away a graphic of another box than the JPEG; a graphic this project cannot read is
 * turned away here as well.
 */
export async function joinArgbPicture(
	data: Buffer,
	layout: ArgbLayout,
): Promise<Buffer> {
	const image = data.subarray(IMAGE_AT, IMAGE_AT + layout.imageLength);
	const picture = readJpegImage(image);
	if (picture.width !== layout.width || picture.height !== layout.height) {
		throw invalidPicture(
			"The head and the picture of the engine name different boxes",
		);
	}
	const maskAt = IMAGE_AT + layout.imageLength;
	const mask = await readPngImage(
		data.subarray(maskAt, maskAt + layout.maskLength),
	);
	if (!mask)
		throw invalidPicture(
			"The alpha of the picture stands in no graphic of its own",
		);
	if (mask.width !== picture.width || mask.height !== picture.height) {
		throw invalidPicture(
			"The picture of the engine and its alpha name different boxes",
		);
	}
	const places = BITS_BGRA === mask.bitsPerPixel ? PLACES_BGRA : PLACES_RGB;
	const pixels = Buffer.alloc(layout.width * layout.height * PLACES_BGRA);
	for (let place = 0; place < layout.width * layout.height; place += 1) {
		const from = place * PLACES_BGRA;
		const alphaAt = place * places;
		const red = mask.pixels[alphaAt + 2] ?? 0;
		const green = mask.pixels[alphaAt + 1] ?? 0;
		const blue = mask.pixels[alphaAt] ?? 0;
		pixels[from] = picture.pixels[from] ?? 0;
		pixels[from + 1] = picture.pixels[from + 1] ?? 0;
		pixels[from + 2] = picture.pixels[from + 2] ?? 0;
		pixels[from + 3] = Math.round(
			LUMA_RED * red + LUMA_GREEN * green + LUMA_BLUE * blue,
		);
	}
	return pixels;
}

export const qlieArgbImageDescriptor: FormatDescriptor = {
	id: "qlie-argb-image",
	name: "QLIE ARGB image",
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
			source: "ArcFormats/Qlie/ImageARGB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const qlieArgbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qlieArgbImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("ARGB", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readArgbLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readArgbLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the QLIE engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_BGRA,
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
				bitsPerPixel: BITS_BGRA,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readArgbLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the QLIE engine");
		const pixels = await joinArgbPicture(data, layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
