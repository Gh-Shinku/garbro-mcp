// Format reference: GARbro "ArcFormats/Majiro/ImageRCT.cs", classes `RctFormat`, its `Reader` and
// `RctMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import { readRc8Layout, unpackRc8 } from "./rc8-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The places of the head of the picture, and the places of the walk of the places of it behind. */
const HEAD_SIZE = 0x14;
const VERSION_ONE_HEAD = 0x16;
const MARK = 0x9a925a98;
const KIND_FIELD = 4;
const ENCRYPTION_FIELD = 5;
const VERSION_FIELD = 6;
const NUMBER_FIELD = 7;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 12;
const SIZE_FIELD = 16;
const KIND = 0x54; // 'T'
const ENCRYPTION_PLAIN = 0x43; // 'C'
const ENCRYPTION_KEY = 0x53; // 'S'
const NUMBER = 0x30; // '0'
const MAX_SIDE = 0x8000;
/** The places of a pixel of the picture the walk of the engine hands over. */
const PLACES = 3;
const RUN = 0x80;
const RUN_LONG = 0x7f;
/** How deep a picture of the engine may stand over another picture of its own name before it stands alone. */
const BASE_RECURSION_LIMIT = 8;
/** The colour a picture of the engine stands for no place of its own: the key the engine writes a picture of. */
const KEY_BLUE = 0x00;
const KEY_GREEN = 0x00;
const KEY_RED = 0xff;
/** The places of a pixel of the picture the runs of the walk of the engine stand of. */
const PLAIN_BITS = 3;

/**
 * `RctFormat.Reader.ShiftTable`: the places of the picture a run of the walk stands of, of the places of
 * the row of the picture of it and of the places of a pixel to either side of it: the places behind the
 * fourth place of the value stand of the places of a row of the picture, and the four places in front of
 * it of the places of a pixel of it.
 */
const SHIFT_TABLE = [
	-16, -32, -48, -64, -80, -96, 49, 33, 17, 1, -15, -31, -47, 50, 34, 18, 2,
	-14, -30, -46, 51, 35, 19, 3, -13, -29, -45, 36, 20, 4, -12, -28,
];

export interface RctLayout {
	width: number;
	height: number;
	version: number;
	encrypted: boolean;
	dataOffset: number;
	dataSize: number;
	baseNameLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `RctFormat.ReadMetaData`: the head of the picture, of the places of the file of it. */
export function readRctLayout(data: Buffer): RctLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (MARK !== data.readUInt32LE(0)) return undefined;
	if (KIND !== data[KIND_FIELD]) return undefined;
	const encryption = data[ENCRYPTION_FIELD] ?? 0;
	if (ENCRYPTION_PLAIN !== encryption && ENCRYPTION_KEY !== encryption) {
		return undefined;
	}
	if (NUMBER !== data[VERSION_FIELD]) return undefined;
	const version = (data[NUMBER_FIELD] ?? 0) - NUMBER;
	if (0 !== version && 1 !== version) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const dataSize = data.readInt32LE(SIZE_FIELD);
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	if (0 === width || 0 === height) return undefined;
	if (dataSize < 0) return undefined;
	// The head of a picture of the second kind stands one word behind the head of the first of them.
	let dataOffset = HEAD_SIZE;
	let baseNameLength = 0;
	if (1 === version) {
		if (data.length < VERSION_ONE_HEAD) return undefined;
		baseNameLength = data.readUInt16LE(HEAD_SIZE);
		dataOffset = VERSION_ONE_HEAD;
	}
	return {
		width,
		height,
		version,
		encrypted: ENCRYPTION_KEY === encryption,
		dataOffset,
		dataSize,
		baseNameLength,
	};
}

/** The head of the picture stands of the places of the file the other way around from a word of it. */
export function rctSignatures(): readonly { bytes: Uint8Array }[] {
	const mark: Buffer = Buffer.alloc(4, 0x00);
	mark.writeUInt32LE(MARK, 0);
	return [{ bytes: mark }];
}

/**
 * The name of the picture a picture of the second kind stands over, of the places of the file of it at the
 * head of the walk: a run of the places of the file of no more than the count the head names.
 */
