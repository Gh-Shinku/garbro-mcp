// Format reference: GARbro "ArcFormats/Majiro/ImageRCT.cs", classes `RctFormat`, its `Reader` and
// `RctMetaData`.
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
import { copyOverlapped } from "../shared/copy.js";
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
 * `RctFormat.Reader.Unpack`: the places of the picture, of the walks of the places of a run of it. The
 * walk of the engine stands of runs of the places of the file itself, of the places of a pixel of the
 * picture: a run of the walk stands of a count of the places of the file (of three places of a pixel of
 * the picture, of no more than three of them, or of the count of the places of the file behind the run of
 * the second kind) and of the places of the picture of the run behind a count of them.
 */
export function unpackRctPicture(data: Buffer, layout: RctLayout): Buffer {
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
	return writeBmp24(layout.width, layout.height, pixels);
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
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readRctLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Majiro engine");
		if (layout.encrypted) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"the places of a picture of the engine standing of a key stand of no places of the file of it",
			);
		}
		return Readable.from([unpackRctPicture(data, layout)]);
	},
});
