// Format reference: GARBro "ArcFormats/Ism/ImageISG.cs", classes `IsgFormat` and the `Reader` behind it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Two of the three ways this engine packs a picture stand on the file itself: a run length walk and an LZSS
// walk, both over a palette of one byte a pixel. The third stands on a **baseline picture of a name the file
// carries**, read from a file beside it, over which it writes blocks of four by four pixels. The reference
// resolves that name through its own file system, across whatever archives stand mounted; this port reads it
// beside the file it was asked from, and follows a baseline that is itself of the third way down to the same
// count of pictures the reference stops at.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
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
/** Where the name of the baseline picture of the third way begins, and how many bytes it may stand of. */
const BASE_NAME_AT = 0x30;
const BASE_NAME_SIZE = 0x10;
/** The reference reads a name that stands nowhere again of its first twelve bytes. */
const BASE_NAME_FALLBACK = 12;
/** How deep a picture of the third way may stand over another before the reference gives up. */
const RECURSION_LIMIT = 32;
/** A block of the third way stands of four pixels of four rows. */
const BLOCK_PIXELS = 4;
/** The control bytes of the third way stand of one bit to a block of a hundred and twenty eight pixels. */
const CONTROL_PIXELS = 128;
/** The room the reference keeps for the overlay data: two blocks of the walk of the engine to a count. */
const OVERLAY_ROOM = 32;
const OVERLAY_SLACK = 8;

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

/**
 * `Reader.Unpack34`: the name of the baseline picture the file carries, and the place behind it. The
 * reference reads a name of at most sixteen bytes, ended by nought.
 */
export function readIsgBaseName(
	data: Buffer,
): { name: string; at: number } | undefined {
	const end = Math.min(data.length, BASE_NAME_AT + BASE_NAME_SIZE);
	let at = BASE_NAME_AT;
	while (at < end && 0x00 !== data[at]) at += 1;
	if (at >= end) return undefined;
	const name = data.toString("latin1", BASE_NAME_AT, at);
	if (0 === name.length) return undefined;
	return { name, at: at + 1 };
}

/**
 * `Reader.Unpack34`: the overlay blocks written over the pixels of the baseline picture. The walk stands of
 * four by four pixels, of one bit of a control byte to a block, and the bytes of the blocks that stand read
 * come one after another out of the unpacked overlay data.
 */
export function unpackIsgOverlay(
	data: Buffer,
	layout: IsgLayout,
	base: Buffer,
): Buffer {
	const named = readIsgBaseName(data);
	if (!named) throw invalid("The picture names no baseline picture");
	const { width, height } = layout;
	if (named.at + 8 > data.length) {
		throw invalid("The picture stands short of its own counts");
	}
	const count = data.readInt32LE(named.at);
	const packed = data.readInt32LE(named.at + 4);
	const controls = Math.trunc((width * height) / CONTROL_PIXELS);
	let at = named.at + 8;
	if (controls < 0 || at + controls > data.length) {
		throw invalid("The control bytes of the picture reach past the file");
	}
	const control = data.subarray(at, at + controls);
	at += controls;
	if (count < 0 || count * OVERLAY_ROOM + OVERLAY_SLACK > LIMIT) {
		throw invalid(
			"The picture declares a count of overlay blocks this project will not hold",
		);
	}
	const overlay = Buffer.alloc(count * OVERLAY_ROOM + OVERLAY_SLACK, 0x00);
	unpackIsgLzss(data, at, packed, overlay);
	const pixels = Buffer.from(base);
	let bit = 0;
	let controlAt = 0;
	let dataAt = 0;
	for (let y = 0; y < height; y += BLOCK_PIXELS) {
		for (let x = 0; x < width; x += BLOCK_PIXELS) {
			if (0 !== ((1 << bit) & (control[controlAt] ?? 0))) {
				let dst = y * width + x;
				for (let row = 0; row < BLOCK_PIXELS; row += 1) {
					for (let column = 0; column < BLOCK_PIXELS; column += 1) {
						// The reference writes into the array of the baseline picture without a count of its own;
						// a block that reaches past that array stands left out here.
						if (dst + column < pixels.length) {
							pixels[dst + column] = overlay[dataAt + column] ?? 0;
						}
					}
					dataAt += BLOCK_PIXELS;
					dst += width;
				}
			}
			bit += 1;
			if (8 === bit) {
				bit = 0;
				controlAt += 1;
			}
		}
	}
	return pixels;
}

/** `Reader.Unpack`: the palette the picture reads through, and the run of its own bytes behind it. */
export function unpackIsgPicture(
	data: Buffer,
	layout: IsgLayout,
): { pixels: Buffer; palette: Buffer } {
	if (TYPE_OVERLAY === layout.type) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"A picture of this way stands over a baseline picture, which stands read of the file itself",
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

/**
 * `IsgFormat.Read`, of the third way as well: a picture that stands over a baseline picture read from a file
 * of the name it carries beside itself. A baseline that is itself of the third way stands read the same way,
 * of the count of pictures the reference stops at.
 */
async function readIsgPicture(
	data: Buffer,
	layout: IsgLayout,
	sourcePath: string,
	depth: number,
): Promise<{ pixels: Buffer; palette: Buffer }> {
	if (TYPE_OVERLAY !== layout.type) return unpackIsgPicture(data, layout);
	if (depth >= RECURSION_LIMIT) {
		throw invalid(
			"The baseline pictures of this file stand deeper than the count of the reference",
		);
	}
	const named = readIsgBaseName(data);
	if (!named) throw invalid("The picture names no baseline picture");
	let baseName = named.name;
	let base = await readCompanionFile(sourcePath, baseName);
	if (!base && baseName.length > BASE_NAME_FALLBACK) {
		baseName = baseName.slice(0, BASE_NAME_FALLBACK);
		base = await readCompanionFile(sourcePath, baseName);
	}
	if (!base) {
		throw invalid(
			`The baseline picture ${named.name} stands nowhere beside the file`,
		);
	}
	const baseLayout = readIsgLayout(base);
	if (
		!baseLayout ||
		baseLayout.width !== layout.width ||
		baseLayout.height !== layout.height
	) {
		throw invalid(
			"The baseline picture stands of no count of the picture itself",
		);
	}
	const picture = await readIsgPicture(
		base,
		baseLayout,
		resolve(dirname(sourcePath), baseName),
		depth + 1,
	);
	return {
		pixels: unpackIsgOverlay(data, layout, picture.pixels),
		palette: picture.palette,
	};
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
		if (
			TYPE_LZSS !== layout.type &&
			TYPE_RUNS !== layout.type &&
			TYPE_OVERLAY !== layout.type
		) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`The ISM engine's picture of type 0x${layout.type.toString(16)} is not ported`,
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
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readIsgLayout(stored);
		if (!layout) throw invalid("Not an ISM engine picture");
		void entry;
		const { pixels, palette } = await readIsgPicture(
			stored,
			layout,
			sourcePath,
			0,
		);
		// The reference hands the picture over flipped, so its rows are kept bottom up.
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, true),
		]);
	},
});
