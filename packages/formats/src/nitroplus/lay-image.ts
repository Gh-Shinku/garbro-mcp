// Port of GARbro "ArcFormats/NitroPlus/ArcLAY.cs" (tag "LAY/MAGES", class `LayOpener`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The file of the engine is not a picture of its own: it is an **index of places** into a graphic that
// stands beside it, of the base name of the file less a trailing place of an underline and of the
// extension `png`, and a list of places within it. The head holds the count of the layers and the count of
// the places, every layer stands of a word of its own, a place of the first of its tiles and a count of
// them, and every place of four single places: the place within the picture of the engine and the place
// within the graphic, of one of them taken off the two behind it.
//
// A layer of the index is drawn of tiles of thirty two by thirty two places, cut out of the graphic and
// laid down at the place of the layer within a picture of 1920 by 1080 places, of its middle for the place
// of nothing. When the engine asks for one layer it lays the layer of the word one down first and, for a
// layer whose top place stands at four, the face of the picture behind that one, and then the layer it was
// asked for.
//
// The reference draws every tile with its own drawing engine, which reads the places of a tile as they
// stand over the places of the picture. This port walks the same places in the same order, of the blend of
// the places of a tile over the ones behind it, and takes the whole place of a place of the picture where
// the reference hands the fractional places of the index to that engine.
//
// The reference lays every tile into a `Pbgra32` surface, i.e. of the places of a tile with the colours of
// them multiplied by its alpha; this port walks the blend of source over in the same places, of the colours
// as they stand, so that the bitmap it hands over is the picture the index names.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp32 } from "../shared/bmp.js";
import { readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
} from "../shared/fixed-archive.js";
import { readPngImage, type PngImage } from "../shared/png-image.js";

const HEAD_SIZE = 8;
const LAYER_SIZE = 12;
const COORD_SIZE = 16;
const PICTURE_WIDTH = 1920;
const PICTURE_HEIGHT = 1080;
const TILE_SIZE = 32;
const MIDDLE_X = PICTURE_WIDTH / 2;
const MIDDLE_Y = PICTURE_HEIGHT / 2;
const PLACES_BGRA = 4;
const PLACES_RGB = 3;
const PLACES_BITS = 8;
const BITS_BGRA = 32;
const FULL_ALPHA = 0xff;
const EXTENSION = "lay";
const BASE_EXTENSION = "png";
const UNDERLINE = "_";
const BASE_LAYER = 1;
const FACE_TOP = 4;
const FACE_SHIFT = 28;
const FACE_WORD = 8;
const FACE_MASK = 0xf;
const FACE_LAYER = 0x20000000;

export interface LayLayer {
	id: number;
	/** The first place of the tiles of the layer, and the count of them. */
	first: number;
	count: number;
}

export interface LayCoord {
	targetX: number;
	targetY: number;
	sourceX: number;
	sourceY: number;
}

export interface LayLayout {
	layers: LayLayer[];
	coords: LayCoord[];
	/** The name of the graphic the index stands of, of the directory of the file itself. */
	baseName: string;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The base name of the graphic beside an index, of the name of the index less a trailing underline. */
export function layBaseName(sourcePath: string): string {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	const dot = name.lastIndexOf(".");
	let base = dot > 0 ? name.slice(0, dot) : name;
	while (base.endsWith(UNDERLINE)) base = base.slice(0, -1);
	return base;
}

/** `LayOpener.TryOpen`: the index of the places of the layers and of the graphic of them. */
export function readLayLayout(data: Buffer): LayLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const layerCount = data.readInt32LE(0);
	const coordCount = data.readInt32LE(4);
	if (!isSaneCount(layerCount) || !isSaneCount(coordCount)) return undefined;
	if (
		HEAD_SIZE + layerCount * LAYER_SIZE + coordCount * COORD_SIZE >
		data.length
	) {
		return undefined;
	}
	const layers: LayLayer[] = [];
	let at = HEAD_SIZE;
	for (let layer = 0; layer < layerCount; layer += 1) {
		const id = data.readUInt32LE(at);
		const first = data.readInt32LE(at + 4);
		const count = data.readInt32LE(at + 8);
		if (first < 0 || count < 0) return undefined;
		layers.push({ id, first, count });
		at += LAYER_SIZE;
	}
	const coords: LayCoord[] = [];
	for (let coord = 0; coord < coordCount; coord += 1) {
		// The reference reads four single places and takes one off the two places of the graphic: the sum
		// of a single place and a whole one stands of a single place as well.
		coords.push({
			targetX: Math.fround(Math.fround(data.readFloatLE(at)) + 1),
			targetY: Math.fround(Math.fround(data.readFloatLE(at + 4)) + 1),
			sourceX: Math.fround(Math.fround(data.readFloatLE(at + 8)) - 1),
			sourceY: Math.fround(Math.fround(data.readFloatLE(at + 12)) - 1),
		});
		at += COORD_SIZE;
	}
	return { layers, coords, baseName: "" };
}

