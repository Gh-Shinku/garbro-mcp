// Format reference: GARbro "Legacy/Mink/ImageFC.cs", classes `FcFormat` and the `FcReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 8;
/** The picture opens with `FC`, the case of the second letter standing of either way. */
const FIRST_LETTER = 0x46;
const SECOND_LETTER = 0x43;
const LETTER_MASK = 0xdf;
const BITS_FIELD = 2;
const FLAG_FIELD = 3;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const BITS_24 = 24;
const BITS_32 = 32;
/** The places of a picture of the second kind stand of a place of the greys it takes its runs from. */
const GREY_REFERENCE = 0x808080;
const GREY_BIAS = 0x80;
const PLACE_SIZE = 4;
const WORD = 4;
const WORD_BITS = 32;
const SIGNATURE_COUNT = 8;
const LIMIT = 256 * 1024 * 1024;

export interface FcLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flag: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `FcFormat.ReadMetaData`: the head of the picture, which opens with `FC` of either case. */
export function readFcLayout(data: Buffer): FcLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (FIRST_LETTER !== data[0]) return undefined;
	if (SECOND_LETTER !== ((data[1] ?? 0) & LETTER_MASK)) return undefined;
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (BITS_24 !== bitsPerPixel && BITS_32 !== bitsPerPixel) return undefined;
	const flag = data[FLAG_FIELD] ?? 0;
	if (0 !== flag && 1 !== flag) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT) return undefined;
	return { width, height, bitsPerPixel, flag };
}

/** The eight heads the reference registers as its signatures, both cases of the second letter. */
export function fcSignatures(): readonly { bytes: Uint8Array }[] {
	const signatures: { bytes: Uint8Array }[] = [];
	for (const bits of [BITS_24, BITS_32]) {
		for (const flag of [0, 1]) {
			for (const letter of [SECOND_LETTER, SECOND_LETTER | 0x20]) {
				signatures.push({
					bytes: Uint8Array.from([FIRST_LETTER, letter, bits, flag]),
				});
			}
		}
	}
	return signatures;
}
if (SIGNATURE_COUNT !== fcSignatures().length) {
	throw new Error("the picture stands of eight heads");
}

/**
 * The bits of a picture. The reference keeps them in a word of four bytes which it refills as it empties,
 * with the bytes of the picture read from the highest one down and the places behind the end of the picture
 * standing of nothing; the port reads the same bits a word at a time.
 */
class FcBits {
	private readonly data: Buffer;
	private position = HEAD_SIZE;
	private word = 0;
	private left = 0;

	constructor(data: Buffer) {
		this.data = data;
	}

	private nextWord(): number {
		let word = 0;
		for (let at = 0; at < WORD; at += 1) {
			word = ((word << 8) | (this.data[this.position + at] ?? 0)) >>> 0;
		}
		this.position += WORD;
		return word;
	}

	bit(): number {
		if (0 === this.left) {
			this.word = this.nextWord();
			this.left = WORD_BITS;
		}
		this.left -= 1;
		return (this.word >>> this.left) & 1;
	}

	bits(count: number): number {
		let value = 0;
		for (let at = 0; at < count; at += 1) {
			value = ((value << 1) | this.bit()) >>> 0;
		}
		return value;
	}
}

/** `FcReader.GetVarInt`: a run of the bits, of which the first place standing clear ends the count. */
function readFcVarInt(bits: FcBits): number {
	let count = 0;
	do {
		count += 1;
	} while (0 !== bits.bit());
	let value = 1;
	for (let at = 0; at < count; at += 1) {
		value = ((value << 1) | bits.bit()) >>> 0;
	}
	return (value - 2) >>> 0;
}

/** The run of the bits, read as the reference reads it: the place standing lowest names the sign. */
function readFcDelta(bits: FcBits): number {
	const value = readFcVarInt(bits);
	return ((value >>> 1) ^ (0 - (value & 1))) >>> 0;
}

/** `Binary.RotR`: the places of a colour of a picture turn about as they take a run of their own. */
function rotateRight(value: number, count: number): number {
	const places = count & 0x1f;
	return ((value >>> places) | (value << (WORD_BITS - places))) >>> 0;
}

/** A place of a picture, taken from the place before it, each of its colours taking a run of the bits. */
function readFcShifted(bits: FcBits, pixel: number): number {
	let value = pixel;
	for (let at = 0; at < 3; at += 1) {
		value = (rotateRight(value, 8) + (readFcDelta(bits) << 24)) >>> 0;
	}
	return value >>> 8;
}

/**
 * `FcReader.UnpackRgb`: the places of the colours of a picture, one at a time. The reference writes the
 * five words of a picture as one chain of tests over the bits; the chain stands here of tests one inside
 * the other, because the first two of the words stand of a place of their own and the ones behind them do
 * not.
 */
