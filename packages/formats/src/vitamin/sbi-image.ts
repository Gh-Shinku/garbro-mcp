// Format reference: GARbro "ArcFormats/Vitamin/ImageSBI.cs", classes `SbiFormat`, `SbiMetaData` and
// `SbiReader` (a Vitamin picture whose rows stand bottom up and whose packed form walks run lengths of whole
// pixels). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'SBI\n', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("SBI\n", "latin1");
const HEADER_SIZE = 0x20;
const MARKER_FIELD = 4;
const DEPTH_FIELD = 6;
const WIDTH_FIELD = 7;
const HEIGHT_FIELD = 9;
const INPUT_SIZE_FIELD = 0xb;
/** The byte at 0x0F says whether an eight bit picture carries a colour map. */
const PALETTE_FIELD = 0xf;
const PACKED_FIELD = 0x10;
/** The colour map of an eight bit picture is two hundred and fifty six entries of three bytes. */
const PALETTE_SIZE = 0x100 * 3;
/** The run buffer the reference walks rows with. */
const RUN_BUFFER = 0x180;
/** The depths the reader knows. */
const DEPTHS = [8, 16, 24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface SbiLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the packed pixels end, counted from the start of the file. */
	inputSize: number;
	packed: boolean;
	hasPalette: boolean;
}

export interface SbiPicture {
	pixels: Buffer;
	palette?: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `SbiFormat.ReadMetaData`: the two bytes at four must be a one and nothing, the depth at six must be at
 * least eight, the measurements stand at seven and nine, the size of the packed input at eleven, the byte at
 * fifteen says whether an eight bit picture carries a colour map and the byte at sixteen whether the pixels
 * are packed at all.
 */
export function readSbiLayout(data: Buffer): SbiLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data[MARKER_FIELD] !== 1 || data[5] !== 0) return undefined;
	const bitsPerPixel = data[DEPTH_FIELD] ?? 0;
	if (bitsPerPixel < 8) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const stride = (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
	const size = stride * height;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		inputSize: data.readInt32LE(INPUT_SIZE_FIELD),
		packed: 0 !== data[PACKED_FIELD],
		hasPalette: 8 === bitsPerPixel && 0 === data[PALETTE_FIELD],
	};
}

/** `Stride`: a row is rounded up to four bytes. */
export function sbiStride(width: number, bitsPerPixel: number): number {
	return ((width * bitsPerPixel) / 8 + 3) & ~3;
}

/** `ImageFormat.ReadPalette` with `PaletteFormat.Rgb`: three byte entries of red, green and blue. */
function readSbiPalette(data: Buffer, offset: number): Buffer {
	const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		const at = offset + index * 3;
		entries[index * 4] = data[at + 2] ?? 0;
		entries[index * 4 + 1] = data[at + 1] ?? 0;
		entries[index * 4 + 2] = data[at] ?? 0;
	}
	return entries;
}

/**
 * `SbiReader.Unpack`: the pixels are read into a buffer whose rows stand bottom up, the first row of the
 * stream becoming the **last** row of the picture, which is how a bitmap of its own stores them. An unpacked
 * picture is a run of whole rows. A packed one walks run lengths: a control byte below `0x80` holds that many
 * pixels that stand in the stream themselves, and one at `0x80` or above holds that many less `0x80` pixels
 * of which the first stands in the stream and the rest repeat it. Every run is placed across the rows of the
 * picture, wrapping onto the row above when the current one is filled.
 */