/** The tiles of a layer of the index, of the places the layer names within the list of them. */
export function layTiles(layout: LayLayout, layer: LayLayer): LayCoord[] {
	return layout.coords.slice(layer.first, layer.first + layer.count);
}

/** The layer of the word one, and the face of the picture behind a layer whose top place stands at four. */
function layerById(layout: LayLayout, id: number): LayLayer | undefined {
	return layout.layers.find((layer) => layer.id === id);
}

/** The layers of the index that are drawn when the engine asks for the layer of the word `id`. */
export function layDrawOrder(layout: LayLayout, id: number): LayLayer[] {
	const order: LayLayer[] = [];
	if (id !== BASE_LAYER) {
		const base = layerById(layout, BASE_LAYER);
		if (base) order.push(base);
	}
	if (id >>> FACE_SHIFT === FACE_TOP) {
		const face = ((id >>> FACE_WORD) & FACE_MASK) | FACE_LAYER;
		const layer = layerById(layout, face) ?? layerById(layout, face - 1);
		if (layer) order.push(layer);
	}
	const wanted = layerById(layout, id);
	if (wanted) order.push(wanted);
	return order;
}

/** The places of a picture and of a tile of it, of the blend of the tile over the picture. */
function blendTile(pixels: Buffer, picture: PngImage, coord: LayCoord): void {
	const from = Math.trunc(coord.sourceX);
	const at = Math.trunc(coord.sourceY);
	const to = Math.trunc(coord.targetX + MIDDLE_X);
	const row = Math.trunc(coord.targetY + MIDDLE_Y);
	const places = BITS_BGRA === picture.bitsPerPixel ? PLACES_BGRA : PLACES_RGB;
	for (let y = 0; y < TILE_SIZE; y += 1) {
		const target = row + y;
		if (target < 0 || target >= PICTURE_HEIGHT) continue;
		for (let x = 0; x < TILE_SIZE; x += 1) {
			const column = to + x;
			if (column < 0 || column >= PICTURE_WIDTH) continue;
			const source = from + x;
			const line = at + y;
			if (source < 0 || source >= picture.width) continue;
			if (line < 0 || line >= picture.height) continue;
			const at_source = (line * picture.width + source) * places;
			const at_target = (target * PICTURE_WIDTH + column) * PLACES_BGRA;
			blendPlace(
				pixels,
				at_target,
				picture.pixels[at_source] ?? 0,
				picture.pixels[at_source + 1] ?? 0,
				picture.pixels[at_source + 2] ?? 0,
				PLACES_BGRA === places
					? (picture.pixels[at_source + 3] ?? 0)
					: FULL_ALPHA,
			);
		}
	}
}

/** The blend of a place of a tile over a place of the picture, of the places of the memory of it. */
function blendPlace(
	pixels: Buffer,
	at: number,
	blue: number,
	green: number,
	red: number,
	alpha: number,
): void {
	const targetAlpha = pixels[at + 3] ?? 0;
	const keep = FULL_ALPHA - alpha;
	const outAlpha = alpha + Math.round((targetAlpha * keep) / FULL_ALPHA);
	if (0 === outAlpha) {
		pixels[at] = 0;
		pixels[at + 1] = 0;
		pixels[at + 2] = 0;
		pixels[at + 3] = 0;
		return;
	}
	const blend = (source: number, behind: number): number => {
		const over =
			Math.round((source * alpha) / FULL_ALPHA) +
			Math.round((behind * targetAlpha * keep) / (FULL_ALPHA * FULL_ALPHA));
		return Math.min(FULL_ALPHA, Math.round((over * FULL_ALPHA) / outAlpha));
	};
	pixels[at] = blend(blue, pixels[at] ?? 0);
	pixels[at + 1] = blend(green, pixels[at + 1] ?? 0);
	pixels[at + 2] = blend(red, pixels[at + 2] ?? 0);
	pixels[at + 3] = outAlpha;
}

