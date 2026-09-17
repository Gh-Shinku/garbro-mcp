// Format reference: GARbro "ArcFormats/Zyx/ImageSPL.cs", classes `SplFormat`, `SplReader` and `Tile` (a
// twenty four bit picture whose head may carry a list of tiles, decoded by a walk of six kinds of command).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head begins with a signed word of tiles, of which the reference allows none to two hundred and fifty six. */
const MAX_TILES = 0x100;
/** One tile is four signed words: its left, top, right and bottom edges. */
const TILE_SIZE = 8;
const BYTES_PER_PIXEL = 3;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface SplTile {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface SplLayout {
	width: number;
	height: number;
	/** The tiles the head carries, which the reference reads but never uses. */
	tiles: readonly SplTile[];
	/** Where the walk of pixels stands behind the head. */
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `SplFormat.ReadMetaData`: a signed word of tiles, of which none to two hundred and fifty six is allowed,
 * each tile being four signed words whose edges must not stand before the start of the picture and whose
 * right and bottom edges must stand behind their left and top ones. Behind them stand the width and the
 * height of the picture, and every tile must lie inside it. The depth is always reported as twenty four bits,
 * and the walk stands right behind the head. A picture whose pixels would take more than 256 megabytes is
 * refused rather than allocated, which the reference would answer by running out of memory.
 */
export function readSplLayout(data: Buffer): SplLayout | undefined {
	if (data.length < 2) return undefined;
	const count = data.readInt16LE(0);
	if (count < 0 || count > MAX_TILES) return undefined;
	let position = 2;
	const tiles: SplTile[] = [];
	for (let index = 0; index < count; index += 1) {
		if (position + TILE_SIZE > data.length) return undefined;
		const left = data.readInt16LE(position);
		const top = data.readInt16LE(position + 2);
		const right = data.readInt16LE(position + 4);
		const bottom = data.readInt16LE(position + 6);
		if (left < 0 || top < 0) return undefined;
		if (right <= left || bottom <= top) return undefined;
		tiles.push({ left, top, right, bottom });
		position += TILE_SIZE;
	}
	if (position + 4 > data.length) return undefined;
	const width = data.readInt16LE(position);
	const height = data.readInt16LE(position + 2);
	position += 4;
	if (width <= 0 || height <= 0) return undefined;
	for (const tile of tiles) {
		if (tile.right > width || tile.bottom > height) return undefined;
	}
	const size = width * height * BYTES_PER_PIXEL;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, tiles, dataOffset: position };
}

/**
 * `SplReader.Unpack`: a walk of six kinds of command, told apart by one leading byte.
 *
 * | byte | what it does |
 * | --- | --- |
 * | `0` | the byte behind it is a count of repeats of the pixel before the run |
 * | `1` | the byte behind it is the count and the byte behind that the distance in pixels, one byte |
 * | `2` | the count is a byte and the distance a word behind it |
 * | `3` | the byte behind it is the distance in pixels, one pixel is copied |
 * | `4` | the word behind it is the distance in pixels, one pixel is copied |
 * | five and above | three times the byte less four is a run of pixels that stand in the stream themselves |
 *
 * A count of the first three kinds is multiplied by three before it is copied, so a copy works on whole
 * pixels and one that stands one pixel behind repeats the pixel before it. A command that reaches outside
 * the picture is refused, which the reference's own array reads and writes answer with an exception (a
 * documented deviation in the message only), while a run that stops at the end of the stream leaves the
 * pixels it no longer covers as they stand, which is how a region behaves for the reference.
 */
export function unpackSpl(input: Buffer, layout: SplLayout): Buffer {
	const output: Buffer = Buffer.alloc(
		layout.width * layout.height * BYTES_PER_PIXEL,
		0x00,
	);
	let position = layout.dataOffset;
	const readByte = (): number => {
		if (position >= input.length) return -1;
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	const readWord = (): number => {
		const low = readByte();
		if (low < 0) return -1;
		const high = readByte();
		if (high < 0) return -1;
		return (high << 8) | low;
	};
	const copy = (source: number, destination: number, count: number): void => {
		if (source < 0 || destination < 0 || destination + count > output.length) {
			throw invalidPicture("Zyx tiled picture writes past its own end");
		}
		for (let index = 0; index < count; index += 1) {
			output[destination + index] = output[source + index] ?? 0;
		}
	};
	let dst = 0;
	while (dst < output.length) {
		const command = readByte();
		if (command < 0) break;
		switch (command) {
			case 0: {
				const count = readByte();
				if (count < 0) break;
				if (
					dst < BYTES_PER_PIXEL ||
					dst + count * BYTES_PER_PIXEL > output.length
				) {
					throw invalidPicture("Zyx tiled picture writes past its own end");
				}
				for (let index = 0; index < count; index += 1) {
					const pixel = dst - BYTES_PER_PIXEL;
					output[dst] = output[pixel] ?? 0;
					output[dst + 1] = output[pixel + 1] ?? 0;
					output[dst + 2] = output[pixel + 2] ?? 0;
					dst += BYTES_PER_PIXEL;
				}
				break;
			}
			case 1:
			case 2: {
				const count = readByte();
				const distance = 2 === command ? readWord() : readByte();
				if (count < 0 || distance < 0) break;
				const length = count * BYTES_PER_PIXEL;
				copy(dst - distance * BYTES_PER_PIXEL, dst, length);
				dst += length;
				break;
			}
			case 3:
			case 4: {
				const distance = 4 === command ? readWord() : readByte();
				if (distance < 0) break;
				copy(dst - distance * BYTES_PER_PIXEL, dst, BYTES_PER_PIXEL);
				dst += BYTES_PER_PIXEL;
				break;
			}
			default: {
				const length = (command - 4) * BYTES_PER_PIXEL;
				if (length <= 0 || dst + length > output.length) {
					throw invalidPicture("Zyx tiled picture writes past its own end");
				}
				const end = Math.min(position + length, input.length);
				if (end > position) input.copy(output, dst, position, end);
				position = end;
				dst += length;
				break;
			}
		}
	}
	return output;
}

export const zyxSplImageDescriptor: FormatDescriptor = {
	id: "zyx-spl-image",
	name: "Zyx tiled image format",
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
			source: "ArcFormats/Zyx/ImageSPL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readLayout(source: ByteSource): Promise<SplLayout | undefined> {
	if (source.size < 6n) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readSplLayout(stored);
	} catch {
		return undefined;
	}
}

export const zyxSplImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zyxSplImageDescriptor,
	// The reference declares no signature and gates on nothing else, so any file can be a candidate.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Zyx tiled picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 24,
					tiles: layout.tiles,
				},
			}),
			// The pixels are unfolded from a walk and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
				tiles: layout.tiles,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Zyx tiled picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackSpl(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
