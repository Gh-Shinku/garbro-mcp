// Format reference: GARbro "Legacy/Aquarium/ImageCP2.cs", classes `Cp2Format`, `Cp2MetaData` and `Cp2Reader`
// (an Aquarium picture whose rows stand thirty two bytes apart and whose pixels may stand behind a walk of
// runs of their own, with a plane of fourth bytes of its own behind them). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'CP2', the word the reference registers. */
const SIGNATURE = Buffer.from("CP2", "latin1");
const HEADER_SIZE = 0x20;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x08;
const DEPTH_FIELD = 0x0c;
const FLAGS_FIELD = 0x14;
const COMPRESSED_MASK = 0x0f;
const ALPHA_MASK = 0x20;
/** The depths the reference reads. */
const DEPTHS = [8, 24, 32];
/** The size of the colour map of an eight bit picture. */
const PALETTE_SIZE = 0x400;
/** The size a row stands at, every row standing on the next thirty two byte line. */
const ROW_ALIGNMENT = 32;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Cp2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flags: number;
	isCompressed: boolean;
	hasAlpha: boolean;
	/** The size of a row of the picture, which is not the size a bitmap lays its own rows out with. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Cp2Format.ReadMetaData`: the file begins with the word `CP2`, the width and the height stand at four and
 * eight as words, the depth at `0x0C` and the flags at `0x14` as words of their own. The four lower places of
 * the flags being anything but nought means the pixels stand behind a walk of their own, and the place
 * `0x20` means a plane of fourth bytes stands behind them. A row stands on the next thirty two byte line,
 * whatever is left of it standing as it is.
 */
export function readCp2Layout(
	data: Buffer,
	fileLength = data.length,
): Cp2Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const flags = data.readInt32LE(FLAGS_FIELD);
	const stride =
		((width + ROW_ALIGNMENT - 1) & ~(ROW_ALIGNMENT - 1)) * (bitsPerPixel >> 3);
	const pixels = stride * height;
	if (pixels > LIMIT) return undefined;
	// Where the pixels stand has to stand inside the file.
	const start = HEADER_SIZE + (8 === bitsPerPixel ? PALETTE_SIZE : 0);
	if (start >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		flags,
		isCompressed: 0 !== (flags & COMPRESSED_MASK),
		hasAlpha: 0 !== (flags & ALPHA_MASK),
		stride,
	};
}

/** The colour map of an eight bit picture, spread over four byte entries as a bitmap wants it. */
export function readCp2Palette(stored: Buffer, layout: Cp2Layout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (8 !== layout.bitsPerPixel) return palette;
	stored.copy(
		palette,
		0,
		HEADER_SIZE,
		Math.min(HEADER_SIZE + PALETTE_SIZE, stored.length),
	);
	return palette;
}

/**
 * `Cp2Reader.DecompressLz`: the walk stands behind two words, the first of which says how many bytes of the
 * walk itself stand behind them. A byte other than nought stands as it is, a byte of nought stands in front
 * of a count and a place of two bytes — the place being how far behind the byte being written the run it
 * copies begins, which may reach into the run itself — and a count of nought stands for a single byte of
 * nought. The walk ends where the picture is whole or where the bytes it was told about run out.
 */
export function unpackCp2Lz(
	stored: Buffer,
	position: number,
	output: Buffer,
): number {
	if (position + 8 > stored.length) {
		throw invalidPicture("Aquarium picture is cut short of its walk");
	}
	let remaining = stored.readInt32LE(position);
	position += 8;
	let dst = 0;
	while (dst < output.length && remaining > 0) {
		if (position >= stored.length) break;
		const byte = stored[position] ?? 0;
		position += 1;
		if (0 !== byte) {
			output[dst] = byte;
			dst += 1;
			remaining -= 1;
			continue;
		}
		if (position >= stored.length) break;
		const count = stored[position] ?? 0;
		position += 1;
		if (0 !== count) {
			if (position + 2 > stored.length) {
				throw invalidPicture("Aquarium picture is cut short of its walk");
			}
			const offset = stored.readUInt16LE(position);
			position += 2;
			if (dst - offset < 0) {
				throw invalidPicture(
					"Aquarium picture copies from before the beginning of its own pixels",
				);
			}
			if (dst + count > output.length) {
				throw invalidPicture("Aquarium picture writes past its own pixels");
			}
			// A byte at a time, which is what a run that reads the bytes it has just written needs.
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = output[dst - offset + index] ?? 0;
			}
			dst += count;
			remaining -= 4;
		} else {
			if (dst >= output.length) break;
			output[dst] = 0;
			dst += 1;
			remaining -= 2;
		}
	}
	return position;
}