/**
 * `LayOpener.OpenImage`: the picture of the engine a layer of the index names, of the graphic behind it.
 * The layer of the word one stands under the layer that was asked for, and a layer whose top place stands
 * at four stands over the face of the picture behind it.
 */
export function compositeLayPicture(
	layout: LayLayout,
	picture: PngImage,
	id: number,
): Buffer {
	const pixels = Buffer.alloc(
		PICTURE_WIDTH * PICTURE_HEIGHT * PLACES_BGRA,
		0x00,
	);
	for (const layer of layDrawOrder(layout, id)) {
		for (const coord of layTiles(layout, layer)) {
			blendTile(pixels, picture, coord);
		}
	}
	return pixels;
}

/** The name of a layer of the index, of the name of the index and the word of the layer. */
export function layEntryName(baseName: string, id: number): string {
	return `${baseName}#${id.toString(16).toUpperCase().padStart(8, "0")}`;
}

/** The graphic an index of the engine stands of, of the name of the index itself. */
export async function readLayPicture(
	sourcePath: string,
): Promise<PngImage | undefined> {
	const base = layBaseName(sourcePath);
	const file = await readCompanionFile(sourcePath, `${base}.${BASE_EXTENSION}`);
	if (!file) return undefined;
	return readPngImage(file);
}

export const nitroplusLayImageDescriptor: FormatDescriptor = {
	id: "nitroplus-lay-image",
	name: "MAGES engine composite image",
	extensions: [EXTENSION],
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
			source: "ArcFormats/NitroPlus/ArcLAY.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nitroplusLayImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nitroplusLayImageDescriptor,
	// The reference takes a file of any mark as a candidate and stands of the extension of the name alone.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		if (
			sourcePath
				.replace(/^.*[/\\]/, "")
				.toLowerCase()
				.endsWith(`.${EXTENSION}`) === false
		) {
			return false;
		}
		try {
			const layout = readLayLayout(await readStored(source));
			if (!layout) return false;
			// The reference gives up on an index whose graphic stands nowhere beside it as well.
			return (await readLayPicture(sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readLayLayout(data);
		if (!layout) throw invalidPicture("Not an index of the engine");
		const picture = await readLayPicture(sourcePath);
		if (!picture)
			throw invalidPicture("The graphic of the index stands nowhere");
		const base = layBaseName(sourcePath);
		const entries: FixedEntry[] = layout.layers.map((layer) =>
			createFixedEntry({
				id: layer.id,
				path: layEntryName(base, layer.id),
				offset: 0n,
				size: 0n,
				compressed: true,
				metadata: {
					type: "image",
					layer: layer.id,
					tiles: layer.count,
					width: PICTURE_WIDTH,
					height: PICTURE_HEIGHT,
					bitsPerPixel: PLACES_BITS * PLACES_BGRA,
				},
			}),
		);
		return {
			entries,
			metadata: {
				image: "bmp",
				layers: layout.layers.length,
				tiles: layout.coords.length,
				width: PICTURE_WIDTH,
				height: PICTURE_HEIGHT,
				bitsPerPixel: PLACES_BITS * PLACES_BGRA,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const data = await readStored(source);
		const layout = readLayLayout(data);
		if (!layout) throw invalidPicture("Not an index of the engine");
		const picture = await readLayPicture(sourcePath);
		if (!picture)
			throw invalidPicture("The graphic of the index stands nowhere");
		const id = Number(entry.id);
		const pixels = compositeLayPicture(layout, picture, id);
		return Readable.from([writeBmp32(PICTURE_WIDTH, PICTURE_HEIGHT, pixels)]);
	},
});
