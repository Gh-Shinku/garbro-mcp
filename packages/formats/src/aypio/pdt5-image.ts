// Format reference: GARbro "Legacy/AyPio/ImagePDT5.cs", classes `Pdt5Format` and `Pdt5Reader` (a UK2 engine
// picture of four bits whose places stand in a window of three rows, where a step of the walk may stand for
// itself, may lean on the places that stand around it, may lean on the places behind it or may repeat a place
// that stands further back still). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPdtPalette } from "./pdt-image.js";

/** The names the reference registers the format by; it declares no word of its own. */
const EXTENSIONS = ["pdt", "anm"];
/** The byte the reference tells a picture of this engine by. */
const SIGNATURE_BYTE = 0x35;
const LEFT_FIELD = 0x21;
const TOP_FIELD = 0x23;
const RIGHT_FIELD = 0x25;
const BOTTOM_FIELD = 0x27;
const WALK_FIELD = 0x29;
/** The window the walk writes its places into: three rows of six hundred and forty four places, the row at
 * hand standing at the third of them, two places in. */
const WINDOW_SIZE = 1932;
const ROW_FIELD = 1290;
const SLIDE_FIELD = 644;
const SLIDE_SIZE = 1288;
/** The bound the reference holds a picture of this engine to. */
const MAXIMUM_WIDTH = 640;
const MAXIMUM_HEIGHT = 1024;
const FRAME_SIZE = 0x110;
const FRAME_STEP = 0x10;
const FRAME_PLACES = 0x10;
const LIMIT = 256 * 1024 * 1024;

