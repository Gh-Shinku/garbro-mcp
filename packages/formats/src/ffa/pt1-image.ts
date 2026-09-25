// Port of GARbro "ArcFormats/Ffa/ImagePT1.cs" (tag "PT1", class `Pt1Format`, reader `Reader`), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is one of four kinds: the kind stands in the first word of the file and the
// places of the picture of the first two of them stand in an LZSS stream over a frame of the walk itself.
// That frame is the same for every picture: a run of thirteen of every place of a byte, then the places
// of a byte from zero up and then from the highest one down, then a hundred and twenty eight places of
// nothing, a hundred and ten of a space and eighteen more of nothing - 0x1000 places, which the stream
// walks as a ring from 0xFEE. A flag byte carries eight steps, lowest place first: a set place writes one
// place of its own, a clear one a run whose place and count stand in the two bytes behind it. The first
// kind writes one place of the picture for every step, the second one three of them, so the two kinds part
// in a single place of the walk.
//
// The kinds of two and three stand of a walk of their own, which this port does not carry: they are
// detected as pictures of the engine and refused when their places are asked for.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp24 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The four kinds of the format, which stand in the first word as 0, 1, 2 and 3. */
export const PT1_TYPES: readonly number[] = [0, 1, 2, 3];
const HEAD_SIZE = 0x20;
const MARKER_AT = 4;
const MARKER = -1;
const OFFSET_X_AT = 8;
const OFFSET_Y_AT = 12;
const WIDTH_AT = 16;
const HEIGHT_AT = 20;
const PACKED_AT = 24;
const UNPACKED_AT = 28;
/** The kinds this port walks, and the places of a colour of each of them. */
const PLAIN_KIND = 0;
const TRIPLE_KIND = 1;
const ALPHA_KIND = 3;
const COLOR_PLACES = 3;
const BITS_PER_PIXEL = 24;
const ALPHA_BITS_PER_PIXEL = 32;
/** The frame of the walk: a ring of 0x1000 places the stream starts at its own place of 0xFEE in. */
const FRAME_SIZE = 0x1000;
const FRAME_START = 0xfee;
const FRAME_ALPHABET = 0x100;
const FRAME_RUN = 13;
const FRAME_SKIP = 0x80;
const FRAME_SPACES = 0x6e;
const FRAME_TAIL = 0x12;
const SPACE = 0x20;
/** A step of the stream: a set place writes a place of its own, a clear one a run. */
const FLAG_FIRST = 1;
const FLAG_END = 0x100;
const HIGH_NIBBLE = 0xf0;
const LOW_NIBBLE = 0x0f;
const NIBBLE_SHIFT = 4;
const COUNT_BASE = 3;
const FRAME_MASK = 0xfff;

export interface Pt1Layout {
	type: number;
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	packedSize: number;
	unpackedSize: number;
	/** The places of a colour of a picture, which the kind of it names. */
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `Pt1Format.ReadMetaData`. */
export function readPt1Layout(data: Buffer): Pt1Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const type = data.readInt32LE(0);
	if (type < 0 || type > 3) return undefined;
	if (MARKER !== data.readInt32LE(MARKER_AT)) return undefined;
	const offsetX = data.readInt32LE(OFFSET_X_AT);
	const offsetY = data.readInt32LE(OFFSET_Y_AT);
	const width = data.readUInt32LE(WIDTH_AT);
	const height = data.readUInt32LE(HEIGHT_AT);
	const packedSize = data.readInt32LE(PACKED_AT);
	const unpackedSize = data.readInt32LE(UNPACKED_AT);
	if (unpackedSize !== width * height * COLOR_PLACES) return undefined;
	// The reference reads the packed places into an array of its own and refuses a file that ends
	// before them; a walk of no places is not one this port can carry either.
	if (packedSize <= 0 || HEAD_SIZE + packedSize > data.length) return undefined;
	return {
		type,
		offsetX,
		offsetY,
		width,
		height,
		packedSize,
		unpackedSize,
		bitsPerPixel: ALPHA_KIND === type ? ALPHA_BITS_PER_PIXEL : BITS_PER_PIXEL,
	};
}

