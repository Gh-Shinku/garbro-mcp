// Port of GARbro "ArcFormats/Qlie/ImageDPNG.cs" (tag "DPNG", class `DpngFormat`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is a **tiled** one: the mark `DPNG` is followed by a word, the count of the
// tiles, the box of the picture and a list of tiles. Every tile holds the place of it within the picture,
// its box, the count of its stream and eight places the reference skips, and then a **portable network
// graphic** of its own, which is laid into the picture at that place. The place of the next tile is the
// place of its stream plus the count of it, so a tile that names no places is named and passed over.
//
// The reference lays every tile into a `Pbgra32` surface of the Windows imaging stack, i.e. of the places
// of the graphic of the tile with the colours of it multiplied by its alpha. This port lays the places of
// the graphic over as they stand, of an alpha of its own where the graphic carries one and of a full one
// everywhere else, so that the bitmap it hands over is the picture the tiles name rather than a surface of
// the places of a display.

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
import { readPngImage } from "../shared/png-image.js";

const SIGNATURE = Buffer.from("DPNG", "latin1");
const COUNT_AT = 8;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x10;
/** The list of tiles: its place, its box, the count of its stream and eight places behind that. */
const TILES_AT = 0x14;
const TILE_HEAD_SIZE = 0x1c;
const TILE_X_AT = 0;
const TILE_Y_AT = 4;
const TILE_SIZE_AT = 0x10;
const PLACES_RGB = 3;
const PLACES_BGRA = 4;
const FULL_ALPHA = 0xff;
const BITS_BGRA = 32;

export interface DpngLayout {
	tileCount: number;
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `DpngFormat.ReadMetaData`: the count of the tiles and the box of the picture. */
export function readDpngLayout(data: Buffer): DpngLayout | undefined {
	if (data.length < TILES_AT) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const tileCount = data.readInt32LE(COUNT_AT);
	if (tileCount <= 0) return undefined;
	const width = data.readUInt32LE(WIDTH_AT);
	const height = data.readUInt32LE(HEIGHT_AT);
	// The reference builds a surface of the box of the head without looking at it; a picture of no
	// places is turned away here.
	if (0 === width || 0 === height) return undefined;
	return { tileCount, width, height };
}

/**
 * `DpngFormat.Read`: the picture of the tiles, of four places each, in the order of the places of the
 * memory of the reference. Every tile overwrites the places of the picture it stands on, and a place no
 * tile stands on keeps the places of nothing the picture was built of.
 */
export async function compositeDpngPicture(
	data: Buffer,
	layout: DpngLayout,
): Promise<Buffer> {
	const pixels = Buffer.alloc(layout.width * layout.height * PLACES_BGRA, 0x00);
	let next = TILES_AT;
	for (let tile = 0; tile < layout.tileCount; tile += 1) {
		if (next + TILE_HEAD_SIZE > data.length) {
			throw invalidPicture("The tiles of the picture stand short of it");
		}
		const x = data.readInt32LE(next + TILE_X_AT);
		const y = data.readInt32LE(next + TILE_Y_AT);
		const size = data.readUInt32LE(next + TILE_SIZE_AT);
		next += TILE_HEAD_SIZE;
		const streamAt = next;
		next = streamAt + size;
		if (0 === size) continue;
		const png = await readPngImage(data.subarray(streamAt, streamAt + size));
		if (!png) {
			throw invalidPicture("A tile of the picture is no graphic of its own");
		}
		const alpha = BITS_BGRA === png.bitsPerPixel;
		const places = alpha ? PLACES_BGRA : PLACES_RGB;
		for (let row = 0; row < png.height; row += 1) {
			const target = y + row;
			if (target < 0 || target >= layout.height) continue;
			for (let place = 0; place < png.width; place += 1) {
				const column = x + place;
				if (column < 0 || column >= layout.width) continue;
				const from = (row * png.width + place) * places;
				const to = (target * layout.width + column) * PLACES_BGRA;
				pixels[to] = png.pixels[from] ?? 0;
				pixels[to + 1] = png.pixels[from + 1] ?? 0;
				pixels[to + 2] = png.pixels[from + 2] ?? 0;
				pixels[to + 3] = alpha ? (png.pixels[from + 3] ?? 0) : FULL_ALPHA;
			}
		}
	}
	return pixels;
}

/** The tiles of the picture, of the place and the box of each of them. */
export interface DpngTile {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	size: number;
	/** The place of the stream of the tile within the file. */
	offset: number;
}

/** The list of the tiles of a picture, which the reference reads as it lays them down. */
export function readDpngTiles(data: Buffer, layout: DpngLayout): DpngTile[] {
	const tiles: DpngTile[] = [];
	let next = TILES_AT;
	for (let tile = 0; tile < layout.tileCount; tile += 1) {
		if (next + TILE_HEAD_SIZE > data.length) break;
		const x = data.readInt32LE(next + TILE_X_AT);
		const y = data.readInt32LE(next + TILE_Y_AT);
		const width = data.readInt32LE(next + 8);
		const height = data.readInt32LE(next + 0x0c);
		const size = data.readUInt32LE(next + TILE_SIZE_AT);
		next += TILE_HEAD_SIZE;
		const offset = next;
		next = offset + size;
		if (0 !== size) {
			tiles.push({ index: tile, x, y, width, height, size, offset });
		}
	}
	return tiles;
}

export const qlieDpngImageDescriptor: FormatDescriptor = {
	id: "qlie-dpng-image",
	name: "QLIE tiled PNG image",
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
			source: "ArcFormats/Qlie/ImageDPNG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const qlieDpngImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qlieDpngImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(TILES_AT)) return false;
		try {
			return readDpngLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readDpngLayout(data);
		if (!layout) throw invalidPicture("Not a tiled picture of the QLIE engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					tiles: layout.tileCount,
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
				tiles: layout.tileCount,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_BGRA,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readDpngLayout(data);
		if (!layout) throw invalidPicture("Not a tiled picture of the QLIE engine");
		const pixels = await compositeDpngPicture(data, layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
