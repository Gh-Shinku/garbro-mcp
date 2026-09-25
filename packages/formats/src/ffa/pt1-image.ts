// Port of GARbro "ArcFormats/Ffa/ImagePT1.cs" (tag "PT1", class `Pt1Format`, reader `Reader`), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is one of four kinds, and the kind stands in the first word of the file.
//
// The two oldest kinds walk an LZSS stream over a frame the walk fills itself. That frame is the same for
// every picture: a run of thirteen of every place of a byte, then the places of a byte from zero up and
// then from the highest one down, then a hundred and twenty eight places of nothing, a hundred and ten of a
// space and eighteen more of nothing - 0x1000 places, which the stream walks as a ring from 0xFEE. A flag
// byte carries eight steps, lowest place first: a set place writes one place of its own, a clear one a run
// whose place and count stand in the two bytes behind it. The first kind writes one place of the picture
// for every step, the second one three of them, so the two kinds part in that single place of the walk.
//
// The two newer kinds walk a bit stream instead, of a reservoir the walk refills a whole number of bytes at
// a time, so its bits are read from the lowest one of a byte up. Every place is a pixel of three places:
// the first one of the picture and the first one of every row stand alone, and every other one is told
// from the place to its left, from the one above it and from a second kind of step of its own, with a
// gradient of the left, the up-left and the up places and a difference the walk reads of a code of its own.
// The newest kind carries the alpha of the picture in an LZSS stream of its first kind as well.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
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
const PREDICTOR_KIND = 2;
const ALPHA_KIND = 3;
const COLOR_PLACES = 3;
const ALPHA_PLACES = 4;
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
/** The reservoir of the bit stream of the two newer kinds: a whole number of bytes of the stream at once. */
const RESERVOIR_BITS = 32;
const RESERVOIR_SEED = 0x18;
const BYTE_BITS = 8;
const RESERVOIR_WHOLE = 0xf8;
const TAKEN_16 = 16;
const TAKEN_24 = 24;
const WORD_MASK = 0xffff;
/**
 * A difference of the walk: the code of it, the count of its places and the value the count of them stands
 * for, lowest place first. A difference no code names is the last one of the walk, of the top count.
 */
