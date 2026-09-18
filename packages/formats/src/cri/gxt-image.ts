// Format reference: GARbro "ArcFormats/Cri/ImageGXT.cs", classes `GxtFormat`, `GxtMetaData` and the walk
// inside the format (a texture of the CRI Middleware kind: a head of sixty four bytes and then the blocks of
// a picture of the fifth compressed kind, every one of them standing where a turning of the two places of its
// place in the picture says). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { DXT_BLOCK_SIZE, decompressDxt5Block } from "../shared/dxt.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'GXT', the word the reference registers. */
const SIGNATURE = Buffer.from("GXT", "latin1");
const HEADER_SIZE = 0x40;
/** The word every picture of the engine stands behind. */
const MARK_FIELD = 0x04;
const MARK_VALUE = 0x10000003;
const TEXTURE_OFFSET_FIELD = 0x20;
const TEXTURE_LENGTH_FIELD = 0x24;
const PALETTE_INDEX_FIELD = 0x28;
const FLAGS_FIELD = 0x2c;
const TEXTURE_TYPE_FIELD = 0x30;
const TEXTURE_FORMAT_FIELD = 0x34;
const WIDTH_FIELD = 0x38;
const HEIGHT_FIELD = 0x3a;
/** The one kind of picture the reference reads, a picture of the fifth kind of block. */
const FORMAT_UBC3 = 0x87000000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GxtLayout {
	width: number;
	height: number;
	textureOffset: number;
	textureLength: number;
	paletteIndex: number;
	flags: number;
	textureType: number;
	textureFormat: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GxtFormat.ReadMetaData`: the file begins with the word `GXT` — the word the reference registers — and the
 * word `0x10000003` at four, the width and the height stand at `0x38` and `0x3A` as words of two bytes, the
 * place of the picture at `0x20` and its size at `0x24`, the place of a colour map at `0x28`, the flags at
 * `0x2C`, and the kind of turning and the kind of picture at `0x30` and `0x34`.
 */
export function readGxtLayout(
	data: Buffer,
	fileLength = data.length,
): GxtLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (MARK_VALUE !== data.readInt32LE(MARK_FIELD)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const textureOffset = data.readUInt32LE(TEXTURE_OFFSET_FIELD);
	const textureLength = data.readInt32LE(TEXTURE_LENGTH_FIELD);
	if (textureLength < 0 || textureOffset + textureLength > fileLength) {
		return undefined;
	}
	return {
		width,
		height,
		textureOffset,
		textureLength,
		paletteIndex: data.readInt32LE(PALETTE_INDEX_FIELD),
		flags: data.readUInt32LE(FLAGS_FIELD),
		textureType: data.readUInt32LE(TEXTURE_TYPE_FIELD),
		textureFormat: data.readUInt32LE(TEXTURE_FORMAT_FIELD),
	};
}

/** `BitScanReverse`: the place of the highest bit of a number that stands above nought. */
export function bitScanReverse(value: number): number {
	let shift = value >>> 0;
	let place = 0;
	for (shift >>>= 1; shift !== 0; shift >>>= 1) place += 1;
	return place;
}

/** `Compact1By1`: the even places of a number gathered together. */
function compact1By1(value: number): number {
	let at = (value & 0x55555555) >>> 0;
	at = ((at ^ (at >>> 1)) & 0x33333333) >>> 0;
	at = ((at ^ (at >>> 2)) & 0x0f0f0f0f) >>> 0;
	at = ((at ^ (at >>> 4)) & 0x00ff00ff) >>> 0;
	at = ((at ^ (at >>> 8)) & 0x0000ffff) >>> 0;
	return at;
}

/** `DecodeCoord2X` and `DecodeCoord2Y`: the two places a number of the kind of turning holds. */
function decodeCoord2X(code: number): number {
	return compact1By1(code);
}

function decodeCoord2Y(code: number): number {
	return compact1By1(code >> 1);
}

export interface GxtCoords {
	x: number;
	y: number;
}

/**
 * `GetSwizzledCoords`: the two places of a block of the picture are read as a number — the row of blocks
 * times how many blocks stand in a row, and then the place in that row — and that number is turned around:
 * the places above the two lowest pairs stand as they are, and the two pairs themselves are woven together
 * with the lowest pair of one of the two turned numbers and of the other behind them. Where a picture is
 * taller than it is wide the two numbers swap places, and where it is not the turned number is read as a row
 * of blocks and a place within it the other way round. A picture with no blocks at all in a direction is
 * taken to hold sixteen — which is what the reference reaches for when its own division gives nought.
 */
export function swizzledCoords(
	originalX: number,
	originalY: number,
	width: number,
	height: number,
): GxtCoords {
	let columns = width;
	let rows = height;
	if (columns === 0) columns = 16;
	if (rows === 0) rows = 16;
	const at = originalY * columns + originalX;
	const smallest = Math.min(columns, rows);
	const shifts = bitScanReverse(smallest);
	const above = ((at >>> (2 * shifts)) << (2 * shifts)) >>> 0;
	if (rows < columns) {
		// XXXyxyxyx -> XXXxxxyyy
		const turned =
			above |
			((decodeCoord2Y(at) & (smallest - 1)) << shifts) |
			(decodeCoord2X(at) & (smallest - 1));
		return {
			x: Math.floor(turned / rows),
			y: turned % rows,
		};
	}
	// YYYyxyxyx -> YYYyyyxxx
	const turned =
		above |
		((decodeCoord2X(at) & (smallest - 1)) << shifts) |
		(decodeCoord2Y(at) & (smallest - 1));
	return {
		x: turned % columns,
		y: Math.floor(turned / columns),
	};
}

/**
 * The walk of the picture: every block of four by four pixels of the picture takes the bytes of a block of the
 * fifth kind from the place the turning of its own two places gives, so the blocks of the picture do not stand
 * in the order of the picture itself but in an order the turning of two places works out.
 */
export function unpackGxt(stored: Buffer, layout: GxtLayout): Buffer {
	const stride = layout.width * 4;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const blocksWide = Math.ceil(layout.width / DXT_BLOCK_SIZE);
	const blocksHigh = Math.ceil(layout.height / DXT_BLOCK_SIZE);
	const needed = blocksWide * blocksHigh * 16;
	if (layout.textureOffset + needed > stored.length) {
		throw invalidPicture("CRI Middleware picture is cut short of its blocks");
	}
	const input = stored.subarray(
		layout.textureOffset,
		layout.textureOffset + Math.max(needed, layout.textureLength),
	);
	let src = 0;
	for (let y = 0; y < layout.height; y += DXT_BLOCK_SIZE) {
		for (let x = 0; x < layout.width; x += DXT_BLOCK_SIZE) {
			const coords = swizzledCoords(x / 4, y / 4, blocksWide, blocksHigh);
			decompressDxt5Block(
				input,
				src,
				output,
				stride,
				coords.y * 4,
				coords.x * 4,
				layout.height,
				layout.width,
			);
			src += 16;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const criGxtImageDescriptor: FormatDescriptor = {
	id: "cri-gxt-image",
	name: "CRI Middleware image format",
	extensions: ["gxt"],
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
			source: "ArcFormats/Cri/ImageGXT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criGxtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criGxtImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readGxtLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGxtLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CRI Middleware picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.textureOffset),
				size: BigInt(layout.textureLength),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					textureType: layout.textureType,
					textureFormat: layout.textureFormat,
				},
			}),
			// The blocks are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "dxt5",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGxtLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CRI Middleware picture");
		}
		if (FORMAT_UBC3 !== layout.textureFormat) {
			throw invalidPicture(
				`CRI Middleware picture of the kind ${layout.textureFormat.toString(16).toUpperCase().padStart(8, "0")} not supported`,
			);
		}
		const pixels = unpackGxt(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
