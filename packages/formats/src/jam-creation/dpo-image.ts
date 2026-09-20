// Format reference: GARbro "ArcFormats/JamCreation/ImageDPO.cs", classes `DpoFormat`, `DpoMetaData` and
// `DpoReader` (a Jam Creation picture: a canvas of one shape, put together out of tiles which stand in
// pictures of their own beside the file, every tile naming its picture, where its picture stands, where it
// stands on the canvas and how far it stands from the edges of its picture). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, toBgra32, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'Divided Picture', the word the reference registers. */
const SIGNATURE = Buffer.from("Divided Picture", "latin1");
const HEADER_SIZE = 0x30;
const ROOT_FLAG_FIELD = 0x10;
const VERSION_FIELD = 0x14;
const INFO_FIELD = 0x18;
const LAYOUT_MINIMUM_FIELD = 0x1c;
const NAME_TABLE_FIELD = 0x20;
const NAME_TABLE_SIZE_FIELD = 0x24;
const LAYOUT_FIELD = 0x28;
/** A name of the table is thirty two bytes wide, one of them the nought behind it. */
const NAME_SIZE = 0x20;
/** The two shapes of the picture the reference reads. */
const FIRST_VERSION = 1;
const LAST_VERSION = 2;
/** How many tiles a picture may be put together out of, and how wide a tile is. */
const MAXIMUM_TILES = 0x10000;
const MAXIMUM_TILE_SIZE = 0x10000;
/** How far a tile stands from the edges of its picture, as a share of the picture. */
const OFFSET_X_DEF = 0;
const OFFSET_Y_DEF = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface DpoTile {
	/** Which of the pictures beside the file the tile stands in. */
	fileNumber: number;
	/** Where the tile stands on the canvas. */
	x: number;
	y: number;
	/** How far the tile stands from the left and the top edge of its picture, as a share of the picture. */
	offsetX: number;
	offsetY: number;
	/** How many places of its picture the tile takes. */
	width: number;
	height: number;
}

export interface DpoLayout {
	width: number;
	height: number;
	version: number;
	/** The names of the pictures the tiles stand in, in the order the file names them. */
	names: string[];
	/** How many places a tile of the first shape takes. */
	tileSize: number;
	tiles: DpoTile[];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `DpoFormat.ReadMetaData`: the file begins with the word `Divided Picture`, the word at `0x10` is one, the
 * word at `0x14` is the shape of the picture, and the words behind it say where the shape of the canvas, the
 * names of the tiles that make it up and the layout of them stand. A name of the table is thirty two bytes
 * wide and a name that begins with `.\\` stands beside the file itself.
 */
export function readDpoLayout(
	data: Buffer,
	fileLength = data.length,
): DpoLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (1 !== data.readInt32LE(ROOT_FLAG_FIELD)) return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	if (version !== FIRST_VERSION && version !== LAST_VERSION) return undefined;
	if (data.readInt32LE(LAYOUT_MINIMUM_FIELD) < 4) return undefined;
	const infoOffset = data.readInt32LE(INFO_FIELD);
	const nameTableOffset = data.readInt32LE(NAME_TABLE_FIELD);
	const nameTableSize = data.readInt32LE(NAME_TABLE_SIZE_FIELD);
	const layoutOffset = data.readInt32LE(LAYOUT_FIELD);
	if (infoOffset < 0 || nameTableOffset < 0 || layoutOffset < 0) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const info = readSlice(data, infoOffset, 4, fileLength, "canvas");
	const width = info.readUInt16LE(0);
	const height = info.readUInt16LE(2);
	if (width <= 0 || height <= 0) return undefined;
	if (width * height > LIMIT) return undefined;
	const table = readSlice(
		data,
		nameTableOffset,
		Math.max(nameTableSize, 2),
		fileLength,
		"names",
	);
	const nameCount = table.readUInt16LE(0);
	if (nameCount * NAME_SIZE + 2 !== nameTableSize) return undefined;
	const names: string[] = [];
	for (let index = 0; index < nameCount; index += 1) {
		const at = 2 + index * NAME_SIZE;
		let end = at;
		while (
			end < table.length &&
			end < at + NAME_SIZE &&
			0 !== (table[end] ?? 0)
		) {
			end += 1;
		}
		let name = table.toString("latin1", at, end);
		if (name.startsWith(".\\")) name = name.slice(2);
		names.push(name);
	}
	const layout = readSlice(
		data,
		layoutOffset,
		fileLength - layoutOffset,
		fileLength,
		"layout",
	);
	const count = layout.readInt32LE(0);
	const tileSize = layout.readInt32LE(4);
	if (count <= 0 || count > MAXIMUM_TILES) return undefined;
	if (tileSize <= 0 || tileSize > MAXIMUM_TILE_SIZE) return undefined;
	const tiles: DpoTile[] = [];
	let at = 8;
	for (let index = 0; index < count; index += 1) {
		const defs = readSlice(
			layout,
			at,
			8 * 4 + 2 + 2 + 2,
			layout.length,
			"tiles",
		);
		const offsetX = defs.readFloatLE(OFFSET_X_DEF * 4);
		const offsetY = defs.readFloatLE(OFFSET_Y_DEF * 4);
		const fileNumber = defs.readUInt16LE(0x20);
		const x = defs.readUInt16LE(0x22);
		const y = defs.readUInt16LE(0x24);
		at += 0x26;
		let tileWidth = tileSize;
		let tileHeight = tileSize;
		if (version > FIRST_VERSION) {
			const extra = readSlice(layout, at, 4, layout.length, "tiles");
			tileWidth = extra.readUInt16LE(0);
			tileHeight = extra.readUInt16LE(2);
			at += 4;
		}
		if (fileNumber >= nameCount) return undefined;
		tiles.push({
			fileNumber,
			x,
			y,
			offsetX,
			offsetY,
			width: tileWidth,
			height: tileHeight,
		});
	}
	return { width, height, version, names, tileSize, tiles };
}

