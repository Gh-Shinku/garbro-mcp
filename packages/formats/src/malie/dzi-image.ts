// Malie tiled picture descriptor (DZI), of the reference `ArcFormats/Malie/ImageDZI.cs` (`DziFormat`,
// `DziMetaData`, `DziTile`).
//
// The file is a text descriptor rather than a picture of its own: the picture stands of the tiles of a
// `tex` directory beside the descriptor, of 256 places a tile, of the places of the descriptor that name
// them. The reference hands every tile over to whichever format of its registry reads it and stands the
// places of it in a picture of the counts of the head; this port reads a tile of the two kinds this project
// reads out of a file of its own (a bitmap and a portable network graphic) and turns the rest away.
//
// The reference stands of the **first** level of the places of the head and parses the levels behind it into
// the metadata alone: a level of the walk is the first one, and a place of every other level stands reported
// rather than read. The places of the picture of the tiles stand of the counts of the head, of the tiles
// standing over no place of it at all where they stand past it; the picture itself is cropped to the places
// the tiles reach, so the places of the picture of the walk can be smaller than the counts of the head.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { readBmpImage, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, listCompanionFiles } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngImage } from "../shared/png-image.js";

/** `'DZI\r'`: the word the reference registers, of the place of the walk of the line behind it. */
const MARK_VALUE = 0x0d495a44;
const MARK_SIZE = 4;
/** The places of a tile of the picture, of the count the reference steps the places of it by. */
const TILE_PLACES = 256;
const PLACES_PER_COLOUR = 4;
const PLACES_BGR = 3;
const BITS_BGRA = 32;
const BITS_BGR = 24;
/** The directory the tiles of the descriptor stand in, beside the descriptor itself. */
const TILE_DIRECTORY = "tex";
const TEXT_ENCODING = "utf8";
const PAIR = /^(\d+),(\d+)/;
const COUNT_LIMIT = 0x7fff;
const PLACES_LIMIT = 0xffff;
const COMMA = ",";
/** The kinds of a tile the reference reads through its registry and this port does not walk. */
const UNREAD_KINDS = new Set([
	"jpg",
	"jpeg",
	"jpe",
	"gif",
	"tif",
	"tiff",
	"webp",
]);

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** A tile of a level of the picture: the places of it within the picture, and the file of it. */
export interface DziTile {
	x: number;
	y: number;
	fileName: string;
}

/** A level of the picture: the counts of the places of it and the tiles of them. */
export interface DziLevel {
	blockWidth: number;
	blockHeight: number;
	tiles: DziTile[];
}

export interface DziLayout {
	width: number;
	height: number;
	levels: DziLevel[];
}

/** The count of a pair of places at the head of a line of the descriptor, as the reference reads it. */
function pairOf(line: string): [number, number] | undefined {
	const match = PAIR.exec(line);
	if (!match) return undefined;
	const left = Number.parseInt(match[1] ?? "", 10);
	const right = Number.parseInt(match[2] ?? "", 10);
	if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;
	if (left > PLACES_LIMIT || right > PLACES_LIMIT) return undefined;
	return [left, right];
}

