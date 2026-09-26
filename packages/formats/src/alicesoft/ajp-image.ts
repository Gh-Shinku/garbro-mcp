// Format reference: GARBro "ArcFormats/AliceSoft/ImageAJP.cs", class `AjpFormat`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of this engine is a keyed JPEG with a run of its own for its alpha channel. The reference
// decodes the JPEG with the decoder of the platform and lays the alpha channel over it, either out of a zlib
// stream or out of a run of its own; this port decodes the JPEG with its own reader of that format and lays
// the channel over it in the same way.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every picture of this engine opens with. */
const MARK = Buffer.from("AJP", "latin1");
/** The head of the picture, and the places its own fields stand. */
const HEADER_SIZE = 0x24;
const VERSION_AT = 4;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x10;
const IMAGE_OFFSET_AT = 0x14;
const IMAGE_SIZE_AT = 0x18;
const ALPHA_OFFSET_AT = 0x1c;
const ALPHA_SIZE_AT = 0x20;
/** The size the alpha takes once unpacked stands behind the head, of the pictures that keep one. */
const ALPHA_UNPACKED_AT = 0x24;
/** The key the first bytes of both runs are exclusive-ored with. */
const KEY = Buffer.from([
	0x5d, 0x91, 0xae, 0x87, 0x4a, 0x56, 0x41, 0xcd, 0x83, 0xec, 0x4c, 0x92, 0xb5,
	0xcb, 0x16, 0x34,
]);
/** The head of the alpha run, and the places its own fields stand. */
const MASK_HEADER_SIZE = 0x40;
const MASK_WIDTH_AT = 0x18;
const MASK_HEIGHT_AT = 0x1c;
const MASK_DATA_AT = 0x20;
const MASK_PALETTE_AT = 0x24;
/** The run tells a byte that stands as it is from the marks that follow it. */
const MASK_LITERAL = 0xf8;
const MASK_SAVED = 0xf8;
const MASK_COPY_TWO = 0xfc;
const MASK_FILL = 0xfd;
const MASK_COPY_UP_TWO = 0xfe;
const MASK_COPY_UP_ONE = 0xff;
/** The palette of the alpha run, of three bytes a colour, and the entries it is read for. */
const MASK_PALETTE_SIZE = 0x300;
const PALETTE_ENTRIES = 0x100;
const COLOUR_BYTES = 3;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface AjpLayout {
	version: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	imageOffset: number;
	imageSize: number;
	alphaOffset: number;
	alphaSize: number;
	alphaUnpacked: number;
}

export interface AjpMask {
	width: number;
	height: number;
	/** One byte a pixel, as the grey the alpha run's own palette gives. */
	pixels: Buffer;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `AjpFormat.ReadMetaData`: the head of the picture, whose version may not be below nothing. */
export function readAjpLayout(data: Buffer): AjpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, 3).equals(MARK)) return undefined;
	const version = data.readInt32LE(VERSION_AT);
	if (version < 0) return undefined;
	const width = data.readUInt32LE(WIDTH_AT);
	const height = data.readUInt32LE(HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	const total = width * height * 4;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	const layout: AjpLayout = {
		version,
		width,
		height,
		bitsPerPixel: 32,
		imageOffset: data.readUInt32LE(IMAGE_OFFSET_AT),
		imageSize: data.readUInt32LE(IMAGE_SIZE_AT),
		alphaOffset: data.readUInt32LE(ALPHA_OFFSET_AT),
		alphaSize: data.readUInt32LE(ALPHA_SIZE_AT),
		alphaUnpacked: 0,
	};
	if (version > 0) {
		if (data.length < ALPHA_UNPACKED_AT + 4) return undefined;
		layout.alphaUnpacked = data.readUInt32LE(ALPHA_UNPACKED_AT);
	}
	const limit = BigInt(data.length);
	const inside = (offset: number, size: number): boolean =>
		offset >= HEADER_SIZE &&
		(0 === size ||
			(BigInt(offset) < limit && BigInt(size) <= limit - BigInt(offset)));
	if (!inside(layout.imageOffset, layout.imageSize)) return undefined;
	if (0 !== layout.alphaOffset || 0 !== layout.alphaSize) {
		if (!inside(layout.alphaOffset, layout.alphaSize)) return undefined;
	}
	return layout;
}

