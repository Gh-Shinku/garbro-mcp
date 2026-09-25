// Format reference: GARbro "ArcFormats/Triangle/ImageIAF.cs", classes `IafFormat` and the `RleReader` beside
// it (tag `IAF`, the compressed bitmap of Triangle). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { inflateLzss } from "@garbro-mcp/codecs";
import { readBmpImage, writeBmp32, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** What the reference reads before it knows where the places of the picture stand. */
const HEAD_SIZE = 12;
/** The size of a bitmap's header, which is where the reference looks for a place of three colours. */
const BMP_HEAD_SIZE = 0x36;
/** The places of a pixel the reference asks for when it only wants the head of the bitmap behind them. */
const HEAD_PLACES = 0x26;
/** The word the runs of the second kind of this engine open with. */
const RLE_V2_MARK = 0x014d4142;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const BITS_FIELD = 0x1c;
const BMP_STORED_SIZE_FIELD = 0x0a;
const BMP_HEADER_SIZE_FIELD = 0x0e;
const PALETTE_PLACES = 0x100;
const FOUR_PLACES = 4;
const PLACE_BITS = 8;
const BITS_8 = 8;
const BITS_24 = 24;
const BMP_TAG = 0x42;
const BMP_TAG_2 = 0x43;
const BMP_TAG_3 = 0x4d;
const LIMIT = 256 * 1024 * 1024;
const OFFSET_LIMIT = 4096;

export interface IafLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	dataOffset: number;
	packedSize: number;
	unpackedSize: number;
	packType: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `IafFormat.ReadMetaData`: where the picture stands, how long its places stand of, and the bitmap behind
 * them. The reference tells the four kinds of head this engine writes by the length of the file alone.
 */
export function readIafLayout(data: Buffer): IafLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const total = data.length;
	const packed0 = data.readInt32LE(0);
	const packed1 = data.readInt32LE(1);
	let packedSize: number;
	let dataOffset: number;
	let tailSize: number;
	let unpackedPosition: number;
	if (5 + packed1 + 0x14 === total) {
		packedSize = packed1;
		dataOffset = 5;
		tailSize = 0x14;
		unpackedPosition = 0x10;
	} else if (5 + packed1 + 0xc === total) {
		packedSize = packed1;
		dataOffset = 5;
		tailSize = 0xc;
		unpackedPosition = 8;
	} else if (4 + packed0 + 0xc === total) {
		packedSize = packed0;
		dataOffset = 4;
		tailSize = 0xc;
		unpackedPosition = 8;
	} else {
		packedSize = total - HEAD_SIZE;
		dataOffset = HEAD_SIZE;
		tailSize = 0;
		unpackedPosition = 8;
	}
	if (packedSize < 0 || dataOffset + packedSize > total) return undefined;
	// The places of the picture and the length of the bitmap it stands of stand at the end of the file;
	// where the file names no tail, they stand at the head of it.
	const fields = 0 === tailSize ? data : data.subarray(total - tailSize);
	if (fields.length <= Math.max(unpackedPosition + 3, 7)) return undefined;
	const offsetX = fields.readInt32LE(0);
	const offsetY = fields.readInt32LE(4);
	if (Math.abs(offsetX) > OFFSET_LIMIT || Math.abs(offsetY) > OFFSET_LIMIT) {
		return undefined;
	}
	let unpackedSize = fields.readInt32LE(unpackedPosition);
	const packType = (unpackedSize >> 30) & 3;
	if (3 === packType || packType < 0) return undefined;
	unpackedSize &= 0x3fffffff;
	if (unpackedSize > LIMIT) return undefined;
	const head = unpackIafBitmap(
		data.subarray(dataOffset, dataOffset + packedSize),
		packType,
		packedSize,
		HEAD_PLACES,
	);
	if (
		!(BMP_TAG === head[0] || BMP_TAG_2 === head[0]) ||
		BMP_TAG_3 !== head[1]
	) {
		return undefined;
	}
	// The reference reports the measurements of the bitmap behind the head as the bitmap itself states them,
	// a height standing of the other way up included; the port keeps that reading.
	const width = head.readUInt32LE(WIDTH_FIELD);
	const height = head.readUInt32LE(HEIGHT_FIELD);
	return {
		width,
		height,
		offsetX,
		offsetY,
		bitsPerPixel: head.readInt16LE(BITS_FIELD),
		dataOffset,
		packedSize,
		unpackedSize,
		packType,
	};
}