export interface Cp2Picture {
	/** What is handed to the bitmap: the pixels as the picture holds them or, where a plane of fourth bytes
	 *  stands behind them, the four byte pixels the reference weaves it into. */
	pixels: Buffer;
	palette: Buffer;
	bitsPerPixel: number;
	/** Whether the rows stand bottom up, which is what the reference's own flip means. */
	bottomUp: boolean;
}

/**
 * `Cp2Reader.Unpack`: an eight bit picture begins with its colour map and the pixels stand behind it as they
 * are or behind a walk of their own. Where the flags say a plane of fourth bytes stands behind the pixels,
 * the plane is unwrapped the same way and woven into them: the colour rows are walked from the last of them
 * to the first while the fourth bytes are walked from the first, so the two planes stand in opposite orders,
 * and what comes out is a picture of four bytes a pixel standing top down.
 */
export function unpackCp2(stored: Buffer, layout: Cp2Layout): Cp2Picture {
	const pixelSize = layout.bitsPerPixel >> 3;
	const palette = readCp2Palette(stored, layout);
	const pixels: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	let position = HEADER_SIZE + (8 === layout.bitsPerPixel ? PALETTE_SIZE : 0);
	if (layout.isCompressed) {
		position = unpackCp2Lz(stored, position, pixels);
	} else {
		stored.copy(
			pixels,
			0,
			position,
			Math.min(position + pixels.length, stored.length),
		);
		position += pixels.length;
	}
	if (!layout.hasAlpha) {
		return {
			pixels,
			palette,
			bitsPerPixel: layout.bitsPerPixel,
			bottomUp: true,
		};
	}
	// The plane of fourth bytes stands one byte a pixel, a row of its own size.
	const aligned = layout.stride / pixelSize;
	const alpha: Buffer = Buffer.alloc(aligned * layout.height, 0x00);
	if (layout.isCompressed) {
		unpackCp2Lz(stored, position, alpha);
	} else {
		stored.copy(
			alpha,
			0,
			position,
			Math.min(position + alpha.length, stored.length),
		);
	}
	const out: Buffer = Buffer.alloc(layout.width * 4 * layout.height, 0x00);
	let source = pixels.length - layout.stride;
	let dst = 0;
	let asrc = 0;
	while (source >= 0) {
		let index = 0;
		for (let x = 0; x < layout.width; x += 1) {
			if (8 === layout.bitsPerPixel) {
				const entry = (pixels[source + index] ?? 0) * 4;
				out[dst] = palette[entry] ?? 0;
				out[dst + 1] = palette[entry + 1] ?? 0;
				out[dst + 2] = palette[entry + 2] ?? 0;
				index += 1;
			} else {
				out[dst] = pixels[source + index] ?? 0;
				out[dst + 1] = pixels[source + index + 1] ?? 0;
				out[dst + 2] = pixels[source + index + 2] ?? 0;
				index += pixelSize;
			}
			// The plane of fourth bytes is read from its first row, the rows of colour from their last.
			out[dst + 3] = alpha[asrc + x] ?? 0;
			dst += 4;
		}
		source -= layout.stride;
		asrc += aligned;
	}
	return { pixels: out, palette, bitsPerPixel: 32, bottomUp: false };
}

/** The rows of the picture, gathered into the size a bitmap lays its own rows out with. */
function packCp2Rows(pixels: Buffer, layout: Cp2Layout): Buffer {
	const rowBytes = layout.width * (layout.bitsPerPixel >> 3);
	const tight: Buffer = Buffer.alloc(rowBytes * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		const from = row * layout.stride;
		const available = Math.min(rowBytes, pixels.length - from);
		if (available <= 0) break;
		pixels.copy(tight, row * rowBytes, from, from + available);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aquariumCp2ImageDescriptor: FormatDescriptor = {
	id: "aquarium-cp2-image",
	name: "Aquarium image format",
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
			source: "Legacy/Aquarium/ImageCP2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aquariumCp2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aquariumCp2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readCp2Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCp2Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Aquarium picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: layout.isCompressed,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					flags: layout.flags,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.isCompressed ? "lz" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.hasAlpha ? 32 : layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCp2Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Aquarium picture");
		}
		const picture = unpackCp2(stored, layout);
		const { width, height } = layout;
		// A picture of fourth bytes woven in stands top down; one without stands bottom up, which is what
		// the reference's own flip means and a bitmap records with a positive height.
		if (8 === picture.bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(
					width,
					height,
					packCp2Rows(picture.pixels, layout),
					picture.palette,
					picture.bottomUp,
				),
			]);
		}
		if (24 === picture.bitsPerPixel) {
			return Readable.from([
				writeBmp24(
					width,
					height,
					packCp2Rows(picture.pixels, layout),
					picture.bottomUp,
				),
			]);
		}
		return Readable.from([
			writeBmp32(width, height, picture.pixels, picture.bottomUp),
		]);
	},
});