/**
 * `AjpFormat.DecryptStream`: only the first sixteen bytes of a run are keyed; everything behind them stands
 * as it is.
 */
export function decryptAjpRun(
	data: Buffer,
	offset: number,
	size: number,
): Buffer {
	const out = Buffer.from(data.subarray(offset, offset + size));
	// The reference keys the whole of the sixteen byte header and then cuts the run to its own size, so
	// every byte handed over is a keyed one.
	const keyed = Math.min(KEY.length, out.length);
	for (let index = 0; index < keyed; index += 1) {
		out[index] = (out[index] ?? 0) ^ (KEY[index] ?? 0);
	}
	return out;
}

/** `AjpFormat.ReadGrayPalette`: a palette of three bytes a colour, taken down to the grey of each. */
function readGrayPalette(data: Buffer, at: number): Buffer | undefined {
	if (at + MASK_PALETTE_SIZE > data.length) return undefined;
	const grey = Buffer.alloc(PALETTE_ENTRIES, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const from = at + index * COLOUR_BYTES;
		const red = data[from] ?? 0;
		const green = data[from + 1] ?? 0;
		const blue = data[from + 2] ?? 0;
		grey[index] = Math.trunc((red + green + blue) / COLOUR_BYTES);
	}
	return grey;
}

/**
 * `AjpFormat.ReadMask`: the alpha channel is a run of its own - a byte that stands as it is, or one of five
 * marks: a byte of its own, a pair of bytes copied over and over, one byte filled over and over, and a run
 * copied from the row above or the row two above. Its palette is read afterwards and taken down to greys.
 */
export function readAjpMask(input: Buffer): AjpMask | undefined {
	if (input.length < MASK_HEADER_SIZE) return undefined;
	const width = input.readInt32LE(MASK_WIDTH_AT);
	const height = input.readInt32LE(MASK_HEIGHT_AT);
	const dataAt = input.readInt32LE(MASK_DATA_AT);
	const paletteAt = input.readInt32LE(MASK_PALETTE_AT);
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	const pixels = Buffer.alloc(width * height, 0x00);
	let dst = 0;
	let at = dataAt;
	while (dst < pixels.length) {
		if (at >= input.length) break;
		const code = input[at] ?? 0;
		at += 1;
		if (code < MASK_LITERAL) {
			pixels[dst] = code;
			dst += 1;
			continue;
		}
		if (MASK_SAVED === code) {
			pixels[dst] = input[at] ?? 0;
			dst += 1;
			at += 1;
			continue;
		}
		if (MASK_COPY_TWO === code) {
			const count = ((input[at] ?? 0) * 2 + 4) >>> 0;
			at += 1;
			pixels[dst] = input[at] ?? 0;
			pixels[dst + 1] = input[at + 1] ?? 0;
			at += 2;
			copyOverlapped(pixels, dst, dst + 2, count);
			dst += count + 2;
			continue;
		}
		if (MASK_FILL === code) {
			const count = (input[at] ?? 0) + 4;
			at += 1;
			const value = input[at] ?? 0;
			at += 1;
			for (let index = 0; index < count && dst < pixels.length; index += 1) {
				pixels[dst] = value;
				dst += 1;
			}
			continue;
		}
		if (MASK_COPY_UP_TWO === code || MASK_COPY_UP_ONE === code) {
			const count = (input[at] ?? 0) + 3;
			at += 1;
			const from = dst - width * (MASK_COPY_UP_TWO === code ? 2 : 1);
			if (from < 0) return undefined;
			copyOverlapped(pixels, from, dst, count);
			dst += count;
			continue;
		}
		return undefined;
	}
	const grey = readGrayPalette(input, paletteAt);
	if (!grey) return undefined;
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = grey[pixels[index] ?? 0] ?? 0;
	}
	return { width, height, pixels };
}