function unpackFcRgb(
	output: Uint32Array,
	layout: FcLayout,
	bits: FcBits,
): void {
	const reference = 0 !== layout.flag ? GREY_REFERENCE : 0;
	let pixel = reference;
	let at = 0;
	while (at < output.length) {
		if (0 === bits.bit()) {
			// The place stands of the place before it, or of the place above and to the left of it.
			if (0 !== bits.bit()) {
				const offset = layout.width + bits.bit();
				pixel = output[at - offset + 1] ?? 0;
			} else {
				pixel = output[at - 1] ?? 0;
			}
			output[at] = readFcShifted(bits, pixel);
			at += 1;
			pixel = output[at - 1] ?? 0;
			continue;
		}
		if (0 === bits.bit()) {
			// The place stands of the place above and to the left of it, or of the place of the greys.
			if (0 === bits.bit()) {
				pixel = output[at - layout.width - 1] ?? 0;
				output[at] = readFcShifted(bits, pixel);
			} else {
				pixel = reference;
				for (let place = 0; place < 3; place += 1) {
					pixel = (pixel ^ ((readFcDelta(bits) & 0xff) << (place * 8))) >>> 0;
				}
				output[at] = pixel;
			}
			at += 1;
			continue;
		}
		if (0 !== bits.bit()) {
			// The place stands as one of the three places of the row above it stands.
			let offset = layout.width;
			if (0 !== bits.bit()) {
				offset += bits.bit();
			} else {
				offset -= 1;
			}
			pixel = output[at - offset] ?? 0;
			output[at] = pixel;
			at += 1;
			continue;
		}
		if (0 === bits.bit()) {
			// The place stands of three colours, as the bits behind it name them.
			pixel = bits.bits(24);
			output[at] = pixel;
			at += 1;
			continue;
		}
		// The place the walk has reached stands as many times as the run of the bits says. The reference
		// walks as far as the run names and takes the rest of the picture for itself; the port stops at the
		// place the picture ends at.
		const places = Math.min(readFcVarInt(bits), output.length - at);
		for (let run = 0; run < places; run += 1) {
			output[at] = pixel;
			at += 1;
		}
	}
}

/** `FcReader.UnpackAlpha`: the alpha of the places of a picture, as runs of the bits name them. */
function unpackFcAlpha(output: Uint32Array, bits: FcBits): void {
	let at = 0;
	while (at < output.length) {
		const value = (bits.bits(8) << 24) >>> 0;
		let count = readFcVarInt(bits) + 1;
		// The reference walks past the end of the picture where the runs of the bits name more places than
		// stand in it; the port stops there.
		while (0 !== count && at < output.length) {
			output[at] = ((output[at] ?? 0) | value) >>> 0;
			at += 1;
			count -= 1;
		}
	}
}

/** `FcReader.RestoreRgb`: the colours of a picture of the second kind stand below the place above them. */
function restoreFcRgb(output: Uint32Array, width: number): void {
	for (let at = width; at < output.length; at += 1) {
		const previous = output[at - width] ?? 0;
		const pixel = output[at] ?? 0;
		output[at] =
			(((pixel & 0xff) + (previous & 0xff) - GREY_BIAS) & 0xff) |
			(((((pixel >>> 8) & 0xff) + ((previous >>> 8) & 0xff) - GREY_BIAS) &
				0xff) <<
				8) |
			(((((pixel >>> 16) & 0xff) + ((previous >>> 16) & 0xff) - GREY_BIAS) &
				0xff) <<
				16) |
			(pixel & 0xff000000);
	}
}

/** `FcReader.Unpack`: the places of the picture, read as the head names them, handed over the right way up. */
export function unpackFcPicture(data: Buffer, layout: FcLayout): Buffer {
	const bits = new FcBits(data);
	const places = new Uint32Array(layout.width * layout.height);
	unpackFcRgb(places, layout, bits);
	if (BITS_32 === layout.bitsPerPixel) unpackFcAlpha(places, bits);
	if (0 !== layout.flag) restoreFcRgb(places, layout.width);
	// The reference hands the picture over as a place of four bytes to a pixel, the last of them the alpha
	// of the picture, and stands it the other way up from the rows it read.
	const pixels: Buffer = Buffer.alloc(places.length * PLACE_SIZE, 0x00);
	for (let at = 0; at < places.length; at += 1) {
		pixels.writeUInt32LE(places[at] ?? 0, at * PLACE_SIZE);
	}
	return writeBmp32(layout.width, layout.height, pixels, true);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const fcImageDescriptor: FormatDescriptor = {
	id: "mink-fc-image",
	name: "Mink compressed bitmap",
	extensions: ["fc"],
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
			source: "Legacy/Mink/ImageFC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fcImageDescriptor,
	detection: { signatures: fcSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readFcLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readFcLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Mink engine");
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
					bitsPerPixel: layout.bitsPerPixel,
					flag: layout.flag,
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readFcLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Mink engine");
		return Readable.from([unpackFcPicture(data, layout)]);
	},
});