export function readRctBaseName(
	data: Buffer,
	layout: RctLayout,
): string | undefined {
	if (layout.baseNameLength <= 0) return undefined;
	const end = Math.min(data.length, layout.dataOffset + layout.baseNameLength);
	let at = layout.dataOffset;
	while (at < end && 0x00 !== data[at]) at += 1;
	if (0 === at - layout.dataOffset) return undefined;
	return data.toString("latin1", layout.dataOffset, at);
}

/**
 * `RctFormat.CombineImage`: the places of the picture of the engine that stand of the key of no place of
 * their own stand read from the picture beneath, of the places of the picture of it behind them.
 */
export function combineRctPixels(base: Buffer, overlay: Buffer): Buffer {
	for (let at = 0; at + 2 < overlay.length; at += PLACES) {
		if (
			KEY_BLUE === (overlay[at] ?? 0) &&
			KEY_GREEN === (overlay[at + 1] ?? 0) &&
			KEY_RED === (overlay[at + 2] ?? 0)
		) {
			overlay[at] = base[at] ?? 0;
			overlay[at + 1] = base[at + 1] ?? 0;
			overlay[at + 2] = base[at + 2] ?? 0;
		}
	}
	return overlay;
}

/** `RctFormat.Reader.Unpack`: the places of the picture, of the walks of the places of a run of it. */
export function unpackRctPixels(data: Buffer, layout: RctLayout): Buffer {
	const total = layout.width * layout.height * PLACES;
	const pixels: Buffer = Buffer.alloc(total, 0x00);
	let at = layout.dataOffset + layout.baseNameLength;
	let placed = 0;
	let count = PLAIN_BITS;
	while (placed < total) {
		if (count > total - placed) {
			throw invalidPicture(
				"The run of the walk stands past the places of the picture",
			);
		}
		placed += count;
		for (let place = 0; place < count; place += 1) {
			if (at >= data.length) {
				throw invalidPicture(
					"The walk of the picture stands short of the file",
				);
			}
			pixels[placed - count + place] = data[at] ?? 0;
			at += 1;
		}
		while (placed < total) {
			if (at >= data.length) {
				throw invalidPicture(
					"The walk of the picture stands short of the file",
				);
			}
			let value = data[at] ?? 0;
			at += 1;
			if (0 === (value & RUN)) {
				// A run of the places of the file itself: the count of the places of it stands behind the
				// place of the walk, of the second kind standing of the word of the file behind it.
				if (RUN_LONG === value) {
					if (at + 2 > data.length) {
						throw invalidPicture(
							"The walk of the picture stands short of the file",
						);
					}
					value += data.readUInt16LE(at);
					at += 2;
				}
				count = value * PLAIN_BITS + PLAIN_BITS;
				break;
			}
			const shiftOf = value >> 2;
			value &= 3;
			if (3 === value) {
				if (at + 2 > data.length) {
					throw invalidPicture(
						"The walk of the picture stands short of the file",
					);
				}
				value += data.readUInt16LE(at);
				at += 2;
			}
			count = value * PLAIN_BITS + PLAIN_BITS;
			if (placed + count > total) {
				throw invalidPicture(
					"The run of the walk stands past the places of the picture",
				);
			}
			// The places of the table of the walk of the engine stand of the places of the file of it of no
			// more than the places of five of them, of the places of the file behind the four places of it.
			const place = shiftOf & 0x1f;
			if (place >= SHIFT_TABLE.length) {
				throw invalidPicture(
					"The walk of the picture names no place of the table of it",
				);
			}
			const shift = SHIFT_TABLE[place] ?? 0;
			const column = shift & 0xf;
			// The places of a row of the picture stand of the places of the width of the picture, of the
			// places of the walk of the engine taken off the places of the picture itself.
			const places = (shift >> 4) - column * layout.width;
			const offset = places * PLACES;
			if (offset >= 0 || placed + offset < 0) {
				throw invalidPicture(
					"The places of the walk of the picture stand of its own places",
				);
			}
			copyOverlapped(pixels, placed + offset, placed, count);
			placed += count;
		}
	}
	return pixels;
}

/**
 * `RctFormat.ApplyMaskToImage`: the mask of the picture stands beside it of the name of the picture of the
 * engine and of the places of the file of `_.rc8`, and the covering place of every pixel stands of the
 * colour the colour map of the mask holds at the place of the file of the mask of that pixel.
 */