/**
 * The alpha channel of the picture: the zlib stream the head stands of a count of the places of, or the run
 * of its own where the head names none. `ReadMask` lays the palette of the run over the bytes it stands for.
 */
async function readAjpAlpha(
	stored: Buffer,
	layout: AjpLayout,
): Promise<Buffer> {
	const run = decryptAjpRun(stored, layout.alphaOffset, layout.alphaSize);
	if (0 !== layout.alphaUnpacked) {
		// The reference reads the stream into a buffer of the count of the places the head names, so a
		// stream that stands short of that count leaves the places behind it at nought.
		const unpacked = await inflateZlibBuffer(run);
		const alpha = Buffer.alloc(layout.alphaUnpacked);
		unpacked.copy(alpha, 0, 0, Math.min(unpacked.length, alpha.length));
		return alpha;
	}
	const mask = readAjpMask(run);
	if (!mask) throw invalid("The picture's alpha run is not one");
	return mask.pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const alicesoftAjpImageDescriptor: FormatDescriptor = {
	id: "alicesoft-ajp-image",
	name: "AliceSoft JPEG image",
	extensions: ["ajp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/AliceSoft/ImageAJP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alicesoftAjpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alicesoftAjpImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readAjpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAjpLayout(await readStored(source));
		if (!layout) throw invalid("Not an AliceSoft JPEG picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		// `AjpFormat.Read` hands out one picture: the JPEG with the alpha channel of the run laid over it.
		const entries: FixedEntry[] = [
			{
				...createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: BigInt(layout.imageOffset),
					size: BigInt(layout.imageSize),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: 32,
					},
				}),
				sizeKnown: false,
			},
		];
		return {
			entries,
			metadata: {
				version: layout.version,
				image: "bmp",
				width: layout.width,
				height: layout.height,
				alphaUnpacked: layout.alphaUnpacked,
			},
		};
	},
	async openEntry(source: ByteSource, _entry) {
		const stored = await readStored(source);
		const layout = readAjpLayout(stored);
		if (!layout) throw invalid("Not an AliceSoft JPEG picture");
		// `AjpFormat.Read`: the first sixteen bytes of the run of the JPEG are exclusive-ored with a key, and
		// the reference hands the run to the decoder of the platform. This port reads it with its own reader
		// of the JPEG interchange format and walks the frame with the row length of the head of the picture,
		// exactly as the reference does through `CopyPixels`.
		const keyed = decryptAjpRun(stored, layout.imageOffset, layout.imageSize);
		if (!readJpegHeaderFields(keyed)) {
			throw invalid("The places of the picture stand of no walks of a JPEG");
		}
		const image = readJpegImage(keyed);
		const width = layout.width;
		const height = layout.height;
		if (image.width < width || image.height < height) {
			throw invalid("The places of the picture stand short of the head of it");
		}
		const stride = image.width * 4;
		const pixels = Buffer.alloc(width * height * 4);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const src = y * stride + x * 4;
				const dst = (y * width + x) * 4;
				pixels[dst] = image.pixels[src] ?? 0;
				pixels[dst + 1] = image.pixels[src + 1] ?? 0;
				pixels[dst + 2] = image.pixels[src + 2] ?? 0;
				// A frame of fewer than four bytes a pixel gains an opaque fourth one first, which the
				// alpha channel then stands over where the picture carries one.
				pixels[dst + 3] = 0xff;
			}
		}
		if (0 !== layout.alphaOffset && 0 !== layout.alphaSize) {
			const alpha = await readAjpAlpha(stored, layout);
			if (alpha.length < width * height) {
				throw invalid("The alpha run stands short of the picture");
			}
			for (let at = 0; at < width * height; at += 1) {
				pixels[at * 4 + 3] = alpha[at] ?? 0;
			}
		}
		return Readable.from([writeBmp32(width, height, pixels)]);
	},
});
