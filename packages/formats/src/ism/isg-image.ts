// Format reference: GARBro "ArcFormats/Ism/ImageISG.cs", classes `IsgFormat` and the `Reader` behind it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Two of the three ways this engine packs a picture stand on the file itself. The third stands on a
// **baseline picture read from a file of its own name** beside it, so it is left out of this port.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every picture of this engine opens with, and the head behind it. */
const MARK = "ISM IMAGEFILE\0";
const HEADER_SIZE = 0x24;
/** Where the run of the picture itself begins. */
const DATA_START = 0x30;
/** The fields of the head. */
const TYPE_AT = 0x10;
const PACKED_AT = 0x11;
const UNPACKED_AT = 0x15;
const WIDTH_AT = 0x1d;
const HEIGHT_AT = 0x1f;
const COLOURS_AT = 0x23;
/** The ways a picture of this engine may be packed. */
const TYPE_RUNS = 0x10;
const TYPE_LZSS = 0x21;
const TYPE_OVERLAY = 0x34;
/** A picture of this engine is always of one byte a pixel, through a palette of its own. */
const DEPTH = 8;
const PALETTE_ENTRIES = 0x100;
const COLOUR_BYTES = 3;
/** The frame the packed way reads back from, and the place its cursor starts. */
const FRAME_SIZE = 0x800;
const FRAME_MASK = 0x7ff;
const FRAME_START = 2039;
/** The run of the packed way reads its control word from the high bit down. */
const LZSS_BIT = 0x80;
/** The run of the simple way reads its control word from the lowest bit up, eight of them to a byte. */
const RUNS_BIT = 1;
const RUNS_BIT_MARK = 0x100;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface IsgLayout {
	type: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	colours: number;
	packed: number;
	unpacked: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `IsgFormat.ReadMetaData`: the head of the picture, of one byte a pixel through a palette of its own. */
export function readIsgLayout(data: Buffer): IsgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, MARK.length) !== MARK) return undefined;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT) return undefined;
	const colours = data[COLOURS_AT] ?? 0;
	return {
		type: data[TYPE_AT] ?? 0,
		width,
		height,
		bitsPerPixel: DEPTH,
		colours: 0 === colours ? PALETTE_ENTRIES : colours,
		packed: data.readUInt32LE(PACKED_AT),
		unpacked: data.readUInt32LE(UNPACKED_AT),
	};
}

/** `ImageFormat.ReadColorMap`: a palette of three bytes a colour, of the entries the head names. */
export function readIsgPalette(
	data: Buffer,
	at: number,
	colours: number,
): Buffer | undefined {
	if (colours < 1 || colours > PALETTE_ENTRIES) return undefined;
	if (at + colours * COLOUR_BYTES > data.length) return undefined;
	// The writers of this project take a palette of four bytes an entry, the last of them unused.
	const palette = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < colours; index += 1) {
		const from = at + index * COLOUR_BYTES;
		const to = index * 4;
		palette[to] = data[from] ?? 0;
		palette[to + 1] = data[from + 1] ?? 0;
		palette[to + 2] = data[from + 2] ?? 0;
		palette[to + 3] = 0xff;
	}
	return palette;
}

/**
 * `Reader.DecompressLzss`: a control word read from its high bit down, where a set bit stands for a pair of
 * bytes - the place the run is read from, of eleven bits, and its own length in the five bits above them -
 * and a clear one for a byte that stands as it is. The frame begins near its end and wraps.
 */
export function unpackIsgLzss(
	data: Buffer,
	from: number,
	remaining: number,
	output: Buffer,
): number {
	const frame = new Uint8Array(FRAME_SIZE);
	let at = from;
	let dst = 0;
	let framePos = FRAME_START;
	let left = remaining;
	if (left <= 0) return at;
	let control = data[at] ?? 0;
	at += 1;
	left -= 1;
	let bit = LZSS_BIT;
	while (left > 0 && dst < output.length) {
		if (0 !== (control & bit)) {
			if (left < 2 || at + 2 > data.length) break;
			const high = data[at] ?? 0;
			const low = data[at + 1] ?? 0;
			at += 2;
			left -= 2;
			let offset = ((high & 7) << 8) | low;
			let count = (high >> 3) + 3;
			while (count > 0 && dst < output.length) {
				const value = frame[offset & FRAME_MASK] ?? 0;
				frame[framePos & FRAME_MASK] = value;
				output[dst] = value;
				dst += 1;
				offset = (offset + 1) & FRAME_MASK;
				framePos = (framePos + 1) & FRAME_MASK;
				count -= 1;
			}
		} else {
			if (at >= data.length) break;
			const value = data[at] ?? 0;
			at += 1;
			left -= 1;
			output[dst] = value;
			frame[framePos & FRAME_MASK] = value;
			dst += 1;
			framePos = (framePos + 1) & FRAME_MASK;
		}
		bit >>= 1;
		if (0 === bit) {
			if (left <= 0 || at >= data.length) break;
			control = data[at] ?? 0;
			at += 1;
			left -= 1;
			bit = LZSS_BIT;
		}
	}
	return at;
}