export function maskRctPixels(
	pixels: Buffer,
	mask: Buffer,
	palette: Buffer,
): Buffer {
	const places = Buffer.alloc(Math.trunc(pixels.length / PLACES) * 4, 0x00);
	let source = 0;
	for (let at = 0; at < places.length; at += 4) {
		places[at] = pixels[source] ?? 0;
		places[at + 1] = pixels[source + 1] ?? 0;
		places[at + 2] = pixels[source + 2] ?? 0;
		source += PLACES;
		const entry = (mask[at >> 2] ?? 0) * 4;
		const blue = palette[entry] ?? 0;
		const green = palette[entry + 1] ?? 0;
		const red = palette[entry + 2] ?? 0;
		places[at + 3] = 0xff - Math.trunc((blue + green + red) / 3);
	}
	return places;
}

/** The name of the mask of a picture of the engine: the name of the picture and `_.rc8` behind it. */
export function rctMaskName(sourcePath: string): string {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	return `${changeExtension(name, "")}_.rc8`;
}

/**
 * `RctFormat.Read`: the places of a colour of the picture, of the mask beside it where one stands. The
 * reference leaves a mask that stands nowhere, or stands short, or stands of no count of the picture, out of
 * its read of the catch behind it.
 */
async function readRctMask(
	sourcePath: string,
	layout: RctLayout,
): Promise<{ indices: Buffer; palette: Buffer } | undefined> {
	try {
		const stored = await readCompanionFile(sourcePath, rctMaskName(sourcePath));
		if (!stored) return undefined;
		const mask = readRc8Layout(stored);
		if (!mask || mask.width !== layout.width || mask.height !== layout.height) {
			return undefined;
		}
		return { indices: unpackRc8(stored, mask), palette: mask.palette };
	} catch {
		return undefined;
	}
}

/**
 * `RctFormat.Reader.Unpack`, of the picture of the engine itself: the places of the picture of the second
 * kind stand over the places of a picture of their own name beside them.
 */
export function unpackRctPicture(data: Buffer, layout: RctLayout): Buffer {
	return writeBmp24(layout.width, layout.height, unpackRctPixels(data, layout));
}

/**
 * `RctFormat.ReadPixelsData`: the places of the picture, of the picture of its own name beside it where the
 * head names one. A picture that stands nowhere, or stands of no count of the picture itself, stands of no
 * count of its own: the reference leaves such a picture as it stands, of the catch behind its read.
 */
async function readRctPixels(
	data: Buffer,
	layout: RctLayout,
	sourcePath: string,
	depth: number,
): Promise<Buffer> {
	const pixels = unpackRctPixels(data, layout);
	if (layout.baseNameLength <= 0 || depth >= BASE_RECURSION_LIMIT)
		return pixels;
	const name = readRctBaseName(data, layout);
	if (!name) return pixels;
	try {
		const base = await readCompanionFile(sourcePath, name);
		if (!base) return pixels;
		const baseLayout = readRctLayout(base);
		if (
			!baseLayout ||
			baseLayout.width !== layout.width ||
			baseLayout.height !== layout.height
		) {
			return pixels;
		}
		const under = await readRctPixels(
			base,
			baseLayout,
			resolve(dirname(sourcePath), name),
			depth + 1,
		);
		return combineRctPixels(under, pixels);
	} catch {
		return pixels;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rctImageDescriptor: FormatDescriptor = {
	id: "majiro-rct-image",
	name: "Majiro game engine RGB image",
	extensions: ["rct"],
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
			source: "ArcFormats/Majiro/ImageRCT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rctImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rctImageDescriptor,
	detection: { signatures: rctSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readRctLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readRctLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Majiro engine");
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
					bitsPerPixel: PLACES * 8,
					version: layout.version,
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
				bitsPerPixel: PLACES * 8,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const data = await readStored(source);
		const layout = readRctLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Majiro engine");
		if (layout.encrypted) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"the places of a picture of the engine standing of a key stand of no places of the file of it",
			);
		}
		void entry;
		const pixels = await readRctPixels(data, layout, sourcePath, 0);
		const mask = await readRctMask(sourcePath, layout);
		if (mask) {
			// The reference hands a picture of a mask over as four places of a colour to a pixel.
			return Readable.from([
				writeBmp32(
					layout.width,
					layout.height,
					maskRctPixels(pixels, mask.indices, mask.palette),
				),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, Buffer.from(pixels)),
		]);
	},
});
