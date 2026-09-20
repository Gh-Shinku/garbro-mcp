// Format reference: GARbro "ArcFormats/StudioJikkenshitsu/ImageGRD.cs", classes `GrdFormat` and `GrdReader`
// (a Studio Jikkenshitsu picture: the places of a picture stand under a walk of the LZSS kind, which may stand
// under the standard cipher first, and a shape of the places may stand behind them). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import {
	desEcbDecrypt,
	expandNibbleKey,
	inflateLzss,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	paletteTriples,
	writeBmp8Palette,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'GRD ', the word the reference registers. */
const SIGNATURE = Buffer.from("GRD ", "latin1");
const HEADER_SIZE = 0x18;
/** The places of a colour of a picture stand in the place at `0x04` and the place at `0x05` names whether
 * they stand under the cipher, the highest place of it standing for yes. */
const BITS_FIELD = 0x04;
const FLAGS_FIELD = 0x05;
const ENCRYPTED_FLAG = 0x80;
const WIDTH_FIELD = 0x06;
const HEIGHT_FIELD = 0x08;
/** How many places the walk of the picture stands in, and how many the shape of those places stands in. */
const PACKED_LENGTH_FIELD = 0x0c;
const ALPHA_LENGTH_FIELD = 0x14;
/** The places of the picture stand behind the head, the shape of them behind those places. */
const PIXEL_OFFSET = HEADER_SIZE;
/** The places of a color the walk stands for every picture of eight bits, every color standing in four
 * places: its blue, its green, its red and a place that counts for nothing. */