const DIFFERENCE_CODES: readonly (readonly [number, number, number])[] = [
	[1, 1, 0],
	[3, 4, -1],
	[3, 2, 1],
	[4, 14, -2],
	[4, 6, 2],
	[4, 8, -3],
	[7, 112, 3],
	[7, 48, -4],
	[7, 80, 4],
	[7, 16, -5],
	[7, 96, 5],
	[7, 32, -6],
	[7, 64, 6],
	[9, 384, -7],
	[9, 128, 7],
	[9, 256, -8],
	[11, 1536, 8],
	[11, 512, -9],
	[11, 1024, 9],
	[13, 6144, -10],
	[13, 2048, 10],
	[13, 4096, -11],
	[15, 24576, 11],
	[15, 8192, -12],
	[15, 16384, 12],
];
const DIFFERENCE_ESCAPE_BITS = 15;
const DIFFERENCE_ESCAPE = -13;
/** The steps of a place of the two newer kinds. */
const STEPS_1 = 1;
const STEPS_2 = 2;
const STEPS_3 = 3;
const UP_RUN = 8;
const UP_LEFT_RUN = 0;
const UP_LEFT = 4;

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
	/** The count of the packed places of the alpha of the kind of three, which stands behind the colours. */
	alphaPackedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
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
	let alphaPackedSize = 0;
	if (ALPHA_KIND === type) {
		const alphaAt = HEAD_SIZE + packedSize;
		if (alphaAt + 4 > data.length) return undefined;
		alphaPackedSize = data.readInt32LE(alphaAt);
		if (alphaPackedSize < 0 || alphaAt + 4 + alphaPackedSize > data.length) {
			return undefined;
		}
	}
	return {
		type,
		offsetX,
		offsetY,
		width,
		height,
		packedSize,
		unpackedSize,
		bitsPerPixel: ALPHA_KIND === type ? ALPHA_BITS_PER_PIXEL : BITS_PER_PIXEL,
		alphaPackedSize,
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
	for (let place = FRAME_ALPHABET - 1; place >= 0; place -= 1) {
		frame[at++] = place;
	}
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

function readLe32(data: Buffer, at: number): number {
	// The reference reads the places behind the end of its stream as nothing, which is what the eight
	// places it pads the stream with stand for.
	return (
		((data[at] ?? 0) |
			((data[at + 1] ?? 0) << BYTE_BITS) |
			((data[at + 2] ?? 0) << (2 * BYTE_BITS)) |
			((data[at + 3] ?? 0) << (3 * BYTE_BITS))) >>>
		0
	);
}

/**
 * `Reader.ReadNext` and the reservoir of the two newer kinds. The stream is taken a whole number of bytes
 * at a time, so the bits of a byte are read from its lowest one up and the reservoir keeps the places of
 * the place it stopped in for the steps behind it.
 */
export class Pt1Bits {
	private edx = 0;
	private ch = 0;
	private src = 0;

	constructor(private readonly input: Buffer) {}

	/**
	 * The reservoir of the walk of the newer kinds: it holds the three places behind the first pixel of
	 * the picture, and the walk reads the stream on from the seventh place of the packed stream, since the
	 * reference takes the word of the walk at the fourth place of it and steps three places.
	 */
	static seeded(input: Buffer): Pt1Bits {
		const bits = new Pt1Bits(input);
		bits.edx = readLe32(input, COLOR_PLACES);
		bits.src = 2 * COLOR_PLACES;
		bits.ch = RESERVOIR_SEED;
		return bits;
	}

	/** The count of the places the reservoir holds, of which the walk stands. */
	get held(): number {
		return this.ch;
	}

	readNext(): void {
		const cl = (RESERVOIR_BITS - this.ch) & 0xff;
		this.edx = (this.edx & (0xffffffff >>> (cl & 31))) >>> 0;
		this.edx =
			(this.edx +
				((readLe32(this.input, this.src) << (this.ch & 31)) >>> 0)) >>>
			0;
		this.src += cl >>> 3;
		this.ch = (this.ch + (cl & RESERVOIR_WHOLE)) & 0xff;
	}

	/** The `count` lowest places of the reservoir, which the walk reads without taking them. */
	peek(count: number): number {
		return (this.edx & ((1 << count) - 1)) >>> 0;
	}

	take(count: number): void {
		this.edx >>>= count;
		this.ch = (this.ch - count) & 0xff;
	}

	/** `Reader.sub_4225EA`: the difference of a place, of the lowest places of the reservoir up. */
	difference(): number {
		for (const [bits, value, result] of DIFFERENCE_CODES) {
			if (this.peek(bits) === value) {
				this.take(bits);
				return result;
			}
		}
		this.take(DIFFERENCE_ESCAPE_BITS);
		return DIFFERENCE_ESCAPE;
	}
}

/**
 * `Reader.UnpackV2`: the predictor walk of the two newer kinds. Every place is a pixel of three places and
 * stands of the place to its left, of the one above it and of a step of its own, of which the lowest place
 * of the reservoir tells.
 */
export function unpackPt1Predictor(
	input: Buffer,
	output: Buffer,
	width: number,
	height: number,
): void {
	const stride = width * COLOR_PLACES;
	let at = 0;
	// The first pixel is carried by the stream as it stands.
	output.set(input.subarray(0, COLOR_PLACES), at);
	at += COLOR_PLACES;
	const bits = Pt1Bits.seeded(input);
	const repeat = (from: number): void => {
		for (let place = 0; place < COLOR_PLACES; place += 1) {
			output[at + place] = output[from + place] ?? 0;
		}
		at += COLOR_PLACES;
	};
	const literal = (): void => {
		bits.readNext();
		const word = bits.peek(WORD_MASK);
		const third = bits.peek(TAKEN_24) >>> TAKEN_16;
		output[at] = word & 0xff;
		output[at + 1] = (word >>> BYTE_BITS) & 0xff;
		output[at + 2] = third & 0xff;
		bits.take(TAKEN_16);
		bits.take(BYTE_BITS);
		at += COLOR_PLACES;
	};
	const difference = (from: number): void => {
		output[at] = ((output[from] ?? 0) + bits.difference()) & 0xff;
		at += 1;
		bits.readNext();
		output[at] = ((output[from + 1] ?? 0) + bits.difference()) & 0xff;
		at += 1;
		bits.readNext();
		output[at] = ((output[from + 2] ?? 0) + bits.difference()) & 0xff;
		at += 1;
	};
	// The first row tells every place from the one to its left.
	for (let place = 1; place < width; place += 1) {
		bits.readNext();
		if (0 !== bits.peek(1)) {
			bits.take(1);
			repeat(at - COLOR_PLACES);
		} else {
			bits.take(1);
			if (0 !== bits.peek(1)) {
				bits.take(1);
				difference(at - COLOR_PLACES);
			} else {
				bits.take(1);
				literal();
			}
		}
	}
	// Every row behind the first tells its first place from the one above.
	for (let row = 1; row < height; row += 1) {
		bits.readNext();
		if (0 !== bits.peek(1)) {
			bits.take(1);
			repeat(at - stride);
		} else {
			bits.take(1);
			if (0 !== bits.peek(1)) {
				bits.take(1);
				difference(at - stride);
			} else {
				bits.take(1);
				literal();
			}
		}
		for (let place = 1; place < width; place += 1) {
			bits.readNext();
			if (0 !== bits.peek(1)) {
				// The gradient of the left, the up-left and the up places with a difference.
				bits.take(1);
				const above = at - stride;
				for (let channel = 0; channel < COLOR_PLACES; channel += 1) {
					if (0 !== channel) bits.readNext();
					const value =
						(output[at - COLOR_PLACES + channel] ?? 0) -
						(output[above - COLOR_PLACES + channel] ?? 0) +
						(output[above + channel] ?? 0) +
						bits.difference();
					output[at + channel] = value & 0xff;
				}
				at += COLOR_PLACES;
			} else {
				bits.take(1);
				if (0 !== bits.peek(1)) {
					// The same gradient without a difference.
					bits.take(1);
					const above = at - stride;
					for (let channel = 0; channel < COLOR_PLACES; channel += 1) {
						const value =
							(output[at - COLOR_PLACES + channel] ?? 0) -
							(output[above - COLOR_PLACES + channel] ?? 0) +
							(output[above + channel] ?? 0);
						output[at + channel] = value & 0xff;
					}
					at += COLOR_PLACES;
				} else {
					const step = bits.peek(2);
					if (STEPS_3 === step) {
						bits.take(2);
						repeat(at - COLOR_PLACES);
					} else if (STEPS_2 === step) {
						bits.take(2);
						literal();
					} else if (STEPS_1 === step) {
						bits.take(2);
						difference(at - COLOR_PLACES);
					} else {
						bits.take(2);
						const run = bits.peek(4);
						bits.take(4);
						if (UP_LEFT_RUN === run) {
							repeat(at - stride - COLOR_PLACES);
						} else if (UP_RUN === run) {
							repeat(at - stride);
						} else {
							difference(at - stride - (UP_LEFT === run ? COLOR_PLACES : 0));
						}
					}
				}
			}
		}
	}
}

/** `Reader.UnpackV3`: the predictor walk of the colours and the places of the alpha of the picture. */
export function unpackPt1Alpha(
	colour: Buffer,
	alpha: Buffer,
	width: number,
	height: number,
): Buffer {
	const places = width * height;
	const pixels = Buffer.alloc(places * ALPHA_PLACES, 0);
	for (let index = 0; index < places; index += 1) {
		pixels[index * ALPHA_PLACES] = colour[index * COLOR_PLACES] ?? 0;
		pixels[index * ALPHA_PLACES + 1] = colour[index * COLOR_PLACES + 1] ?? 0;
		pixels[index * ALPHA_PLACES + 2] = colour[index * COLOR_PLACES + 2] ?? 0;
		pixels[index * ALPHA_PLACES + 3] = alpha[index] ?? 0;
	}
	return pixels;
}

/** `Reader.Unpack`: the places of a picture of the kinds this port walks. */
export function unpackPt1Picture(data: Buffer, layout: Pt1Layout): Buffer {
	const packed = data.subarray(
		HEAD_SIZE,
		Math.min(data.length, HEAD_SIZE + layout.packedSize),
	);
	const output = Buffer.alloc(layout.unpackedSize, 0);
	switch (layout.type) {
		case PLAIN_KIND:
			unpackPt1Lzss(packed, output, false);
			return output;
		case TRIPLE_KIND:
			unpackPt1Lzss(packed, output, true);
			return output;
		default: {
			unpackPt1Predictor(packed, output, layout.width, layout.height);
			if (PREDICTOR_KIND === layout.type) return output;
			const alphaAt = HEAD_SIZE + layout.packedSize + 4;
			const alpha = Buffer.alloc(layout.width * layout.height, 0);
			unpackPt1Lzss(
				data.subarray(alphaAt, alphaAt + layout.alphaPackedSize),
				alpha,
				false,
			);
			return unpackPt1Alpha(output, alpha, layout.width, layout.height);
		}
	}
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
					kind: layout.type,
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
		return Readable.from([
			ALPHA_BITS_PER_PIXEL === layout.bitsPerPixel
				? writeBmp32(layout.width, layout.height, pixels)
				: writeBmp24(layout.width, layout.height, pixels),
		]);
	},
});