/** `DziFormat.ReadMetaData`: the walk of the lines of the descriptor, of the places of it. */
export function readDziDescriptor(data: Buffer): DziLayout | undefined {
	if (data.length < MARK_SIZE) return undefined;
	if (data.readUInt32LE(0) !== MARK_VALUE) return undefined;
	const lines = data
		.toString(TEXT_ENCODING)
		.split("\n")
		.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	// The first line of the descriptor stands of the signature alone.
	let at = 1;
	if (at >= lines.length) return undefined;
	const head = pairOf(lines[at] ?? "");
	if (!head) return undefined;
	at += 1;
	const [width, height] = head;
	if (at >= lines.length) return undefined;
	const count = Number.parseInt((lines[at] ?? "").trim(), 10);
	at += 1;
	if (!Number.isFinite(count) || count <= 0 || count > COUNT_LIMIT) {
		return undefined;
	}
	const levels: DziLevel[] = [];
	for (let level = 0; level < count; level += 1) {
		if (at >= lines.length) return undefined;
		const block = pairOf(lines[at] ?? "");
		if (!block) return undefined;
		at += 1;
		const [blockWidth, blockHeight] = block;
		const tiles: DziTile[] = [];
		for (let row = 0; row < blockHeight; row += 1) {
			if (at >= lines.length) return undefined;
			const line = (lines[at] ?? "").replace(/\s+$/, "");
			at += 1;
			let x = 0;
			// A place of no name of the line stands of a place of the picture as well, of no tile over it.
			for (const name of line.split(COMMA)) {
				if (name.length > 0) {
					tiles.push({ x, y: row * TILE_PLACES, fileName: name });
				}
				x += TILE_PLACES;
			}
		}
		levels.push({ blockWidth, blockHeight, tiles });
	}
	return { width, height, levels };
}

/** Whether the `tex` directory of the descriptor stands beside it, which the reference asks of it. */
export async function hasDziTiles(sourcePath: string): Promise<boolean> {
	try {
		const place = await stat(resolve(dirname(sourcePath), TILE_DIRECTORY));
		return place.isDirectory();
	} catch {
		return false;
	}
}

/** The places of a tile of the picture: four places a colour, of the top of it down. */
export interface DziTilePlaces {
	width: number;
	height: number;
	pixels: Buffer;
}

function tilePlacesOf(
	width: number,
	height: number,
	pixels: Buffer,
	bitsPerPixel: number,
): DziTilePlaces | undefined {
	if (BITS_BGRA === bitsPerPixel) return { width, height, pixels };
	if (BITS_BGR !== bitsPerPixel) return undefined;
	// The reference stands the places of a tile of three places a colour in a picture of four of them, of an
	// alpha of the picture behind it.
	const places = Buffer.alloc(width * height * PLACES_PER_COLOUR, 0xff);
	for (let place = 0; place < width * height; place += 1) {
		places[place * PLACES_PER_COLOUR] = pixels[place * PLACES_BGR] ?? 0;
		places[place * PLACES_PER_COLOUR + 1] = pixels[place * PLACES_BGR + 1] ?? 0;
		places[place * PLACES_PER_COLOUR + 2] = pixels[place * PLACES_BGR + 2] ?? 0;
	}
	return { width, height, pixels: places };
}

