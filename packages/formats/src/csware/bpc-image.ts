// Format reference: GARbro "ArcFormats/CsWare/ImageBPC.cs", classes `BpcFormat` and `BpcReader` (a C's ware
// bitmap of one, eight or twenty four bits a pixel, whose pixels stand as they are or behind a walk of runs
// that stands behind the colour map, with one byte of a control of the walk's own in front of it). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp1, writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word the file begins with, which is also where its pixels stand. */
const SIGNATURE = Buffer.from([0x28, 0x00, 0x00, 0x00]);
const HEADER_SIZE = 0x10;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x08;
const DEPTH_FIELD = 0x0e;
/** The depths the reference reads. */
const DEPTHS = [1, 8, 24];
/** The byte that stands in front of a run of the walk. */
const ESCAPE = 0xf5;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface BpcLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the pixels stand, which is what the file begins with. */
	dataOffset: number;
	/** The size of a row of the picture: a byte for a picture of eight bits, eight pixels for one of
	 *  one, and three bytes for one of twenty four. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BpcFormat.ReadMetaData`: the file begins with the word `0x28`, which is also where its pixels stand, the
 * width and the height stand at four and eight as words, and the depth of a pixel at `0x0E` as a word of two
 * bytes. Only the depths of one, eight and twenty four bits are read, and a row of the picture stands a byte
 * wide for a picture of eight bits, eight pixels wide for one of one and three bytes wide for one of twenty
 * four — which is what the reference's own arithmetic gives, and only lines up with the size a bitmap lays
 * its rows out with where a row of one bit pixels is a whole number of bytes.
 */
export function readBpcLayout(
	data: Buffer,
	fileLength = data.length,
): BpcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readUInt16LE(DEPTH_FIELD);
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const stride = Math.floor((width * bitsPerPixel) / 8);
	const pixels = stride * height;
	if (pixels > LIMIT) return undefined;
	if (HEADER_SIZE >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		dataOffset: data.readUInt32LE(0),
		stride,
	};
}

/** The colour map of a picture of one or eight bits, spread over four byte entries as a bitmap wants it. */
export function readBpcPalette(stored: Buffer, layout: BpcLayout): Buffer {
	const entries = 1 << layout.bitsPerPixel;
	const size = Math.min(entries, 0x100) * 4;
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (layout.bitsPerPixel > 8) return palette;
	stored.copy(
		palette,
		0,
		layout.dataOffset,
		Math.min(layout.dataOffset + size, stored.length),
	);
	return palette;
}

/** A walk of runs, every one of them a byte that stands as it is or the control byte and a count. */
interface BpcWalk {
	/** The byte the walk stands in front of a run of. */
	control: number;
	/** The byte a run of the kind that carries a control of its own stands behind, where it carries one. */
	index: number;
}

/** The bytes of a plane of the picture, walked once. */
function walkPlane(
	input: Buffer,
	source: number,
	control: BpcWalk,
	output: Buffer,
	start: number,
	limit: number,
): number {
	let src = source;
	let dst = start;
	while (src < input.length) {
		if ((input[src] ?? 0) !== control.control) {
			if (dst >= limit) {
				throw invalidPicture("C's ware bitmap writes past its own pixels");
			}
			output[dst] = input[src] ?? 0;
			dst += 1;
			src += 1;
			continue;
		}
		if (ESCAPE !== control.control) {
			if (src === 0) {
				// The reference reaches one byte behind the run it is reading, which stands outside its
				// own array at the very beginning of a walk.
				throw invalidPicture("C's ware bitmap begins its walk with a run");
			}
			const count = input[src + 1] ?? 0;
			if (dst + count > limit) {
				throw invalidPicture("C's ware bitmap writes past its own pixels");
			}
			output.fill(input[src - 1] ?? 0, dst, dst + count);
			dst += count;
			src += 2;
			continue;
		}
		if ((input[src + 1] ?? 0) === control.index) {
			if (src === 0) {
				throw invalidPicture("C's ware bitmap begins its walk with a run");
			}
			const count = input[src + 2] ?? 0;
			if (dst + count > limit) {
				throw invalidPicture("C's ware bitmap writes past its own pixels");
			}
			output.fill(input[src - 1] ?? 0, dst, dst + count);
			dst += count;
			src += 3;
			continue;
		}
		// The escape stands as a byte of its own where the byte behind it is not the one its runs stand
		// behind.
		if (dst >= limit) {
			throw invalidPicture("C's ware bitmap writes past its own pixels");
		}
		output[dst] = input[src] ?? 0;
		dst += 1;
		src += 1;
	}
	return src;
}

/**
 * `BpcReader.Unpack`: a picture of one bit a pixel stands as it stands, a row of it a byte wide. A picture of
 * eight bits reads a word of its size, then the control byte of its walk and, where that control is the
 * escape `0xF5`, the byte its runs stand behind, and then the walk itself: a byte that is not the control
 * stands as it is, the control stands in front of a count whose runs are the byte before the control — less
 * the byte behind it where the control is the escape and the byte after it is the one the runs stand behind,
 * in which case the count stands one byte further on. A picture of twenty four bits stands in three planes of
 * its own, one for every byte of a pixel, every plane a walk behind the same kind of control and with a size
 * of its own. What a plane counts along its walk is the bytes it reads: one for a byte that stands, two for
 * the control and its count, and three for the escape, the byte its runs stand behind and the count.
 */
