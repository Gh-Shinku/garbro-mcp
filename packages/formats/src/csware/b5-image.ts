// Format reference: GARbro "ArcFormats/CsWare/ImageB5.cs", classes `B5Format`, `B5MetaData` and `B5Reader`
// (the sixteen bit CsWare picture format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { RGB555_MASKS, writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The three letters the reference signs this format with, `0x773562` read as bytes. */
const SIGNATURE = Buffer.from("b5w", "latin1");
const HEADER_SIZE = 8;
/** The depth the reference always reports, whatever the file says. */
const BITS_PER_PIXEL = 16;
/** The letter that says the colours stand in the order the picture holds them. */
const NO_SWAP_LETTER = 0x77;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface B5Layout {
	width: number;
	height: number;
	/** Whether the red and blue of every pixel are the other way round, which every letter but `w` says. */
	swapRgb: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `B5Format.ReadMetaData`: the three letters of the signature, a letter whose being `w` or not decides
 * whether the red and the blue of every pixel are the other way round, two bytes of nothing, and the
 * measurements. The depth is always reported as sixteen bits.
 */
export function readB5Layout(data: Buffer): B5Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(4);
	const height = data.readUInt16LE(6);
	if (0 === width || 0 === height) return undefined;
	return { width, height, swapRgb: NO_SWAP_LETTER !== data[2] };
}

/** How many bytes the pixels of a picture of these measurements take. */
export function b5PixelBytes(layout: B5Layout): number {
	return layout.width * layout.height * 2;
}

/**
 * `B5Reader.InitOffsetsTable`: the place a run of the stream copies its pixels from, taken from where the
 * pixel it stands at already is. The first eight places look behind the pixel itself, and the rest walk the
 * rows above it — the row above last, since the table is built from the eighth row up.
 */
export function b5Offsets(width: number): number[] {
	const offsets: number[] = [];
	for (let x = -1; x >= -8; x -= 1) {
		offsets.push(x);
	}
	let offset = -width;
	for (let y = 8; y > 0; y -= 1) {
		for (let x = 6; x >= -8; x -= 1) {
			offsets.push(offset + x);
		}
		offset -= width;
	}
	return offsets;
}

/**
 * `B5Reader.Unpack`: a stream of words, each of which is either a pixel or a run. A word whose highest bit
 * stands holds a pixel in the fifteen bits behind it, with the red and the blue the other way round when the
 * letter of the header says so — the reference turns the word about and leans on its reader ignoring the
 * highest bit to bring that about. A word whose highest bit is clear holds a run: the byte behind the bit is
 * how many pixels are repeated from the place the offsets table gives for the rest of the word, one pixel at
 * a time from a fixed distance behind, so that a run standing at the same place as the pixel behind it is a
 * fill and one standing from the row above copies that row. A run may reach past the end of its row into the
 * row below, which the reference allows as long as it stays inside the picture; one that reaches outside the
 * picture is refused, as is a stream that stops before its pixels are all there.
 */
export function unpackB5(data: Buffer, layout: B5Layout): Buffer {
	const count = layout.width * layout.height;
	const pixels = new Uint16Array(count);
	const offsets = b5Offsets(layout.width);
	let position = HEADER_SIZE;
	const readWord = (): number => {
		if (position + 2 > data.length) {
			throw invalidPicture("CsWare picture is cut short of its stream");
		}
		const value = data.readUInt16LE(position);
		position += 2;
		return value;
	};
	for (let y = 0; y < layout.height; y += 1) {
		// Every row begins where its own pixels begin, so a run that reached past its row is written over
		// by the row it reached into.
		let dst = y * layout.width;
		for (let w = layout.width; w > 0; ) {
			const word = readWord();
			if (0 !== (word & 0x8000)) {
				let value = word;
				if (layout.swapRgb) {
					// The reference turns the word about, which is the red and the blue changing places.
					value =
						(((value | 0xffe0) << 10) & 0xffff) |
						((value >> 10) & 0x1f) |
						(value & 0x3e0);
				} else {
					value &= 0x7fff;
				}
				if (dst >= count) {
					throw invalidPicture("CsWare picture writes past its own end");
				}
				pixels[dst] = value;
				dst += 1;
				w -= 1;
			} else {
				const length = word & 0xff;
				const source = offsets[word >> 8] ?? 0;
				w -= length;
				for (let index = 0; index < length; index += 1) {
					const from = dst + source;
					if (from < 0 || from >= count || dst >= count) {
						throw invalidPicture("CsWare picture writes past its own end");
					}
					pixels[dst] = pixels[from] ?? 0;
					dst += 1;
				}
			}
		}
	}
	const out: Buffer = Buffer.alloc(count * 2, 0x00);
	for (let index = 0; index < count; index += 1) {
		out.writeUInt16LE(pixels[index] ?? 0, index * 2);
	}
	return out;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cswareB5ImageDescriptor: FormatDescriptor = {
	id: "csware-b5-image",
	name: "CsWare image format",
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
			source: "ArcFormats/CsWare/ImageB5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cswareB5ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cswareB5ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readB5Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readB5Layout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a CsWare picture");
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
							bitsPerPixel: BITS_PER_PIXEL,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readB5Layout(stored);
		if (!layout) {
			throw invalidPicture("Not a CsWare picture");
		}
		const size = b5PixelBytes(layout);
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`CsWare picture of ${size} bytes is too large`,
			);
		}
		// The fifteen bit pixels are written out as a bitmap of that depth, whose colours stand as the
		// reference's reader takes them.
		const pixels = unpackB5(stored, layout);
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, false, RGB555_MASKS),
		]);
	},
});