/**
 * `Reader.Unpack10`: a control word of one byte, read from its lowest bit up, where a set bit stands for two
 * bytes - one that stands as it is and a length behind it - and a clear one for a single byte that stands as
 * it is.
 */
export function unpackIsgRuns(
	data: Buffer,
	from: number,
	remaining: number,
	output: Buffer,
): number {
	let at = from;
	let dst = 0;
	let left = remaining;
	if (left <= 0) return at;
	let control = data[at] ?? 0;
	at += 1;
	left -= 1;
	let bit = RUNS_BIT;
	while (left > 0 && dst < output.length) {
		if (at >= data.length) break;
		const value = data[at] ?? 0;
		at += 1;
		left -= 1;
		if (0 !== (control & bit)) {
			if (at >= data.length) break;
			const count = 2 + (data[at] ?? 0);
			at += 1;
			left -= 1;
			for (let index = 0; index < count && dst < output.length; index += 1) {
				output[dst] = value;
				dst += 1;
			}
		} else {
			output[dst] = value;
			dst += 1;
		}
		bit <<= 1;
		if (RUNS_BIT_MARK === bit) {
			if (left <= 0 || at >= data.length) break;
			control = data[at] ?? 0;
			at += 1;
			left -= 1;
			bit = RUNS_BIT;
		}
	}
	return at;
}

/** `Reader.Unpack`: the palette the picture reads through, and the run of its own bytes behind it. */
export function unpackIsgPicture(
	data: Buffer,
	layout: IsgLayout,
): { pixels: Buffer; palette: Buffer } {
	if (TYPE_OVERLAY === layout.type) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The picture stands over a baseline picture of its own name beside it, which this port does not read",
		);
	}
	if (TYPE_LZSS !== layout.type && TYPE_RUNS !== layout.type) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`The ISM engine's picture of type 0x${layout.type.toString(16)} is not ported`,
		);
	}
	const palette = readIsgPalette(data, DATA_START, layout.colours);
	if (!palette) throw invalid("The picture's palette reaches past the file");
	const pixels = Buffer.alloc(layout.width * layout.height, 0x00);
	const from = DATA_START + layout.colours * COLOUR_BYTES;
	if (TYPE_LZSS === layout.type) {
		unpackIsgLzss(data, from, layout.packed, pixels);
	} else {
		unpackIsgRuns(data, from, layout.packed, pixels);
	}
	return { pixels, palette };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ismIsgImageDescriptor: FormatDescriptor = {
	id: "ism-isg-image",
	name: "ISM engine image",
	extensions: ["isg"],
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
			source: "ArcFormats/Ism/ImageISG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ismIsgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ismIsgImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARK, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readIsgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readIsgLayout(await readStored(source));
		if (!layout) throw invalid("Not an ISM engine picture");
		// A way this port cannot unpack is refused here rather than at the entry, so it never lists a
		// picture whose bytes it cannot hand over.
		if (TYPE_LZSS !== layout.type && TYPE_RUNS !== layout.type) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				TYPE_OVERLAY === layout.type
					? "The picture stands over a baseline picture of its own name beside it, which this port does not read"
					: `The ISM engine's picture of type 0x${layout.type.toString(16)} is not ported`,
			);
		}
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
					bitsPerPixel: layout.bitsPerPixel,
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
				bitsPerPixel: layout.bitsPerPixel,
				colours: layout.colours,
				pictureType: layout.type,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readIsgLayout(stored);
		if (!layout) throw invalid("Not an ISM engine picture");
		const { pixels, palette } = unpackIsgPicture(stored, layout);
		// The reference hands the picture over flipped, so its rows are kept bottom up.
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, true),
		]);
	},
});