/** `RleReader.UnpackV2`: the runs of the second kind, two places to a run. */
function unpackIafRleV2(packed: Buffer, unpackedSize: number): Buffer {
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	let source = 0;
	let destination = 0;
	while (destination < output.length && source < packed.length) {
		const value = packed[source] ?? 0;
		const count = Math.min(
			packed[source + 1] ?? 0,
			output.length - destination,
		);
		source += 2;
		output.fill(value, destination, destination + count);
		destination += count;
	}
	return output;
}

/** `RleReader.Unpack`: the runs of the first kind, a control place in front of every run. */
function unpackIafRle(packed: Buffer, unpackedSize: number): Buffer {
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	let source = 0;
	let destination = 0;
	while (destination < output.length && source < packed.length) {
		const control = packed[source] ?? 0;
		source += 1;
		if (0 === control) {
			const count = Math.min(packed[source] ?? 0, output.length - destination);
			source += 1;
			const held = Math.min(count, Math.max(0, packed.length - source));
			packed.copy(output, destination, source, source + held);
			// The reference walks the places of the packed picture by the count it was given, not by the
			// places it found; the places it did not find stand of nothing.
			destination += count;
			source += count;
		} else {
			const count = Math.min(control, output.length - destination);
			const value = packed[source] ?? 0;
			source += 1;
			output.fill(value, destination, destination + count);
			destination += count;
		}
	}
	return output;
}

/**
 * `IafFormat.UnpackBitmap`: the bitmap behind the head, of the kind the head names. Kind 1 stands as it
 * stands, kind 0 stands of the walks of the engine's own LZSS, and kind 2 stands of runs of two kinds which
 * the word in front of them tells apart.
 */
export function unpackIafBitmap(
	packed: Buffer,
	packType: number,
	packedSize: number,
	unpackedSize: number,
): Buffer {
	if (2 === packType) {
		// A packed picture standing shorter than the word its kinds are told by stands of the first kind.
		const mark = packed.length >= 4 ? packed.readUInt32LE(0) : 0;
		return RLE_V2_MARK === mark
			? unpackIafRleV2(packed, unpackedSize)
			: unpackIafRle(packed, unpackedSize);
	}
	if (0 === packType) {
		return inflateLzss(packed, { outputLength: unpackedSize });
	}
	if (1 === packType) {
		if (packedSize < unpackedSize) {
			throw invalidPicture("The picture stands short of the places it names");
		}
		return Buffer.from(packed.subarray(0, unpackedSize));
	}
	throw invalidPicture(
		"The picture stands of a kind this engine does not know",
	);
}

/** `IafFormat.ConvertCM`: a bitmap whose place of a pixel stands of one colour at a time, put together. */
export function convertIafCm(
	input: Buffer,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const start = input.readInt32LE(BMP_STORED_SIZE_FIELD);
	const placeSize = Math.trunc(bitsPerPixel / PLACE_BITS);
	const bitmap = Buffer.from(input);
	const stride = width * placeSize;
	let source = start;
	for (let place = 0; place < placeSize; place += 1) {
		for (let row = 0; row < height; row += 1) {
			let at = row * stride + place;
			for (let column = 0; column < width; column += 1) {
				bitmap[start + at] = input[source] ?? 0;
				source += 1;
				at += placeSize;
			}
		}
	}
	return bitmap;
}

/**
 * `IafFormat.BitmapWithAlphaChannel`: a picture of three colours with the places of an eight bit picture
 * behind it standing of its alpha, taken from the colours of that picture's own map.
 */
