// Format reference: GARbro "ArcFormats/StudioJikkenshitsu/ImageDAT.cs", classes `SpDatFormat` and `SpReader`
// (a Studio Jikkenshitsu picture of the kind its own files stand as: the places of the picture stand behind a
// walk of runs, and the shape of them behind a walk of runs of its own). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A picture of this kind may stand under the standard cipher; the key of such a picture stands in the
// reference's own settings, which name a key for every title it knows, and this project has no such settings.
// A picture whose places stand under the cipher is therefore refused with a message, and a picture whose
// places stand as they stand is read the same way the reference reads it.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { paletteTriples, writeBmp8Palette, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference registers no word of its own: a picture of this kind is told by the head of its own. */
const HEADER_SIZE = 0x22;
const FLAGS_FIELD = 0x00;
const SIGNATURE_PLACE = 0x02;
const SIGNATURE_VALUE = 1;
const ZERO_FIELD = 0x04;
const WIDTH_FIELD = 0x16;
const HEIGHT_FIELD = 0x18;
const COLORS_FIELD = 0x1e;
/** The place that counts the places of a picture the colours stand beside, and the places of a colour of a
 * picture that holds its own shape. */
const ENCRYPTED_FLAG = 0x08;
const SHAPE_FLAGS = 0xf4;
const SHAPE_VALUE = 0x04;
/** The places of a colour the reference stands for a picture of eight bits, and the greatest number of them a
 * picture may name. */
const PALETTE_SIZE = 4;
const MAXIMUM_COLORS = 0x100;
/** The places of a picture stand beside the head, the places of its shape beside those. */
const MAXIMUM_SIZE = 0x2000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** The places of a shape stand two to a byte, the highest places of a byte standing for the place of a picture
 * that stands first. */
const SHAPE_NIBBLES = 2;

export interface SpeedLayout {
	flags: number;
	width: number;
	height: number;
	colors: number;
}

