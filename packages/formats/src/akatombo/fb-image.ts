// Format reference: GARbro "Legacy/Akatombo/ImageFB.cs", classes `FbFormat` and `FbReader`.
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
} from "../shared/fixed-archive.js";

/** The four bytes of the signature, which the reference packs into a word with a nothing in its last byte. */
const SIGNATURE = Buffer.from([0x46, 0x42, 0x18, 0x00]);
const HEADER_SIZE = 8;
/** How many bytes a pixel of the picture takes, whatever depth the header declares. */
const BYTES_PER_PIXEL = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface FbLayout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `FbFormat.ReadMetaData`: the two letters, the measurements and the depth. The depth the header declares is
 * not the depth of the pixels, which are always read as four bytes to the pixel, so the port reports the
 * depth it writes rather than the declared one.
 */
export function readFbLayout(data: Buffer): FbLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (0x46 !== data[0] || 0x42 !== data[1]) return undefined;
	const width = data.readUInt16LE(4);
	const height = data.readUInt16LE(6);
	if (0 === width || 0 === height) return undefined;
	return { width, height };
}

/**
 * The bit reader of the reference, which walks a word from its highest bit down: it starts with the highest bit
 * of a word that is not there, so the first bit it hands out is the highest bit of the first word of the
 * stream, and once the word runs out it reads the next one from the stream, four bytes of it the big endian
 * way, with a bit set at the bottom to keep the word from running out again until all thirty two bits of it
 * are gone. A stream that has no more bytes to give where a word is wanted is refused, which is where the
 * reference throws; a word the stream only partly holds keeps whatever the word before it left in those bytes,
 * which the reference's own reader does as well.
 */
interface FbBits {
	data: Buffer;
	at: number;
	bits: number;
	word: Buffer;
}

function readFbWord(state: FbBits): number {
	const room = Math.min(4, state.data.length - state.at);
	if (room <= 0) {
		throw invalidPicture("Akatombo picture is cut short of its stream");
	}
	state.data.copy(state.word, 0, state.at, state.at + room);
	state.at += room;
	return state.word.readUInt32BE(0);
}

function readFbBit(state: FbBits): number {
	let bit = state.bits >>> 31;
	state.bits = (state.bits << 1) >>> 0;
	if (0 === state.bits) {
		state.bits = readFbWord(state) >>> 0;
		bit = state.bits >>> 31;
		state.bits = ((state.bits << 1) | 1) >>> 0;
	}
	return bit;
}

/**
 * `FbReader.ReadDiff`: a count of the bits that stand at one before the value, then that many bits, of which
 * the last says whether the difference is below nothing, and the rest say how far from nothing it is — so a
 * count of one bit stands for nothing, two for one or minus one, and so on. The difference is a byte added to
 * the one before it, which is why the picture grows out of itself rather than standing in the stream.
 */
function readFbDiff(state: FbBits): number {
	let count = 1;
	while (0 !== readFbBit(state)) {
		count += 1;
	}
	let value = 1;
	for (let index = 0; index < count; index += 1) {
		// The word the reference counts in is a signed one, so a corrupt count overflows it the same way here.
		value = (value << 1) | readFbBit(state);
	}
	return ((0 !== (value & 1) ? -1 : 0) ^ (((value >> 1) - 1) | 0)) & 0xff;
}

/**
 * `FbReader.Unpack`: every pixel is four bytes, of which the last is left as whatever a copy brought there and
 * never written. A pixel whose first bit stands at one is built from nothing; otherwise the two bits behind it
 * choose a place the pixel is copied from — which of the four pixels around it depends on them — and a place
 * that stands before the start of the picture is left alone, which is how the first row and the first pixel of
 * every row are built. The three bytes of the colour are then a difference each from the pixel the copy
 * brought, added to it as bytes, so the colour of a pixel is the colour of its neighbour with the differences
 * put on top.
 */
export function unpackFb(data: Buffer, layout: FbLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(
		layout.width * layout.height * BYTES_PER_PIXEL,
		0x00,
	);
	const state: FbBits = {
		data,
		at: HEADER_SIZE,
		bits: 0x8000_0000,
		word: Buffer.alloc(4, 0x00),
	};
	const width = layout.width;
	for (let dst = 0; dst < pixels.length; dst += BYTES_PER_PIXEL) {
		if (0 === readFbBit(state)) {
			const vertical = readFbBit(state);
			const place = readFbBit(state);
			let from: number;
			if (0 !== vertical) {
				// A pixel of the row above: the one straight up, or the one up and to the right.
				from = dst + BYTES_PER_PIXEL * (place - width);
			} else {
				// A pixel of this row: the one to the left, or the one up and to the left.
				from = dst + BYTES_PER_PIXEL * (-width & -place) - BYTES_PER_PIXEL;
			}
			if (from >= 0) {
				pixels.copyWithin(dst, from, from + BYTES_PER_PIXEL);
			}
		}
		pixels[dst] = ((pixels[dst] ?? 0) + readFbDiff(state)) & 0xff;
		pixels[dst + 1] = ((pixels[dst + 1] ?? 0) + readFbDiff(state)) & 0xff;
		pixels[dst + 2] = ((pixels[dst + 2] ?? 0) + readFbDiff(state)) & 0xff;
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const akatomboFbImageDescriptor: FormatDescriptor = {
	id: "akatombo-fb-image",
	name: "Akatombo image format",
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
			source: "Legacy/Akatombo/ImageFB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const akatomboFbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: akatomboFbImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readFbLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readFbLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not an Akatombo picture");
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
							bitsPerPixel: BYTES_PER_PIXEL * 8,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BYTES_PER_PIXEL * 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readFbLayout(stored);
		if (!layout) {
			throw invalidPicture("Not an Akatombo picture");
		}
		const size = layout.width * layout.height * BYTES_PER_PIXEL;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Akatombo picture of ${size} bytes is too large`,
			);
		}
		// The rows of the picture stand the other way up, which is what the reference's flipped picture means.
		const pixels = unpackFb(stored, layout);
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