/** `Reader.PopulateLzssFrame`: the frame every stream of the walk stands of. */
export function populatePt1Frame(): Buffer {
	const frame = Buffer.alloc(FRAME_SIZE, 0);
	let at = 0;
	for (let place = 0; place < FRAME_ALPHABET; place += 1) {
		for (let run = 0; run < FRAME_RUN; run += 1) frame[at++] = place;
	}
	for (let place = 0; place < FRAME_ALPHABET; place += 1) frame[at++] = place;
	for (let place = FRAME_ALPHABET - 1; place >= 0; place -= 1)
		frame[at++] = place;
	for (let run = 0; run < FRAME_SKIP; run += 1) frame[at++] = 0;
	for (let run = 0; run < FRAME_SPACES; run += 1) frame[at++] = SPACE;
	for (let run = 0; run < FRAME_TAIL; run += 1) frame[at++] = 0;
	return frame;
}

/**
 * `Reader.UnpackV0` and `Reader.UnpackV1`: the LZSS walk over the frame. The two kinds part in one place
 * alone - the first writes one place of the picture for every step and the second three of them - so one
 * walk carries both of them.
 */
export function unpackPt1Lzss(
	input: Buffer,
	output: Buffer,
	triple: boolean,
): void {
	const frame = populatePt1Frame();
	let source = 0;
	let at = 0;
	let ring = FRAME_START;
	while (source < input.length) {
		const flag = input[source++] ?? 0;
		for (let mask = FLAG_FIRST; mask !== FLAG_END; mask <<= 1) {
			if (0 !== (flag & mask)) {
				const place = input[source++] ?? 0;
				frame[ring++] = place;
				ring &= FRAME_MASK;
				output[at++] = place;
				if (triple) {
					output[at++] = place;
					output[at++] = place;
				}
			} else {
				let from = input[source++] ?? 0;
				const packed = input[source++] ?? 0;
				from |= (packed & HIGH_NIBBLE) << NIBBLE_SHIFT;
				let count = (packed & LOW_NIBBLE) + COUNT_BASE;
				for (; count !== 0; count -= 1) {
					const place = frame[from++] ?? 0;
					frame[ring++] = place;
					from &= FRAME_MASK;
					ring &= FRAME_MASK;
					output[at++] = place;
					if (triple) {
						output[at++] = place;
						output[at++] = place;
					}
				}
			}
			if (at >= output.length) return;
		}
	}
}

/** `Reader.Unpack`: the places of a picture of the kinds this port walks. */
export function unpackPt1Picture(data: Buffer, layout: Pt1Layout): Buffer {
	if (PLAIN_KIND !== layout.type && TRIPLE_KIND !== layout.type) {
		throw unsupported(
			"The walk of the places of the kinds of two and three of the engine",
		);
	}
	const output = Buffer.alloc(layout.unpackedSize, 0);
	const packed = data.subarray(
		HEAD_SIZE,
		Math.min(data.length, HEAD_SIZE + layout.packedSize),
	);
	unpackPt1Lzss(packed, output, TRIPLE_KIND === layout.type);
	return output;
}

export const ffaPt1ImageDescriptor: FormatDescriptor = {
	id: "ffa-pt1-image",
	name: "FFA System PT1 image",
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
			source: "ArcFormats/Ffa/ImagePT1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ffaPt1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaPt1ImageDescriptor,
	detection: {
		signatures: PT1_TYPES.map((type) => ({
			bytes: Buffer.from([type, 0, 0, 0]),
		})),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readPt1Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPt1Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the FFA engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				kind: layout.type,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPt1Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the FFA engine");
		const pixels = unpackPt1Picture(data, layout);
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