export interface SpeedPicture {
	pixels: Buffer;
	/** The shape of the picture, which stands two places to a byte. */
	alpha: Buffer | undefined;
	palette: Buffer | undefined;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `SpDatFormat.ReadMetaData`: the word behind the head of a picture stands at nought, the places of a colour
 * of the picture stand in the places at `0x00`, the place at `0x02` stands at one, the width of the picture
 * stands in the words at `0x16`, its height in the words at `0x18` and how many colours stand beside it in the
 * words at `0x1E`.
 */
export function readSpeedLayout(
	data: Buffer,
	fileLength = data.length,
): SpeedLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	if (0 !== data.readInt32LE(ZERO_FIELD)) return undefined;
	if (SIGNATURE_VALUE !== data[SIGNATURE_PLACE]) return undefined;
	const flags = data.readUInt16LE(FLAGS_FIELD);
	if (0 !== (flags & ~0xff)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const colors = data.readUInt16LE(COLORS_FIELD);
	if (width <= 0 || width > MAXIMUM_SIZE) return undefined;
	if (height <= 0 || height > MAXIMUM_SIZE) return undefined;
	if (colors > MAXIMUM_COLORS) return undefined;
	if (width * height > LIMIT) return undefined;
	// The key of an encrypted picture stands in the reference's own settings, which this project does not
	// carry.
	if (0 !== (flags & ENCRYPTED_FLAG)) return undefined;
	return { flags, width, height, colors };
}

/**
 * `SpReader.UnpackRle`: a place stands as it stands, and where the place behind it stands the same, the place
 * behind that one names how many places stand the same way, counting the two that stand before it.
 */
export function unpackSpeedRuns(input: Buffer, size: number): Buffer {
	const output: Buffer = Buffer.alloc(size, 0x00);
	let pixel = 0;
	let src = 0;
	let dst = 0;
	let step = 0;
	while (dst < output.length) {
		if (src >= input.length) break;
		const rep = input[src] ?? 0;
		src += 1;
		if (0 === step) {
			step = 1;
			output[dst] = rep;
			dst += 1;
		} else if (1 === step) {
			if (dst > 0 && output[dst - 1] === rep) {
				pixel = rep;
				step = 2;
			}
			output[dst] = rep;
			dst += 1;
		} else {
			const count = rep >= 2 ? rep - 2 : 0;
			if (dst + count > output.length) {
				throw invalidPicture("SPEED picture names more places than it holds");
			}
			output.fill(pixel, dst, dst + count);
			dst += count;
			step = 0;
		}
	}
	return output;
}

/** One walk of places of a picture: where the head names no walk of its own, the places stand as they stand;
 * where it names one, the places stand behind it, the head standing under the cipher where the head says so. */
function unpackSpeedStream(
	data: Buffer,
	at: number,
	packedSize: number,
	size: number,
): { pixels: Buffer; next: number } {
	if (0 === packedSize) {
		if (at + size > data.length) {
			throw invalidPicture("SPEED picture stands short of its own places");
		}
		return {
			pixels: Buffer.from(data.subarray(at, at + size)),
			next: at + size,
		};
	}
	if (at + packedSize > data.length) {
		throw invalidPicture("SPEED picture stands short of its own places");
	}
	const walk: Buffer = Buffer.from(data.subarray(at, at + packedSize));
	return { pixels: unpackSpeedRuns(walk, size), next: at + packedSize };
}

/**
 * `SpReader.Unpack`: the places of a picture of this kind stand in one walk and the places of its shape in
 * another, the two walks standing one behind the other. Every place of the shape stands two to a byte, the
 * highest places of a byte standing for the place of the picture that stands first, and a place of the shape
 * stands as many places of a colour of the shape as name it.
 */
export function decodeSpeed(data: Buffer, layout: SpeedLayout): SpeedPicture {
	let at = HEADER_SIZE;
	if (at + 4 > data.length) {
		throw invalidPicture("SPEED picture stands short of its own head");
	}
	let packedSize = data.readInt32LE(at);
	at += 4;
	let palette: Buffer | undefined;
	if (layout.colors > 0) {
		const paletteSize = layout.colors * PALETTE_SIZE;
		if (at + paletteSize > data.length) {
			throw invalidPicture("SPEED picture stands short of its own colours");
		}
		palette = paletteTriples(Buffer.from(data.subarray(at, at + paletteSize)));
		at += paletteSize;
	}
	const picture = unpackSpeedStream(
		data,
		at,
		packedSize,
		layout.width * layout.height,
	);
	at = picture.next;
	let alpha: Buffer | undefined;
	if (SHAPE_VALUE === (layout.flags & SHAPE_FLAGS)) {
		if (at + 4 > data.length) {
			throw invalidPicture("SPEED picture stands short of its own shape");
		}
		packedSize = data.readInt32LE(at);
		at += 4;
		if (0 !== packedSize) {
			const shape = unpackSpeedStream(
				data,
				at,
				packedSize,
				Math.floor(picture.pixels.length / SHAPE_NIBBLES),
			);
			alpha = shape.pixels;
		}
	}
	return { pixels: picture.pixels, alpha, palette };
}

/** `SpReader.ConvertToRgbA`: a place of a picture stands as its colour with the places of its shape stood in
 * it, the highest places of a byte of the shape standing for the place that stands first. */
export function composeSpeed(
	picture: SpeedPicture,
	layout: SpeedLayout,
): Buffer {
	const palette = picture.palette;
	if (!palette) {
		throw invalidPicture(
			"SPEED picture names no colours of its own, which this project does not read",
		);
	}
	if (!picture.alpha) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			picture.pixels,
			palette,
			true,
		);
	}
	const out: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	for (let src = 0; src < picture.pixels.length; src += 1) {
		const code = picture.pixels[src] ?? 0;
		const nibble =
			(((picture.alpha[src >> 1] ?? 0) >> ((~src & 1) * (8 / SHAPE_NIBBLES))) &
				0x0f) *
			0x11;
		out[src * 4] = palette[code * 3 + 2] ?? 0;
		out[src * 4 + 1] = palette[code * 3 + 1] ?? 0;
		out[src * 4 + 2] = palette[code * 3] ?? 0;
		out[src * 4 + 3] = nibble & 0xff;
	}
	return writeBmp32(layout.width, layout.height, out, true);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readSpeed(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readSpeedLayout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not a SPEED picture");
	return { stored, layout };
}

export const studioJikkenshitsuSpeedImageDescriptor: FormatDescriptor = {
	id: "studio-jikkenshitsu-speed-image",
	name: "Studio Jikkenshitsu picture of the kind its own files stand as",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/StudioJikkenshitsu/ImageDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const studioJikkenshitsuSpeedImageFormat: ArchiveFormat =
	defineFixedArchive({
		descriptor: studioJikkenshitsuSpeedImageDescriptor,
		// The reference registers no word of its own, so a picture of this kind is tried after every kind that
		// is told by a word of its own.
		detection: { signatures: [], priority: -1 },
		async detect(source: ByteSource): Promise<boolean> {
			if (source.size < BigInt(HEADER_SIZE)) return false;
			try {
				const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
				return readSpeedLayout(header, Number(source.size)) !== undefined;
			} catch {
				return false;
			}
		},
		async read(source: ByteSource, sourcePath: string) {
			const { layout } = await readSpeed(source);
			const fileName = sourcePath.replace(/^.*[/\\]/, "");
			const shaped = SHAPE_VALUE === (layout.flags & SHAPE_FLAGS);
			const entry: FixedEntry = createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: shaped ? 32 : 8,
					colors: layout.colors,
				},
			});
			return {
				entries: [entry],
				metadata: { image: "bmp", bitsPerPixel: shaped ? 32 : 8 },
			};
		},
		async openEntry(source: ByteSource) {
			const { stored, layout } = await readSpeed(source);
			// The places of the picture stand as a bitmap of its own.
			return Readable.from([composeSpeed(decodeSpeed(stored, layout), layout)]);
		},
	});