export function iafBitmapWithAlpha(
	bitmap: Buffer,
	alphaOffset: number,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const infoOffset = alphaOffset + BMP_HEADER_SIZE_FIELD;
	let paletteOffset =
		infoOffset +
		bitmap.readInt32LE(infoOffset < bitmap.length ? infoOffset : 0);
	const pixelsAt = bitmap.readInt32LE(BMP_STORED_SIZE_FIELD);
	const alphaAt =
		alphaOffset + bitmap.readInt32LE(alphaOffset + BMP_STORED_SIZE_FIELD);
	const colors = Math.trunc((alphaAt - paletteOffset) / FOUR_PLACES);
	const alphaMap: Buffer = Buffer.alloc(PALETTE_PLACES, 0x00);
	if (colors > 0) {
		for (
			let at = 0;
			at < colors && paletteOffset + 2 < bitmap.length;
			at += 1
		) {
			const blue = bitmap[paletteOffset] ?? 0;
			const green = bitmap[paletteOffset + 1] ?? 0;
			const red = bitmap[paletteOffset + 2] ?? 0;
			alphaMap[at] = Math.trunc((blue + green + red) / 3);
			paletteOffset += FOUR_PLACES;
		}
	} else {
		for (let at = 0; at < PALETTE_PLACES; at += 1) alphaMap[at] = at;
	}
	const placeSize = Math.trunc(bitsPerPixel / PLACE_BITS);
	const stride = width * placeSize;
	const pixels: Buffer = Buffer.alloc(width * height * FOUR_PLACES, 0x00);
	let at = 0;
	for (let row = height - 1; row >= 0; row -= 1) {
		const source = pixelsAt + row * stride;
		const alphaRow = alphaAt + row * width;
		for (let column = 0; column < width; column += 1) {
			pixels[at] = bitmap[source + column * placeSize] ?? 0;
			pixels[at + 1] = bitmap[source + column * placeSize + 1] ?? 0;
			pixels[at + 2] = bitmap[source + column * placeSize + 2] ?? 0;
			pixels[at + 3] = ~(alphaMap[bitmap[alphaRow + column] ?? 0] ?? 0) & 0xff;
			at += FOUR_PLACES;
		}
	}
	return writeBmp32(width, height, pixels);
}

/** `IafFormat.Read`: the bitmap behind the head, handed over with its alpha where it stands of one. */
export function renderIafImage(data: Buffer): Buffer {
	const layout = readIafLayout(data);
	if (!layout) throw invalidPicture("Not a picture of the Triangle engine");
	let bitmap = unpackIafBitmap(
		data.subarray(layout.dataOffset, layout.dataOffset + layout.packedSize),
		layout.packType,
		layout.packedSize,
		layout.unpackedSize,
	);
	if (BMP_TAG_2 === bitmap[0]) {
		bitmap = Buffer.from(bitmap);
		bitmap[0] = BMP_TAG;
		if (layout.bitsPerPixel > BITS_8) {
			bitmap = convertIafCm(
				bitmap,
				layout.width,
				layout.height,
				layout.bitsPerPixel,
			);
		}
	}
	if (layout.bitsPerPixel >= BITS_24) {
		try {
			const stored = bitmap.readInt32LE(2);
			if (
				layout.width * layout.height <= LIMIT &&
				bitmap.length - stored > BMP_HEAD_SIZE &&
				BMP_TAG === bitmap[stored] &&
				BMP_TAG_3 === bitmap[stored + 1] &&
				BITS_8 === bitmap[stored + BITS_FIELD]
			) {
				const alphaWidth = bitmap.readUInt32LE(stored + WIDTH_FIELD);
				const alphaHeight = bitmap.readUInt32LE(stored + HEIGHT_FIELD);
				if (layout.width === alphaWidth && layout.height === alphaHeight) {
					return iafBitmapWithAlpha(
						bitmap,
						stored,
						layout.width,
						layout.height,
						layout.bitsPerPixel,
					);
				}
			}
		} catch {
			// The reference takes a picture whose alpha stands of nothing for a plain one.
		}
	}
	const image = readBmpImage(bitmap);
	if (!image)
		throw invalidPicture("The picture behind the head stands of no bitmap");
	return writeBmpImage(image);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const iafImageDescriptor: FormatDescriptor = {
	id: "triangle-iaf-image",
	name: "Triangle compressed bitmap",
	extensions: ["iaf"],
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
			source: "ArcFormats/Triangle/ImageIAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const iafImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iafImageDescriptor,
	// The reference registers no signature of its own: the four heads it writes are told apart by the
	// length of the file, and the bitmap behind them decides.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readIafLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readIafLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Triangle engine");
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
					packType: layout.packType,
					unpackedSize: layout.unpackedSize,
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
		return Readable.from([renderIafImage(await readStored(source))]);
	},
});
