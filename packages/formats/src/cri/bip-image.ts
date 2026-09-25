// Port of GARbro "ArcFormats/Cri/ImageBIP.cs" (tag "BIP", class `BipFormat`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is a tiled one of the PlayStation 2, and it carries no mark of its own: a head
// of five or ten words, of which the second names the list of the tiles and the last one, less eight,
// stands under every place of a tile, and then the list itself. The list holds the count of the tiles, a
// word of nothing, the box of the picture and, for every tile, the place of it within the picture, its box
// and the place of its stream as they stand of the place under every tile.
//
// The stream of a tile stands of a head of 0x7C places of its own - the mark `PNGFILE2`, the count of the
// whole stream at the twenty fourth place of it, the kind of the alpha at 0x68 and the place of the tile
// within its own box at 0x6C and 0x70 - and then a **portable network graphic**. The reference lays every
// graphic into a `Bgra32` surface of the Windows imaging stack at the place of the tile, of the box of the
// head of the list behind the tile grown to hold the places of the tiles that stand past it.
//
// The reference swaps the first and the third place of every place of the graphic before it lays it down,
// which stands of the order the Windows imaging stack hands the places of a picture back in rather than of
// the graphic itself: this port lays the places of the graphic over in the order its own walk of one hands
// them back, which is the order of the places of the memory of the reference as well. The alpha of a place
// is the one of the graphic, of the kind the head of the tile names above nothing, and that alpha itself
// stands of a place of a hundred and twenty eight rather than of a place of two hundred and fifty five.

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

/** The words of the head of the picture a tile list may stand of. */
const KINDS: readonly number[] = [5, 10];
const INDEX_AT = 4;
const HALF_WORD = 4;
const PLACE_UNDER_TILES = 8;
const TILE_COUNT_SIZE = 2;
const FLAG_SIZE = 2;
const ZERO_SIZE = 4;
const BOX_SIZE = 4;
/** The record of a tile: a place the reference passes over, its place, its box, one more and its stream. */
const TILE_RECORD_SIZE = 0x1c;
const TILE_LEFT_AT = 8;
const TILE_BOX_AT = 0x10;
const TILE_OFFSET_AT = 0x18;
/** The head of the stream of a tile. */
const TILE_HEAD_SIZE = 0x7c;
const TILE_MARK = "PNGFILE2";
const TILE_TOTAL_AT = 0x18;
const TILE_ALPHA_AT = 0x68;
const TILE_X_AT = 0x6c;
const TILE_Y_AT = 0x70;
const PLACES_BGRA = 4;
const PLACES_RGB = 3;
const FULL_ALPHA = 0xff;
const BITS_BGRA = 32;
/** The places of the alpha of a place of a graphic, of the place of two hundred and fifty five. */
const ALPHA_BASE = 0x80;

export interface BipTile {
	left: number;
	top: number;
	width: number;
	height: number;
	/** The place of the stream of the tile within the file. */
	offset: number;
}