/** A slice of the file, refused where it does not stand in it at all. */
function readSlice(
	data: Buffer,
	offset: number,
	size: number,
	fileLength: number,
	what: string,
): Buffer {
	if (!Number.isSafeInteger(offset) || offset < 0) {
		throw invalidPicture(`Jam Creation picture has no ${what}`);
	}
	if (offset + Math.max(size, 0) > fileLength) {
		throw invalidPicture(`Jam Creation picture is cut short of its ${what}`);
	}
	const end = Math.min(offset + Math.max(size, 0), data.length);
	return data.subarray(offset, end);
}

interface DpoSource {
	width: number;
	height: number;
	bgra: Buffer;
}

async function readDpoSources(
	sourcePath: string,
	layout: DpoLayout,
): Promise<DpoSource[] | undefined> {
	const cache = new Map<string, DpoSource | undefined>();
	const sources: DpoSource[] = [];
	for (const name of layout.names) {
		if (!cache.has(name)) {
			const stored = await readCompanionFile(sourcePath, name);
			if (!stored) {
				cache.set(name, undefined);
			} else {
				const bmp = readBmpImage(stored);
				// The shape of a place of a tile is what stands the tiles of a canvas beside each other.
				const bgra = bmp ? toBgra32(bmp, true) : undefined;
				cache.set(
					name,
					bmp && bgra
						? { width: bmp.width, height: bmp.height, bgra }
						: undefined,
				);
			}
		}
		const source = cache.get(name);
		if (!source) return undefined;
		sources.push(source);
	}
	return sources;
}

/**
 * `DpoReader.CopyTile`: the tile is taken out of its picture where the shares it names say it stands — the
 * shares are of the width of the picture for its left edge and of its height for its top edge — and stands on
 * the canvas at the place the tile names. What stands beyond the canvas is left out, the canvas standing as it
 * is everywhere else.
 */
export function composeDpo(sources: DpoSource[], layout: DpoLayout): Buffer {
	const canvasStride = layout.width * 4;
	const canvas: Buffer = Buffer.alloc(layout.height * canvasStride, 0x00);
	const tileStride = layout.tileSize * 4;
	const buffer: Buffer = Buffer.alloc(layout.tileSize * tileStride, 0x00);
	for (const tile of layout.tiles) {
		const source = sources[tile.fileNumber];
		if (!source)
			throw invalidPicture("Jam Creation picture has no tile picture");
		const sourceX = Math.trunc(source.width * tile.offsetX);
		const sourceY = Math.trunc(source.height * tile.offsetY);
		if (
			sourceX < 0 ||
			sourceY < 0 ||
			sourceX + tile.width > source.width ||
			sourceY + tile.height > source.height
		) {
			throw invalidPicture("Jam Creation tile stands beyond its picture");
		}
		if (tile.width * 4 > tileStride) {
			throw invalidPicture("Jam Creation tile stands beyond its own room");
		}
		buffer.fill(0x00);
		for (let row = 0; row < tile.height; row += 1) {
			const sourceAt = ((sourceY + row) * source.width + sourceX) * 4;
			source.bgra.copy(
				buffer,
				row * tileStride,
				sourceAt,
				sourceAt + tile.width * 4,
			);
		}
		const width = Math.min(tile.width, layout.width - tile.x);
		const height = Math.min(tile.height, layout.height - tile.y);
		if (width < 0 || height < 0) {
			throw invalidPicture("Jam Creation tile stands beyond its canvas");
		}
		for (let row = 0; row < height; row += 1) {
			const canvasAt = (tile.y + row) * canvasStride + tile.x * 4;
			buffer.copy(
				canvas,
				canvasAt,
				row * tileStride,
				row * tileStride + width * 4,
			);
		}
	}
	return writeBmp32(layout.width, layout.height, canvas);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The layout of a picture, read from the whole file so that the slices of it can be handed out. */
function readLayout(stored: Buffer): DpoLayout | undefined {
	try {
		return readDpoLayout(stored, stored.length);
	} catch {
		return undefined;
	}
}

export const jamCreationDpoImageDescriptor: FormatDescriptor = {
	id: "jam-creation-dpo-image",
	name: "Jam Creation tiled image format",
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
			source: "ArcFormats/JamCreation/ImageDPO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const jamCreationDpoImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: jamCreationDpoImageDescriptor,
	// The reference registers the word `Divided Picture` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
			return readLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readDpoLayout(stored, stored.length);
		if (!layout) throw invalidPicture("Not a Jam Creation picture");
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
					bitsPerPixel: 32,
					tiles: layout.tiles.length,
				},
			}),
			// The canvas is put together out of the tiles the pictures beside the file hold.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 32 },
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		if (!sourcePath) {
			throw invalidPicture(
				"Jam Creation picture has no name to find its tiles by",
			);
		}
		const stored = await readStored(source);
		const layout = readDpoLayout(stored, stored.length);
		if (!layout) throw invalidPicture("Not a Jam Creation picture");
		const sources = await readDpoSources(sourcePath, layout);
		if (!sources) {
			throw invalidPicture("Jam Creation picture has no tiles beside it");
		}
		return Readable.from([composeDpo(sources, layout)]);
	},
});