/** The places of a tile of the picture, of the two kinds of a picture this project reads. */
async function readDziTile(
	sourcePath: string,
	fileName: string,
): Promise<DziTilePlaces | undefined> {
	const candidates = await listCompanionFiles(
		sourcePath,
		`${TILE_DIRECTORY}/${fileName}`,
	);
	for (const candidate of candidates) {
		let file: Buffer;
		try {
			file = await readFile(candidate);
		} catch {
			continue;
		}
		// A tile of no walk this project reads stands of no picture of the engine either, and the reference
		// hands such a tile over to no format of its own as well.
		try {
			const bitmap = readBmpImage(file);
			if (bitmap) {
				const places = tilePlacesOf(
					bitmap.width,
					bitmap.height,
					bitmap.pixels,
					bitmap.bitsPerPixel,
				);
				if (places) return places;
			}
			const png = await readPngImage(file);
			if (png) {
				const places = tilePlacesOf(
					png.width,
					png.height,
					png.pixels,
					png.bitsPerPixel,
				);
				if (places) return places;
			}
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * `DziFormat.Read`: the places of the tiles of the first level of the head over each other, cropped to the
 * places the tiles reach.
 */
export async function composeDziPicture(
	sourcePath: string,
	layout: DziLayout,
): Promise<DziTilePlaces> {
	const level = layout.levels[0];
	if (!level)
		throw invalidPicture("The head of the picture names no place of a picture");
	const pixels = Buffer.alloc(
		layout.width * layout.height * PLACES_PER_COLOUR,
		0x00,
	);
	let actualWidth = 0;
	let actualHeight = 0;
	for (const tile of level.tiles) {
		const places = await readDziTile(sourcePath, tile.fileName);
		if (!places) {
			throw invalidPicture(
				`The tile ${tile.fileName} of the picture stands nowhere`,
			);
		}
		const width = Math.min(places.width, layout.width - tile.x);
		const height = Math.min(places.height, layout.height - tile.y);
		if (width <= 0 || height <= 0) continue;
		const sourceStride = places.width * PLACES_PER_COLOUR;
		const canvasStride = layout.width * PLACES_PER_COLOUR;
		for (let row = 0; row < height; row += 1) {
			const to = (tile.y + row) * canvasStride + tile.x * PLACES_PER_COLOUR;
			const from = row * sourceStride;
			places.pixels.copy(pixels, to, from, from + width * PLACES_PER_COLOUR);
		}
		if (tile.x + width > actualWidth) actualWidth = tile.x + width;
		if (tile.y + height > actualHeight) actualHeight = tile.y + height;
	}
	if (0 === actualWidth || 0 === actualHeight) {
		throw invalidPicture(
			"The picture of the descriptor stands of no tile at all",
		);
	}
	if (actualWidth >= layout.width && actualHeight >= layout.height) {
		return { width: layout.width, height: layout.height, pixels };
	}
	// The reference crops the picture to the places the tiles reach.
	const cropped = Buffer.alloc(
		actualWidth * actualHeight * PLACES_PER_COLOUR,
		0x00,
	);
	const canvasStride = layout.width * PLACES_PER_COLOUR;
	const croppedStride = actualWidth * PLACES_PER_COLOUR;
	for (let row = 0; row < actualHeight; row += 1) {
		pixels.copy(
			cropped,
			row * croppedStride,
			row * canvasStride,
			row * canvasStride + croppedStride,
		);
	}
	return { width: actualWidth, height: actualHeight, pixels: cropped };
}

/** Whether the places of a tile stand of a kind of a picture the reference reads and this port does not. */
export function isUnreadTile(fileName: string): boolean {
	const at = fileName.lastIndexOf(".");
	if (at < 0) return false;
	return UNREAD_KINDS.has(fileName.slice(at + 1).toLowerCase());
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const dziImageDescriptor: FormatDescriptor = {
	id: "malie-dzi-image",
	name: "Malie tiled image descriptor",
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
			source: "ArcFormats/Malie/ImageDZI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dziImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dziImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("DZI", "latin1") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(MARK_SIZE)) return false;
		try {
			const layout = readDziDescriptor(await readStored(source));
			if (!layout) return false;
			// The reference asks its file system for the directory of the tiles of the descriptor, so a
			// descriptor of no tiles beside it is no picture of this engine.
			return await hasDziTiles(sourcePath);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDziDescriptor(await readStored(source));
		if (!layout) throw invalidPicture("Not a descriptor of a tiled picture");
		if (!(await hasDziTiles(sourcePath))) {
			throw invalidPicture("The tiles of the picture stand nowhere");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const level = layout.levels[0];
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
					bitsPerPixel: BITS_BGRA,
					tiles: level ? level.tiles.length : 0,
					levels: layout.levels.length,
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
				tiles: level ? level.tiles.length : 0,
				levels: layout.levels.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		void entry;
		const layout = readDziDescriptor(await readStored(source));
		if (!layout) throw invalidPicture("Not a descriptor of a tiled picture");
		const level = layout.levels[0];
		for (const tile of level ? level.tiles : []) {
			if (isUnreadTile(tile.fileName)) {
				throw unsupportedPicture(
					`The tile ${tile.fileName} of the picture stands of a kind of its own`,
				);
			}
		}
		const picture = await composeDziPicture(sourcePath, layout);
		return Readable.from([
			writeBmp32(picture.width, picture.height, picture.pixels, false),
		]);
	},
});