export function unpackSbi(data: Buffer, layout: SbiLayout): SbiPicture {
	const depth = layout.bitsPerPixel / 8;
	const stride = sbiStride(layout.width, layout.bitsPerPixel);
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let position = HEADER_SIZE;
	let remaining = layout.inputSize - HEADER_SIZE;
	let palette: Buffer | undefined;
	if (layout.hasPalette) {
		if (position + PALETTE_SIZE > data.length) {
			throw invalidPicture("Vitamin picture is cut short of its colour map");
		}
		palette = readSbiPalette(data, position);
		position += PALETTE_SIZE;
		remaining -= PALETTE_SIZE;
	}
	const read = (length: number): Buffer => {
		if (position + length > data.length) {
			throw invalidPicture("Vitamin picture is cut short of its stream");
		}
		const chunk = data.subarray(position, position + length);
		position += length;
		return chunk;
	};
	if (!layout.packed) {
		for (let y = layout.height - 1; y >= 0; y -= 1) {
			read(stride).copy(output, stride * y);
		}
		return palette === undefined
			? { pixels: output }
			: { pixels: output, palette };
	}
	const buffer: Buffer = Buffer.alloc(RUN_BUFFER, 0x00);
	let x = 0;
	let y = layout.height - 1;
	let dst = stride * y;
	while (remaining > 0) {
		if (position >= data.length) {
			throw invalidPicture("Vitamin picture is cut short of its stream");
		}
		const control = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		let count: number;
		if (control < 0x80) {
			count = control;
			const chunk = read(count * depth);
			remaining -= chunk.length;
			chunk.copy(buffer, 0);
		} else {
			// A count of nothing still reads the pixel before it, as the reference does, and then has no
			// pixels to place.
			count = control & 0x7f;
			const chunk = read(depth);
			remaining -= depth;
			chunk.copy(buffer, 0);
			for (let index = 0; index < depth * (count - 1); index += 1) {
				buffer[depth + index] = buffer[index] ?? 0;
			}
		}
		let src = 0;
		while (count > 0) {
			let lineLeft = layout.width - x;
			if (count < lineLeft) {
				lineLeft = count;
				x += count;
			} else {
				x = 0;
			}
			const chunk = depth * lineLeft;
			if (y < 0 || dst < 0 || dst + chunk > output.length) {
				throw invalidPicture("Vitamin picture writes past its own end");
			}
			buffer.copy(output, dst, src, src + chunk);
			src += chunk;
			if (0 === x) {
				y -= 1;
				dst = stride * y;
			} else {
				dst += chunk;
			}
			count -= lineLeft;
		}
	}
	return palette === undefined
		? { pixels: output }
		: { pixels: output, palette };
}

/** The rows of the reference's own buffer, which are padded, taken out into the tight pixels a writer wants. */
function compactRows(
	pixels: Buffer,
	width: number,
	height: number,
	depth: number,
): Buffer {
	const source = sbiStride(width, depth * 8);
	const tight = Buffer.alloc(width * height * depth, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(
			tight,
			row * width * depth,
			row * source,
			row * source + width * depth,
		);
	}
	return tight;
}

async function readLayout(source: ByteSource): Promise<SbiLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readSbiLayout(header);
	} catch {
		return undefined;
	}
}

export const vitaminSbiImageDescriptor: FormatDescriptor = {
	id: "vitamin-sbi-image",
	name: "Vitamin image format",
	extensions: ["cmp"],
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
			source: "ArcFormats/Vitamin/ImageSBI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vitaminSbiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vitaminSbiImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const layout = await readLayout(source);
		// The reference's own reader throws for a depth it does not know, so such a file is not offered.
		return layout !== undefined && DEPTHS.includes(layout.bitsPerPixel);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Vitamin picture");
		}
		if (!DEPTHS.includes(layout.bitsPerPixel)) {
			throw invalidPicture(
				`Vitamin picture depth ${layout.bitsPerPixel} is not supported`,
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: layout.packed,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					packed: layout.packed,
					hasPalette: layout.hasPalette,
				},
			}),
			// The pixels are unfolded from a run length walk and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.packed ? "rle" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				packed: layout.packed,
				hasPalette: layout.hasPalette,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Vitamin picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const picture = unpackSbi(stored, layout);
		const depth = layout.bitsPerPixel / 8;
		const tight = compactRows(
			picture.pixels,
			layout.width,
			layout.height,
			depth,
		);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		switch (layout.bitsPerPixel) {
			case 8:
				if (picture.palette) {
					return Readable.from([
						writeBmp8Palette(
							layout.width,
							layout.height,
							tight,
							picture.palette,
						),
					]);
				}
				return Readable.from([writeBmp8(layout.width, layout.height, tight)]);
			case 16:
				return Readable.from([
					writeBmp16(layout.width, layout.height, tight, false, RGB565_MASKS),
				]);
			case 24:
				return Readable.from([writeBmp24(layout.width, layout.height, tight)]);
			default:
				return Readable.from([writeBmp32(layout.width, layout.height, tight)]);
		}
	},
});
