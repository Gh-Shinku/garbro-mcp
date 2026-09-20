// Format reference: GARbro "ArcFormats/RealLive/ImageG00.cs", class `G00Format` with the `G00Reader` that
// unpacks through it. The reader's `LzDecompress` is the walk the archive port already carries, which is
// why it lives beside this file. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { unpackG00Lzss } from "./g00.js";

/** The header: a type byte, the dimensions, and then a length or a count. */
const TYPE_FIELD = 0;
const WIDTH_FIELD = 1;
const HEIGHT_FIELD = 3;
const BODY_FIELD = 5;
const MAXIMUM_DIMENSION = 0x8000;
const MAXIMUM_TILES = 0x1000;
/** The three kinds of body. */
const TYPE_INDEXED = 1;
const TYPE_TILED = 2;
/** What each kind is packed with: the least a copy adds, and how many bytes one pixel takes. */
const STORED_MIN_COUNT = 1;
const STORED_BYTES_PER_PIXEL = 3;
const INDEXED_MIN_COUNT = 2;
const INDEXED_BYTES_PER_PIXEL = 1;
/** The palette of the indexed kind is four bytes an entry, blue first and the fourth one an alpha. */
const PALETTE_ENTRY = 4;
const PALETTE_MAXIMUM = 0x100;
/** The tile table of the tiled kind: a place each, and sixteen bytes the reference steps over. */
const TILE_RECORD = 0x18;
/** The head of the unpacked table: the count again, then a place and a length to a tile. */
const TABLE_HEADER = 4;
const TABLE_RECORD = 8;
/** A tile block: two words of its own, 0x70 bytes, then a record a piece and the pixels behind it. */
const TILE_HEADER = 4;
const TILE_HEADER_SKIP = 0x70;
const PIECE_RECORD = 0x5c;
const PIECE_PIXEL_SIZE = 4;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface G00ImageLayout {
	type: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `G00Format.ReadMetaData`: the file opens with a type of nothing, one or two, and the dimensions, which the
 * reference caps at 0x8000. A tiled body then holds the number of tiles, and the other two hold the length of
 * the packed stream, which the reference requires to reach exactly to the end of the file.
 */
export function readG00ImageLayout(data: Buffer): G00ImageLayout | undefined {
	if (data.length < BODY_FIELD) return undefined;
	const type = data[TYPE_FIELD] ?? 0xff;
	if (type > TYPE_TILED) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (
		0 === width ||
		width > MAXIMUM_DIMENSION ||
		0 === height ||
		height > MAXIMUM_DIMENSION
	) {
		return undefined;
	}
	// The reference lets its own bitmap reader hold whatever the header declares; this port draws the line at
	// a picture it is willing to allocate.
	if (width * height * 4 > LIMIT) return undefined;
	if (TYPE_TILED === type) {
		if (data.length < BODY_FIELD + 4) return undefined;
		const count = data.readInt32LE(BODY_FIELD);
		if (count <= 0 || count > MAXIMUM_TILES) return undefined;
	} else {
		if (data.length < BODY_FIELD + 4) return undefined;
		const length = data.readUInt32LE(BODY_FIELD);
		if (length + BODY_FIELD !== data.length) return undefined;
	}
	return {
		type,
		width,
		height,
		bitsPerPixel: TYPE_INDEXED === type ? 8 : TYPE_TILED === type ? 32 : 24,
	};
}

/**
 * The reference hands the whole unfolded buffer to its bitmap reader together with the row length it works
 * out from the width and the depth, which is the packed one -- no row is padded. So the picture is the head
 * of that buffer, and a buffer that does not hold all of it declines the picture rather than leaving the
 * rows short, as the reference's own reader would.
 */
function pictureHead(stored: Buffer, layout: G00ImageLayout): Buffer {
	const pixelSize = layout.bitsPerPixel / 8;
	const needed = layout.width * layout.height * pixelSize;
	if (stored.length < needed) {
		throw invalidImage("A packed picture unfolds to less than it declares");
	}
	return Buffer.from(stored.subarray(0, needed));
}

/** What unpacking a picture yields: the pixels, and the palette the indexed kind carries. */
export interface G00Image {
	pixels: Buffer;
	palette: Buffer | undefined;
}

/**
 * `G00Reader.UnpackV0` and `UnpackV1`: both unfold one packed stream, the stored kind into pixels of three
 * bytes and the indexed kind into a palette of four bytes an entry with the pixels behind it. The reference
 * slides the pixels down over the palette in place and hands the whole buffer over; this port only reports
 * the pixels that stand behind the palette, and refuses a palette of more colours than an eight bit bitmap
 * can name.
 */
function unpackFlat(data: Buffer, layout: G00ImageLayout): G00Image {
	const indexed = TYPE_INDEXED === layout.type;
	const stored = unpackG00Lzss(
		data.subarray(BODY_FIELD),
		indexed ? INDEXED_MIN_COUNT : STORED_MIN_COUNT,
		indexed ? INDEXED_BYTES_PER_PIXEL : STORED_BYTES_PER_PIXEL,
	);
	if (!stored)
		throw invalidImage("The packed stream of the picture does not unfold");
	if (!indexed) {
		return { pixels: pictureHead(stored, layout), palette: undefined };
	}
	if (stored.length < 2) {
		throw invalidImage("The palette of the picture is missing");
	}
	const colors = stored.readUInt16LE(0);
	if (colors < 1 || colors > PALETTE_MAXIMUM) {
		throw invalidImage("The palette of the picture names too many colours");
	}
	const pixelsAt = 2 + colors * PALETTE_ENTRY;
	if (pixelsAt > stored.length) {
		throw invalidImage("The palette of the picture runs past its stream");
	}
	const palette: Buffer = Buffer.alloc(colors * PALETTE_ENTRY, 0x00);
	for (let index = 0; index < colors; index += 1) {
		// The stored entry is blue, green, red and an alpha, and the fourth byte of a bitmap palette is
		// reserved, so the alpha the reference drops is dropped here too.
		stored.copy(
			palette,
			index * PALETTE_ENTRY,
			2 + index * PALETTE_ENTRY,
			2 + index * PALETTE_ENTRY + PALETTE_ENTRY - 1,
		);
	}
	return { pixels: pictureHead(stored.subarray(pixelsAt), layout), palette };
}

/**
 * `G00Reader.UnpackV2`: the header counts tiles, and the table behind it unfolds to a place and a length for
 * each of them. The reference then reads the pieces of **the first tile that has any**, which is the one whose
 * length is not nothing, and lays each piece of it into the picture at the place the tile and the piece give
 * together. Pieces of the tiles behind that one are left as they stand, which is what the reference does.
 */
function unpackTiled(data: Buffer, layout: G00ImageLayout): G00Image {
	const count = data.readInt32LE(BODY_FIELD);
	const tilesAt = BODY_FIELD + 4;
	// The reference reads the place of every tile before it unfolds anything, which is what leaves the packed
	// table standing behind the whole tile table.
	const tableAt = tilesAt + count * TILE_RECORD;
	if (tableAt > data.length) {
		throw invalidImage("The tile table of the picture is cut short");
	}
	const table = unpackG00Lzss(
		data.subarray(tableAt),
		INDEXED_MIN_COUNT,
		INDEXED_BYTES_PER_PIXEL,
	);
	if (!table)
		throw invalidImage("The tile table of the picture does not unfold");
	if (table.length < TABLE_HEADER || table.readInt32LE(0) !== count) {
		throw invalidImage(
			"The tile table of the picture names another number of tiles",
		);
	}
	let chosen = -1;
	for (let index = 0; index < count; index += 1) {
		const at = TABLE_HEADER + index * TABLE_RECORD;
		if (at + TABLE_RECORD > table.length) {
			throw invalidImage("The tile table of the picture is cut short");
		}
		if (table.readInt32LE(at + 4) > 0) {
			chosen = index;
			break;
		}
	}
	if (chosen < 0) {
		throw invalidImage("Every tile of the picture is empty");
	}
	const pixels: Buffer = Buffer.alloc(layout.height * layout.width * 4, 0x00);
	const at = table.readUInt32LE(TABLE_HEADER + chosen * TABLE_RECORD);
	if (at + TILE_HEADER > table.length) {
		throw invalidImage("The tile of the picture lies outside its table");
	}
	if (table.readUInt16LE(at) !== 1) {
		throw invalidImage("The picture carries a tile of an unknown kind");
	}
	const pieces = table.readUInt16LE(at + 2);
	const tileX = data.readInt32LE(tilesAt + chosen * TILE_RECORD);
	const tileY = data.readInt32LE(tilesAt + chosen * TILE_RECORD + 4);
	let piece = at + TILE_HEADER + TILE_HEADER_SKIP;
	const stride = layout.width * 4;
	for (let index = 0; index < pieces; index += 1) {
		if (piece + PIECE_RECORD > table.length) {
			throw invalidImage("A piece of the tile is cut short");
		}
		const x = table.readUInt16LE(piece) + tileX;
		const y = table.readUInt16LE(piece + 2) + tileY;
		const width = table.readUInt16LE(piece + 6);
		const height = table.readUInt16LE(piece + 8);
		const body = piece + PIECE_RECORD;
		const pieceBytes = width * PIECE_PIXEL_SIZE;
		if (x + width > layout.width || y + height > layout.height) {
			throw invalidImage("A piece of the tile lies outside the picture");
		}
		if (body + pieceBytes * height > table.length) {
			throw invalidImage("The pixels of a piece are cut short");
		}
		for (let row = 0; row < height; row += 1) {
			const from = body + row * pieceBytes;
			table.copy(pixels, (y + row) * stride + x * 4, from, from + pieceBytes);
		}
		piece = body + pieceBytes * height;
	}
	return { pixels, palette: undefined };
}

export function decodeG00Image(data: Buffer, layout: G00ImageLayout): G00Image {
	return TYPE_TILED === layout.type
		? unpackTiled(data, layout)
		: unpackFlat(data, layout);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const realliveG00ImageDescriptor: FormatDescriptor = {
	id: "reallive-g00-image",
	name: "RealLive engine image",
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
			source: "ArcFormats/RealLive/ImageG00.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const realliveG00ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: realliveG00ImageDescriptor,
	// The reference registers no word of its own for this format, so the header is what tells it apart and
	// the name of the file is the only other hint there is.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		return readG00ImageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readG00ImageLayout(stored);
		if (!layout) {
			throw invalidImage("Not a RealLive picture");
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
					bitsPerPixel: layout.bitsPerPixel,
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
				bitsPerPixel: layout.bitsPerPixel,
				type: layout.type,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readG00ImageLayout(stored);
		if (!layout) {
			throw invalidImage("Not a RealLive picture");
		}
		const { pixels, palette } = decodeG00Image(stored, layout);
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		if (palette) {
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette, false),
			]);
		}
		return Readable.from([
			TYPE_TILED === layout.type
				? writeBmp32(layout.width, layout.height, pixels, false)
				: writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
