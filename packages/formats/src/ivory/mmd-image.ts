// Format reference: GARBro "ArcFormats/Ivory/ImageMMD.cs", classes `MmdFormat` and `MmdMetaData`. The picture
// is a line of colour-map bytes, every nibble of which says how a pair of pixels is made.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from([0x4d, 0x4d, 0x44, 0x1a]);
const HEADER_SIZE = 0x18;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const SIZE1_FIELD = 8;
const SIZE2_FIELD = 0x0c;
const SIZE3_FIELD = 0x10;
const COLORS_FIELD = 0x14;
/** The pixels stand in the stream one byte each, four to a byte of the line. */
const PIXELS_PER_NIBBLE = 2;
const PIXELS_PER_LINE_BYTE = 4;
/** The colour map of the picture holds three bytes to an entry, the red one first. */
const PALETTE_ENTRY_BYTES = 3;
const MAXIMUM_COLORS = 0x100;
const PALETTE_SIZE = MAXIMUM_COLORS * 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/**
 * The two halves of the place a pair of pixels is copied from: the first half counts the rows above and the
 * second the pairs along, so a nibble of one stands for the pair behind, one of four for the pair above and
 * one of six for the pair above and one along.
 */
const SHIFT_ROWS = [0, 0, 0, 0, 1, 1, 2, 2, 2, 4, 4, 4, 8, 8, 8, 16];
const SHIFT_PAIRS = [0, 2, 4, 8, 0, 2, 0, 2, 4, 0, 2, 4, 0, 2, 4, 0];

export interface MmdLayout {
	width: number;
	height: number;
	/** How many bytes hold the bits of the line that say whether a byte of it changes. */
	size1: number;
	/** Where the bytes that change it end, so that `size2 - size1` of them stand behind the bits. */
	size2: number;
	/** How far behind the bytes that change the line the pixels themselves stand. */
	size3: number;
	colors: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MmdFormat.ReadMetaData`: the four bytes `MMD\x1A`, the measurements, three lengths and how many colours the
 * colour map holds. The two lengths of the line have to hold something, and the second of them has to stand
 * behind the first; a picture of no width or height and a colour map of fewer than no colours are turned away
 * as well, the second of which the reference would throw on where it reads the map.
 */
export function readMmdLayout(data: Buffer): MmdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	const size1 = data.readInt32LE(SIZE1_FIELD);
	const size2 = data.readInt32LE(SIZE2_FIELD);
	const size3 = data.readInt32LE(SIZE3_FIELD);
	const colors = data.readInt32LE(COLORS_FIELD);
	if (size1 <= 0 || size2 <= size1 || size3 <= 0) return undefined;
	if (colors < 0) return undefined;
	return { width, height, size1, size2, size3, colors };
}

/**
 * `MmdFormat.Read`: the picture is held as a line of one byte for every four pixels, and behind that line
 * stand the bits that say which of its bytes change and the bytes they change by, taken one after another and
 * laid over the line as it stands, so a line byte is the sum of what stands before it. Every nibble of a line
 * byte then says how a pair of pixels is made: a nibble of nothing reads the two pixels out of the stream, and
 * any other nibble copies them from a place behind, which the two halves of the table above give as rows and
 * pairs. A place that reaches before the start of the picture is refused, as is a line whose bits or bytes run
 * out, where the reference's own reader would run past them; the pixels the stream does not hold stand at
 * nothing, since the reference reads as many as are there.
 */
export function decodeMmd(data: Buffer, layout: MmdLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	const bits = data.subarray(HEADER_SIZE, HEADER_SIZE + layout.size1);
	const changes = data.subarray(
		HEADER_SIZE + layout.size1,
		HEADER_SIZE + layout.size2,
	);
	let literals = HEADER_SIZE + layout.size2;
	const line: Buffer = Buffer.alloc(
		Math.trunc(layout.width / PIXELS_PER_LINE_BYTE),
		0x00,
	);
	let mask = 0x80;
	let atBits = 0;
	let atChanges = 0;
	let dst = 0;
	for (let row = 0; row < layout.height; row += 1) {
		for (let index = 0; index < line.length; index += 1) {
			if (atBits >= bits.length) {
				throw invalidPicture("Ivory picture is cut short of its bits");
			}
			if (0 !== (mask & (bits[atBits] ?? 0))) {
				if (atChanges >= changes.length) {
					throw invalidPicture("Ivory picture is cut short of its changes");
				}
				line[index] = (line[index] ?? 0) ^ (changes[atChanges++] ?? 0);
			}
			mask >>= 1;
			if (0 === mask) {
				mask = 0x80;
				atBits += 1;
			}
			const value = line[index] ?? 0;
			let nibble = value >> 4;
			for (let half = 0; half < 2; half += 1) {
				if (0 !== nibble) {
					const offset =
						(SHIFT_ROWS[nibble] ?? 0) * layout.width +
						(SHIFT_PAIRS[nibble] ?? 0);
					const from = dst - offset;
					if (from < 0) {
						throw invalidPicture("Ivory picture copies from before its start");
					}
					pixels[dst] = pixels[from] ?? 0;
					pixels[dst + 1] = pixels[from + 1] ?? 0;
					dst += PIXELS_PER_NIBBLE;
				} else {
					const room = Math.max(
						0,
						Math.min(PIXELS_PER_NIBBLE, data.length - literals),
					);
					data.copy(pixels, dst, literals, literals + room);
					literals += room;
					dst += PIXELS_PER_NIBBLE;
				}
				nibble = value & 0x0f;
			}
		}
	}
	return pixels;
}

/**
 * `MmdFormat.Read`: the colour map stands behind the pixels, of as many entries as the header says up to a
 * whole one, three bytes each with the red one first. A map the file does not hold all of is refused, where
 * the reference's own reader throws.
 */
export function readMmdPalette(data: Buffer, layout: MmdLayout): Buffer {
	const colors = Math.min(MAXIMUM_COLORS, layout.colors);
	const at = HEADER_SIZE + layout.size2 + layout.size3;
	if (at + colors * PALETTE_ENTRY_BYTES > data.length) {
		throw invalidPicture("Ivory picture is cut short of its colour map");
	}
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let index = 0; index < colors; index += 1) {
		const source = at + index * PALETTE_ENTRY_BYTES;
		palette[index * 4] = data[source + 2] ?? 0;
		palette[index * 4 + 1] = data[source + 1] ?? 0;
		palette[index * 4 + 2] = data[source] ?? 0;
	}
	return palette;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ivoryMmdImageDescriptor: FormatDescriptor = {
	id: "ivory-mmd-image",
	name: "Ivory image format",
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
			source: "ArcFormats/Ivory/ImageMMD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ivoryMmdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivoryMmdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readMmdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMmdLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not an Ivory picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
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
							bitsPerPixel: 8,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "ivory",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readMmdLayout(stored);
		if (!layout) {
			throw invalidPicture("Not an Ivory picture");
		}
		const size = layout.width * layout.height;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Ivory picture of ${size} bytes is too large`,
			);
		}
		const pixels = decodeMmd(stored, layout);
		const palette = readMmdPalette(stored, layout);
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, false),
		]);
	},
});