const PALETTE_COLORS = 0x100;
const PALETTE_SIZE = PALETTE_COLORS * 4;
/** The head of the walk of the LZSS kind, which the reader reads past. */
const WALK_HEAD_SIZE = 0x28;
/** The places of a colour the reference knows, which stand as a picture of eight or four and twenty bits. */
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
/** The key the reference stands the pictures of "Giin Oyako" under. */
const DEFAULT_KEY = [15, 0, 1, 2, 8, 5, 10, 11, 5, 9, 14, 13, 1, 8, 0, 6];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrdLayout {
	bitsPerPixel: number;
	width: number;
	height: number;
	/** How many bytes stand in a row of the picture, the rows of a picture of eight bits standing on the
	 * places of a step of a colour of their own. */
	stride: number;
	encrypted: boolean;
	packedLength: number;
	alphaLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The key the reference stands the pictures of its own under: the four low places of every place of the key
 * stand as the places of a key of the standard cipher. */
export function grdKey(): Buffer {
	return expandNibbleKey(Buffer.from(DEFAULT_KEY));
}

/**
 * `GrdFormat.ReadMetaData`: the word `GRD ` stands at the beginning of the file, the places of a colour of
 * the picture in the place at `0x04`, whether they stand under the cipher in the highest place of the place
 * behind it, the width of the picture in the words at `0x06` and its height in the words at `0x08`.
 */
export function readGrdLayout(
	data: Buffer,
	fileLength = data.length,
): GrdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (BITS_8 !== bitsPerPixel && BITS_24 !== bitsPerPixel) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const packedLength = data.readInt32LE(PACKED_LENGTH_FIELD);
	const alphaLength = data.readInt32LE(ALPHA_LENGTH_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (packedLength <= 0 || alphaLength < 0) return undefined;
	if (width * height > LIMIT) return undefined;
	if (PIXEL_OFFSET + packedLength > fileLength) return undefined;
	const places = bitsPerPixel <= BITS_8 ? (width + 3) & ~3 : width;
	return {
		bitsPerPixel,
		width,
		height,
		stride: (places * bitsPerPixel) / 8,
		encrypted: 0 !== ((data[FLAGS_FIELD] ?? 0) & ENCRYPTED_FLAG),
		packedLength,
		alphaLength,
	};
}

/** How many places the walk of the LZSS kind stands as: the head it stands behind, the colours of a picture of
 * eight bits and the places of the picture itself. */
function walkLength(layout: GrdLayout): number {
	const palette = BITS_8 === layout.bitsPerPixel ? PALETTE_SIZE : 0;
	return WALK_HEAD_SIZE + palette + layout.stride * layout.height;
}

/**
 * `GrdReader.Unpack`: the places of the picture stand behind a walk of the LZSS kind, which stands under the
 * standard cipher where the head names it; behind those places and the colours of a picture of eight bits
 * stand the places of the picture itself.
 */
export function decodeGrdPixels(
	data: Buffer,
	layout: GrdLayout,
): { pixels: Buffer; palette: Buffer | undefined } {
	let walk: Buffer = Buffer.from(
		data.subarray(PIXEL_OFFSET, PIXEL_OFFSET + layout.packedLength),
	);
	if (layout.encrypted) {
		walk = desEcbDecrypt(walk, grdKey());
	}
	const unpacked = inflateLzss(walk, { outputLength: walkLength(layout) });
	const pixels: Buffer = Buffer.from(
		unpacked.subarray(
			WALK_HEAD_SIZE + (BITS_8 === layout.bitsPerPixel ? PALETTE_SIZE : 0),
		),
	);
	const palette =
		BITS_8 === layout.bitsPerPixel
			? paletteTriples(
					unpacked.subarray(WALK_HEAD_SIZE, WALK_HEAD_SIZE + PALETTE_SIZE),
				)
			: undefined;
	if (pixels.length < layout.stride * layout.height) {
		throw invalidPicture("GRD picture is cut short of its own places");
	}
	return { pixels, palette };
}

/**
 * `GrdReader.ApplyAlpha`: the shape of the places of a picture of eight bits names, for every row of the
 * picture, how many places of the row stand under a colour of their own and where the places of that colour
 * stand, which are the places of the shape that stand behind the words of the two tables the shape begins
 * with. Every place of the row stands as the colour of the picture first, and a place that stands under a
 * colour of its own stands as that colour, its lowest places counting as many places of the shape as they
 * name.
 */
export function applyGrdAlpha(
	pixels: Buffer,
	palette: Buffer,
	layout: GrdLayout,
	alpha: Buffer,
): Buffer {
	const height = layout.height;
	const width = layout.width;
	const rowTableSize = height * 2;
	const linesSize = height * 4;
	if (alpha.length < rowTableSize + linesSize) {
		throw invalidPicture("GRD picture is cut short of its own shape");
	}
	const dstStride = width * 4;
	const out: Buffer = Buffer.alloc(dstStride * height, 0x00);
	let source = layout.stride * (height - 1);
	let dstRow = 0;
	for (let row = 0; row < height; row += 1) {
		let dst = dstRow;
		for (let x = 0; x < width; x += 1) {
			const code = pixels[source + x] ?? 0;
			out[dst] = palette[code * 3 + 2] ?? 0;
			out[dst + 1] = palette[code * 3 + 1] ?? 0;
			out[dst + 2] = palette[code * 3] ?? 0;
			out[dst + 3] = 0 !== code ? 0xff : 0;
			dst += 4;
		}
		const count = alpha.readUInt16LE(row * 2);
		const lines = alpha.readInt32LE(rowTableSize + row * 4);
		let at = rowTableSize + linesSize + 4 * lines;
		for (let index = 0; index < count; index += 1) {
			if (at + 4 > alpha.length) {
				throw invalidPicture("GRD picture is cut short of its own shape");
			}
			const place = alpha.readUInt16LE(at);
			const code = alpha[at + 2] ?? 0;
			const value = Math.min(alpha[at + 3] ?? 0, 0x0f);
			const target = dstRow + place * 4;
			if (target + 4 > out.length) {
				throw invalidPicture("GRD picture stands beyond its own places");
			}
			if (value > 0) {
				out[target] = palette[code * 3 + 2] ?? 0;
				out[target + 1] = palette[code * 3 + 1] ?? 0;
				out[target + 2] = palette[code * 3] ?? 0;
				out[target + 3] = (value * 0x11) & 0xff;
			} else {
				out[target + 3] = 0;
			}
			at += 4;
		}
		dstRow += dstStride;
		source -= layout.stride;
	}
	return out;
}

/**
 * The shape of the places of a picture, which stands behind the places of the picture and stands under a walk
 * of the LZSS kind of its own. The walk stands from behind the places of the picture to the end of the file
 * and stands as many places as the head names, which the reference reads the same way.
 */
export function decodeGrdAlpha(data: Buffer, layout: GrdLayout): Buffer {
	const walk = data.subarray(PIXEL_OFFSET + layout.packedLength);
	return inflateLzss(walk, { outputLength: layout.alphaLength });
}

/**
 * `GrdReader.Unpack`: the places of a picture stand as a bitmap of eight or four and twenty bits, the picture
 * standing the other way up from the places of the file; where a shape of the places stands in a picture of
 * eight bits, the picture stands as a bitmap of thirty two bits the right way up, the places of the shape
 * having been stood in it.
 */
export function decodeGrd(data: Buffer, layout: GrdLayout): Buffer {
	const { pixels, palette } = decodeGrdPixels(data, layout);
	if (0 !== layout.alphaLength && BITS_8 === layout.bitsPerPixel) {
		if (!palette)
			throw invalidPicture("GRD picture holds no colours of its own");
		const alpha = decodeGrdAlpha(data, layout);
		return writeBmp32(
			layout.width,
			layout.height,
			applyGrdAlpha(pixels, palette, layout, alpha),
		);
	}
	if (BITS_8 === layout.bitsPerPixel) {
		if (!palette)
			throw invalidPicture("GRD picture holds no colours of its own");
		return writeBmp8Palette(
			layout.width,
			layout.height,
			pixels.subarray(0, layout.stride * layout.height),
			palette,
			true,
		);
	}
	return writeBmp24(
		layout.width,
		layout.height,
		pixels.subarray(0, layout.stride * layout.height),
		true,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readGrd(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readGrdLayout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not a GRD picture");
	return { stored, layout };
}

export const studioJikkenshitsuGrdImageDescriptor: FormatDescriptor = {
	id: "studio-jikkenshitsu-grd-image",
	name: "Studio Jikkenshitsu image format",
	extensions: [],
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
			source: "ArcFormats/StudioJikkenshitsu/ImageGRD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const studioJikkenshitsuGrdImageFormat: ArchiveFormat =
	defineFixedArchive({
		descriptor: studioJikkenshitsuGrdImageDescriptor,
		detection: { signatures: [{ bytes: SIGNATURE }] },
		async detect(source: ByteSource): Promise<boolean> {
			if (source.size < BigInt(HEADER_SIZE)) return false;
			try {
				const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
				return readGrdLayout(header, Number(source.size)) !== undefined;
			} catch {
				return false;
			}
		},
		async read(source: ByteSource, sourcePath: string) {
			const { layout } = await readGrd(source);
			const fileName = sourcePath.replace(/^.*[/\\]/, "");
			const shaped = 0 !== layout.alphaLength && BITS_8 === layout.bitsPerPixel;
			const entry: FixedEntry = createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(PIXEL_OFFSET),
				size: source.size - BigInt(PIXEL_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: shaped ? BITS_32 : layout.bitsPerPixel,
					encrypted: layout.encrypted,
				},
			});
			return {
				entries: [entry],
				metadata: {
					image: "bmp",
					bitsPerPixel: shaped ? BITS_32 : layout.bitsPerPixel,
				},
			};
		},
		async openEntry(source: ByteSource) {
			const { stored, layout } = await readGrd(source);
			// The places of the picture stand as a bitmap of its own, the rows of which the writer stands the
			// way the file stands them.
			return Readable.from([decodeGrd(stored, layout)]);
		},
	});