export interface BipLayout {
	width: number;
	height: number;
	dataOffset: number;
	tiles: BipTile[];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `BipFormat.ReadMetaData`: the head of the picture, the list of the tiles and the box of it. */
export function readBipLayout(data: Buffer): BipLayout | undefined {
	if (data.length < HALF_WORD * 2) return undefined;
	const kind = data.readInt32LE(0);
	if (!KINDS.includes(kind)) return undefined;
	const headerEnd = kind * HALF_WORD;
	if (headerEnd + HALF_WORD > data.length) return undefined;
	const indexOffset = data.readUInt32LE(INDEX_AT);
	const dataOffset =
		data.readUInt32LE(headerEnd - HALF_WORD) + PLACE_UNDER_TILES;
	if (indexOffset >= dataOffset || indexOffset < headerEnd) return undefined;
	if (
		indexOffset + TILE_COUNT_SIZE + FLAG_SIZE + ZERO_SIZE + BOX_SIZE >
		data.length
	) {
		return undefined;
	}
	const tileCount = data.readInt16LE(indexOffset);
	const flag = data.readInt16LE(indexOffset + TILE_COUNT_SIZE);
	if (tileCount <= 0 || 0 !== flag) return undefined;
	const boxAt = indexOffset + TILE_COUNT_SIZE + FLAG_SIZE + ZERO_SIZE;
	const headWidth = data.readUInt16LE(boxAt);
	const headHeight = data.readUInt16LE(boxAt + 2);
	if (0 === headWidth || 0 === headHeight) return undefined;
	let width = headWidth;
	let height = headHeight;
	const tiles: BipTile[] = [];
	let at = boxAt + BOX_SIZE;
	for (let tile = 0; tile < tileCount; tile += 1) {
		if (at + TILE_RECORD_SIZE > data.length) return undefined;
		const left = data.readUInt16LE(at + TILE_LEFT_AT);
		const top = data.readUInt16LE(at + TILE_LEFT_AT + 2);
		const tileWidth = data.readUInt16LE(at + TILE_BOX_AT);
		const tileHeight = data.readUInt16LE(at + TILE_BOX_AT + 2);
		const offset = data.readUInt32LE(at + TILE_OFFSET_AT) + dataOffset;
		width = Math.max(width, left + tileWidth);
		height = Math.max(height, top + tileHeight);
		tiles.push({ left, top, width: tileWidth, height: tileHeight, offset });
		at += TILE_RECORD_SIZE;
	}
	return { width, height, dataOffset, tiles };
}

/**
 * `BipFormat.Read`: the picture of the graphics of the tiles, of four places each, in the order of the
 * places of the memory of the reference. Every tile overwrites the places of the picture it stands on, and
 * a place no tile stands on keeps the places of nothing the surface was built of.
 */
export async function compositeBipPicture(
	data: Buffer,
	layout: BipLayout,
): Promise<Buffer> {
	const pixels = Buffer.alloc(layout.width * layout.height * PLACES_BGRA, 0x00);
	for (const tile of layout.tiles) {
		if (tile.offset + TILE_HEAD_SIZE > data.length) {
			throw invalidPicture(
				"The head of a tile of the picture stands past its end",
			);
		}
		if (data.toString("latin1", tile.offset, tile.offset + 8) !== TILE_MARK) {
			throw invalidPicture("A tile of the picture is of no kind of its own");
		}
		const total = data.readInt32LE(tile.offset + TILE_TOTAL_AT);
		const alpha = data.readInt32LE(tile.offset + TILE_ALPHA_AT);
		const x = data.readInt32LE(tile.offset + TILE_X_AT);
		const y = data.readInt32LE(tile.offset + TILE_Y_AT);
		const size = total - TILE_HEAD_SIZE;
		if (size <= 0 || tile.offset + TILE_HEAD_SIZE + size > data.length) {
			throw invalidPicture(
				"The stream of a tile of the picture stands short of it",
			);
		}
		const png = await readPngImage(
			data.subarray(
				tile.offset + TILE_HEAD_SIZE,
				tile.offset + TILE_HEAD_SIZE + size,
			),
		);
		if (!png) {
			throw invalidPicture("The stream of a tile of the picture is no graphic");
		}
		const places = BITS_BGRA === png.bitsPerPixel ? PLACES_BGRA : PLACES_RGB;
		for (let row = 0; row < png.height; row += 1) {
			const target = tile.top + y + row;
			if (target < 0 || target >= layout.height) continue;
			for (let place = 0; place < png.width; place += 1) {
				const column = tile.left + x + place;
				if (column < 0 || column >= layout.width) continue;
				const from = (row * png.width + place) * places;
				const to = (target * layout.width + column) * PLACES_BGRA;
				pixels[to] = png.pixels[from] ?? 0;
				pixels[to + 1] = png.pixels[from + 1] ?? 0;
				pixels[to + 2] = png.pixels[from + 2] ?? 0;
				// The alpha of a place of the graphic stands of a place of one hundred and twenty eight
				// where the head of the tile names one, and of the whole place where it names nothing.
				const value =
					0 === alpha
						? FULL_ALPHA
						: Math.min(
								FULL_ALPHA,
								Math.floor(
									(places === PLACES_BGRA
										? (png.pixels[from + 3] ?? 0)
										: FULL_ALPHA) *
										(FULL_ALPHA / ALPHA_BASE),
								),
							);
				pixels[to + 3] = value;
			}
		}
	}
	return pixels;
}

export const criBipImageDescriptor: FormatDescriptor = {
	id: "cri-bip-image",
	name: "PS2 tiled bitmap",
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
			source: "ArcFormats/Cri/ImageBIP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criBipImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criBipImageDescriptor,
	// The reference carries no mark of its own and takes a file of any extension as a candidate, which is
	// what a format of the lowest order of it does here as well.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HALF_WORD * 2)) return false;
		try {
			return readBipLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readBipLayout(data);
		if (!layout) throw invalidPicture("Not a tiled picture of the engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					tiles: layout.tiles.length,
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
				tiles: layout.tiles.length,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_BGRA,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readBipLayout(data);
		if (!layout) throw invalidPicture("Not a tiled picture of the engine");
		const pixels = await compositeBipPicture(data, layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