export interface Pdt5Layout {
	width: number;
	height: number;
	/** How far the left edge and the top edge of the picture stand from nought. */
	offsetX: number;
	offsetY: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Pdt5Format.ReadMetaData`: the first byte of the file is thirty five; the four words behind it name the
 * left, the top, the right and the bottom edge of the picture. The width of the picture stands in the places
 * of the bits between its left and its right edge — eight places for every byte — and its height in the places
 * between its top and its bottom edge.
 */
export function readPdt5Layout(
	data: Buffer,
	fileLength = data.length,
): Pdt5Layout | undefined {
	if (data.length < WALK_FIELD) return undefined;
	if ((data[0] ?? 0) !== SIGNATURE_BYTE) return undefined;
	if (fileLength < WALK_FIELD) return undefined;
	const left = data.readUInt16LE(LEFT_FIELD);
	const top = data.readUInt16LE(TOP_FIELD);
	const right = data.readUInt16LE(RIGHT_FIELD);
	const bottom = data.readUInt16LE(BOTTOM_FIELD);
	const width = (right - left + 1) << 3;
	const height = bottom - top + 1;
	if (width <= 0 || height <= 0) return undefined;
	if (width > MAXIMUM_WIDTH || height > MAXIMUM_HEIGHT) return undefined;
	if (width * height > LIMIT) return undefined;
	return { width, height, offsetX: left << 3, offsetY: top };
}

interface Pdt5Cursor {
	data: Buffer;
	position: number;
	bits: number;
	count: number;
}

function nextBit(cursor: Pdt5Cursor): number {
	cursor.count -= 1;
	if (cursor.count <= 0) {
		if (cursor.position >= cursor.data.length) {
			throw invalidPicture("UK2 picture is cut short of its walk");
		}
		cursor.bits = cursor.data[cursor.position] ?? 0;
		cursor.position += 1;
		cursor.count = 8;
	}
	const bit = cursor.bits & 1;
	cursor.bits >>= 1;
	return bit;
}

/**
 * `Pdt5Reader.GetCount`: how many places stand between the walk and the place it names: a run of ones says how
 * many parts the count stands in, every part that stands adding to it, and the parts behind the run are then
 * read from the highest of them down, every one of them that stands adding what the part holds.
 */
function readPdt5Count(cursor: Pdt5Cursor): number {
	let count = 0;
	let bits = 1;
	while (1 !== nextBit(cursor)) {
		count += bits;
		bits <<= 1;
		if (bits > 0x10000000) {
			throw invalidPicture("UK2 picture names a count that stands too far");
		}
	}
	if (bits > 1) {
		do {
			if (0 !== nextBit(cursor)) count += bits;
			bits >>= 1;
		} while (0 !== bits);
	}
	return count;
}

/**
 * `Pdt5Reader.GetPixel`: the place of the picture at hand stands from the places around it — the place in the
 * row behind it, the place two rows behind it and the two places beside that one — one of them standing for
 * itself wherever the two behind it stand together.
 */
function readPdt5Pixel(window: Buffer, at: number): number {
	let pixel = window[at + 647] ?? 0;
	if ((window[at + 4] ?? 0) !== pixel) {
		const value = window[at + 2] ?? 0;
		if (value !== pixel) {
			pixel = window[at + 645] ?? 0;
			if (pixel !== value && (window[at] ?? 0) !== pixel) {
				return window[at + 2] ?? 0;
			}
		}
	}
	return pixel;
}

export function decodePdt5(data: Buffer, layout: Pdt5Layout): Buffer {
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	const window: Buffer = Buffer.alloc(WINDOW_SIZE, 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	for (let at = 0; at < FRAME_SIZE; at += FRAME_PLACES) {
		for (let place = 0; place < FRAME_PLACES; place += 1) {
			frame[at + place] = place;
		}
	}
	const cursor: Pdt5Cursor = {
		data,
		position: WALK_FIELD,
		bits: 0,
		count: 1,
	};
	const write = (at: number, pixel: number): void => {
		if (at < 0 || at >= window.length) {
			throw invalidPicture("UK2 picture walks beyond its own window");
		}
		window[at] = pixel;
	};
	let pixel = 0;
	let outputPos = 0;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			if (0 !== nextBit(cursor)) {
				if (0 !== nextBit(cursor)) {
					if (0 !== nextBit(cursor)) {
						const count = readPdt5Count(cursor) + 2;
						let at = ROW_FIELD + x;
						x += count - 1;
						for (let index = 0; index < count; index += 1) {
							write(at, pixel);
							at += 1;
						}
					} else {
						const count = readPdt5Count(cursor) + 1;
						pixel = window[1289 + x] ?? 0;
						if (!copyOverlapped(window, x + 1288, x + 1290, count * 2)) {
							throw invalidPicture("UK2 picture walks beyond its own window");
						}
						x += count * 2 - 1;
					}
				} else {
					pixel = readPdt5Pixel(window, x);
					write(x + ROW_FIELD, pixel);
				}
			} else {
				let count = 0;
				const back = readPdt5Pixel(window, x);
				while (1 !== nextBit(cursor)) {
					count += 1;
					if (count >= FRAME_PLACES) break;
				}
				let src = FRAME_STEP * back + count;
				if (src >= FRAME_SIZE || count >= FRAME_PLACES) {
					throw invalidPicture(
						"UK2 picture names a place that stands beyond its table",
					);
				}
				pixel = frame[src] ?? 0;
				write(x + ROW_FIELD, pixel);
				while (count > 0) {
					count -= 1;
					if (src <= 0) {
						throw invalidPicture(
							"UK2 picture names a place that stands beyond its table",
						);
					}
					frame[src] = frame[src - 1] ?? 0;
					src -= 1;
				}
				frame[src] = pixel;
			}
		}
		for (let at = 0; at < layout.width; at += 1) {
			pixels[outputPos + at] = window[ROW_FIELD + at] ?? 0;
		}
		outputPos += layout.width;
		window.copyWithin(0, SLIDE_FIELD, SLIDE_FIELD + SLIDE_SIZE);
	}
	return writeBmp8Palette(
		layout.width,
		layout.height,
		pixels,
		readPdt5Palette(data),
	);
}

/** The colours of the picture, which stand the way the colours of the other picture of this engine do, in the
 * order a bitmap holds them. */
export function readPdt5Palette(data: Buffer): Buffer {
	const triples = readPdtPalette(data);
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let entry = 0; entry < triples.length / 3; entry += 1) {
		palette[entry * 4] = triples[entry * 3 + 2] ?? 0;
		palette[entry * 4 + 1] = triples[entry * 3 + 1] ?? 0;
		palette[entry * 4 + 2] = triples[entry * 3] ?? 0;
	}
	return palette;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The reference tells a picture of this engine by the names of the format, which have to stand there. */
function hasPdtName(sourcePath: string | undefined): boolean {
	if (!sourcePath) return false;
	const name = sourcePath.toLowerCase();
	return EXTENSIONS.some((extension) => name.endsWith(`.${extension}`));
}

export const aypioPdt5ImageDescriptor: FormatDescriptor = {
	id: "aypio-pdt5-image",
	name: "UK2 engine image format",
	extensions: EXTENSIONS,
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
			source: "Legacy/AyPio/ImagePDT5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aypioPdt5ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aypioPdt5ImageDescriptor,
	// The reference registers no word at all, only the two names of the format.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!hasPdtName(sourcePath)) return false;
		if (source.size < BigInt(WALK_FIELD)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, WALK_FIELD));
			return readPdt5Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPdt5Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(WALK_FIELD),
				size: source.size - BigInt(WALK_FIELD),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The walk of the picture is gathered into a bitmap of eight bits with its sixteen colours.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 4 },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPdt5Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine picture");
		return Readable.from([decodePdt5(stored, layout)]);
	},
});