export function unpackBpc(stored: Buffer, layout: BpcLayout): Buffer {
	let position = layout.dataOffset;
	if (layout.bitsPerPixel <= 8) {
		position += (1 << layout.bitsPerPixel) * 4;
	}
	if (1 === layout.bitsPerPixel) {
		const size = layout.stride * layout.height;
		if (position + size > stored.length) {
			throw invalidPicture("C's ware bitmap is cut short of its pixels");
		}
		return Buffer.from(stored.subarray(position, position + size));
	}
	if (8 === layout.bitsPerPixel) {
		if (position + 4 > stored.length) {
			throw invalidPicture("C's ware bitmap is cut short of its walk");
		}
		const packed = stored.readInt32LE(position);
		position += 4;
		if (packed < 0 || position + 1 > stored.length) {
			throw invalidPicture("C's ware bitmap is cut short of its walk");
		}
		const control: BpcWalk = { control: stored[position] ?? 0, index: 0 };
		position += 1;
		if (ESCAPE === control.control) {
			control.index = stored[position] ?? 0;
			position += 1;
		}
		if (packed < 0 || position + packed > stored.length) {
			throw invalidPicture("C's ware bitmap is cut short of its walk");
		}
		const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
		walkPlane(
			stored.subarray(position, position + packed),
			0,
			control,
			output,
			0,
			output.length,
		);
		return output;
	}
	if (position + 12 + 6 > stored.length) {
		throw invalidPicture("C's ware bitmap is cut short of its walk");
	}
	const planeSizes = [
		stored.readInt32LE(position),
		stored.readInt32LE(position + 4),
		stored.readInt32LE(position + 8),
	];
	position += 12;
	const controls = Buffer.from(stored.subarray(position, position + 3));
	position += 3;
	const pixels = Buffer.from(stored.subarray(position, position + 3));
	position += 3;
	const total = planeSizes.reduce((sum, size) => sum + Math.max(0, size), 0);
	if (position + total > stored.length) {
		throw invalidPicture("C's ware bitmap is cut short of its walk");
	}
	const input = stored.subarray(position, position + total);
	const output: Buffer = Buffer.alloc(layout.height * layout.stride, 0x00);
	let source = 0;
	for (let plane = 0; plane < 3; plane += 1) {
		const size = Math.max(0, planeSizes[plane] ?? 0);
		const control: BpcWalk = {
			control: controls[plane] ?? 0,
			index: pixels[plane] ?? 0,
		};
		let walked = 0;
		let dst = plane;
		let src = source;
		// A run writes one byte of a pixel at a time and stops where the picture stops.
		const run = (value: number, count: number): void => {
			for (let index = 0; index < count; index += 1) {
				if (dst >= output.length) {
					throw invalidPicture("C's ware bitmap writes past its own pixels");
				}
				output[dst] = value;
				dst += 3;
			}
		};
		while (walked < size) {
			if (src >= input.length) {
				throw invalidPicture("C's ware bitmap is cut short of its walk");
			}
			if ((input[src] ?? 0) !== control.control) {
				if (dst >= output.length) {
					throw invalidPicture("C's ware bitmap writes past its own pixels");
				}
				output[dst] = input[src] ?? 0;
				dst += 3;
				src += 1;
				walked += 1;
				continue;
			}
			if (ESCAPE !== control.control) {
				if (src === 0) {
					throw invalidPicture("C's ware bitmap begins its walk with a run");
				}
				const count = input[src + 1] ?? 0;
				run(input[src - 1] ?? 0, count);
				src += 2;
				// The walk stands two bytes further on: the control and its count.
				walked += 2;
				continue;
			}
			if ((input[src + 1] ?? 0) === control.index) {
				if (src === 0) {
					throw invalidPicture("C's ware bitmap begins its walk with a run");
				}
				const count = input[src + 2] ?? 0;
				run(input[src - 1] ?? 0, count);
				src += 3;
				// The control, the byte its runs stand behind and the count.
				walked += 3;
				continue;
			}
			// The escape stands as a byte of its own where the byte behind it is not the one its runs
			// stand behind.
			if (dst >= output.length) {
				throw invalidPicture("C's ware bitmap writes past its own pixels");
			}
			output[dst] = input[src] ?? 0;
			dst += 3;
			src += 1;
			walked += 1;
		}
		source = src;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const csWareBpcImageDescriptor: FormatDescriptor = {
	id: "cs-ware-bpc-image",
	name: "C's ware bitmap format",
	extensions: ["bpc"],
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
			source: "ArcFormats/CsWare/ImageBPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const csWareBpcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: csWareBpcImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readBpcLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBpcLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a C's ware bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: layout.bitsPerPixel > 1,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: 1 === layout.bitsPerPixel ? "none" : "runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBpcLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a C's ware bitmap");
		}
		const pixels = unpackBpc(stored, layout);
		const { width, height, bitsPerPixel } = layout;
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (1 === bitsPerPixel) {
			return Readable.from([
				writeBmp1(width, height, pixels, readBpcPalette(stored, layout), true),
			]);
		}
		if (8 === bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(
					width,
					height,
					pixels,
					readBpcPalette(stored, layout),
					true,
				),
			]);
		}
		return Readable.from([writeBmp24(width, height, pixels, true)]);
	},
});
