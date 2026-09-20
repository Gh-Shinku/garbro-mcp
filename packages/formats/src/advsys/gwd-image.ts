// Format reference: GARbro "ArcFormats/AdvSys/ImageGWD.cs", classes `GwdFormat` and `GwdReader` (an AdvSys3
// engine picture: a head naming the places of a picture, then a walk of the places of a line at a time, the
// places of a line standing behind the place before them). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference registers no word at all; a picture is told by the word `GWD` at `0x04`. */
const FORMAT_WORD = "GWD";
const FORMAT_WORD_FIELD = 0x04;
const HEADER_SIZE = 0x0c;
/** How many bytes the places of the picture stand in, and where the head names the picture. */
const DATA_SIZE_FIELD = 0x00;
const WIDTH_FIELD = 0x07;
const HEIGHT_FIELD = 0x09;
const BITS_FIELD = 0x0b;
/** The walk of the places stands behind the head, and a byte behind the places names whether a shape of them
 * stands behind those. */
const PIXEL_OFFSET = HEADER_SIZE;
const SHAPE_FIELD = 0x04;
const SHAPE_STANDS = 1;
/** The places of a colour the reference knows, and how many places of a line a step of the walk names. */
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
const COLOUR_PLANES = 3;
/** The greatest run of places a step of the walk names, past which the reference would read no places. */
const MAXIMUM_COUNT_BITS = 31;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GwdLayout {
	/** How many bytes the places of the picture stand in, which names where a shape of those places begins. */
	dataSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

export interface GwdShapeLayout extends GwdLayout {
	/** Where the head of the shape stands. */
	offset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GwdFormat.ReadMetaData`: the word `GWD` stands at `0x04`, the width of the picture in the two words at
 * `0x07` standing the other way round from the rest of the file, its height in the words at `0x09` and the
 * places of a colour in the place at `0x0B`. The word at the front of the file names how many bytes the
 * places of the picture stand in.
 */
export function readGwdLayout(
	data: Buffer,
	fileLength = data.length,
): GwdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (
		data.toString("latin1", FORMAT_WORD_FIELD, FORMAT_WORD_FIELD + 3) !==
		FORMAT_WORD
	) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const dataSize = data.readUInt32LE(DATA_SIZE_FIELD);
	const width = data.readUInt16BE(WIDTH_FIELD);
	const height = data.readUInt16BE(HEIGHT_FIELD);
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (width <= 0 || height <= 0) return undefined;
	if (bitsPerPixel !== BITS_8 && bitsPerPixel !== BITS_24) return undefined;
	if (width * height > LIMIT) return undefined;
	return { dataSize, width, height, bitsPerPixel };
}

/**
 * `GwdFormat.Read`: where the places of a picture of twenty four bits stand, the place behind them names
 * whether the shape of those places stands behind it, and the shape stands as a picture of its own of eight
 * bits, as wide and as high as the picture whose places it stands beside.
 */
export function readGwdShapeLayout(
	data: Buffer,
	layout: GwdLayout,
	fileLength = data.length,
): GwdShapeLayout | undefined {
	if (BITS_24 !== layout.bitsPerPixel) return undefined;
	const at = SHAPE_FIELD + layout.dataSize;
	if (at >= fileLength || at >= data.length) return undefined;
	if (SHAPE_STANDS !== data[at]) return undefined;
	const offset = at + 1;
	if (offset + HEADER_SIZE > fileLength) return undefined;
	const shape = readGwdLayout(data.subarray(offset), fileLength - offset);
	if (!shape) return undefined;
	if (BITS_8 !== shape.bitsPerPixel) return undefined;
	if (shape.width !== layout.width || shape.height !== layout.height) {
		return undefined;
	}
	return { ...shape, offset };
}

/** `GwdReader.DeltaTable`: the place of a line stands behind the place before it, every place of the table
 * naming the place that stands over a place where the two before it are known. */
function buildDeltaTable(): Uint8Array {
	const table = new Uint8Array(0x100 * 0x100);
	for (let places = 0; places < 0x100; places += 1) {
		for (let before = 0; before < 0x100; before += 1) {
			let previous = before;
			if (before >= 0x80) previous = 0xff - before;
			let value: number;
			if (2 * previous < places) {
				value = places;
			} else if (0 !== (places & 1)) {
				value = previous + ((places + 1) >> 1);
			} else {
				value = previous - (places >> 1);
			}
			table[places * 0x100 + before] =
				(before >= 0x80 ? 0xff - value : value) & 0xff;
		}
	}
	return table;
}

const DELTA_TABLE = buildDeltaTable();

/** `GwdReader.GetCount`: the run of places a step of the walk names stands behind the run of places in front
 * of it that stand at nought. */
function readGwdCount(reader: MsbBitReader): number {
	let count = 1;
	while (0 === reader.readBits(1)) {
		count += 1;
		if (count > MAXIMUM_COUNT_BITS) {
			throw invalidPicture("GWD picture names a run that stands too far");
		}
	}
	return (reader.readBits(count) + (1 << count) - 2) & 0xffff;
}

/**
 * `GwdReader.FillLine`: a step of the walk names a run of places of a line and, where the places of a colour
 * that stand behind the step name any, as many places of a colour as those places name plus one. Every place
 * of a line then stands behind the place before it.
 */
export function fillGwdLine(
	reader: MsbBitReader,
	line: Buffer,
	width: number,
): void {
	let dst = 0;
	while (dst < width) {
		const length = reader.readBits(3);
		const count = readGwdCount(reader) + 1;
		if (0 !== length) {
			for (let at = 0; at < count; at += 1) {
				if (dst >= width) {
					throw invalidPicture("GWD picture walks beyond its own line");
				}
				line[dst] = reader.readBits(length + 1) & 0xff;
				dst += 1;
			}
		} else {
			if (dst + count > width) {
				throw invalidPicture("GWD picture walks beyond its own line");
			}
			line.fill(0x00, dst, dst + count);
			dst += count;
		}
	}
	for (let at = 1; at < width; at += 1) {
		line[at] = DELTA_TABLE[(line[at] ?? 0) * 0x100 + (line[at - 1] ?? 0)] ?? 0;
	}
}

/**
 * `GwdReader.Unpack`: a picture of eight places of a colour walks one line at a time, and a picture of twenty
 * four walks three lines at a time, one line each for the blue places of a colour, the green and the red. The
 * places of a picture stand as many places in a row as the picture is wide, without the places a bitmap stands
 * beyond the last place of a row.
 */
export function decodeGwd(
	data: Buffer,
	offset: number,
	layout: GwdLayout,
): Buffer {
	const reader = new MsbBitReader(data, offset + PIXEL_OFFSET);
	const stride = (layout.width * layout.bitsPerPixel) >> 3;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const line: Buffer = Buffer.alloc(layout.width, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		if (BITS_8 === layout.bitsPerPixel) {
			fillGwdLine(reader, line, layout.width);
			line.copy(pixels, row * stride);
			continue;
		}
		for (let colour = 0; colour < COLOUR_PLANES; colour += 1) {
			fillGwdLine(reader, line, layout.width);
			let at = row * stride + colour;
			for (let place = 0; place < layout.width; place += 1) {
				pixels[at] = line[place] ?? 0;
				at += COLOUR_PLANES;
			}
		}
	}
	return pixels;
}

/**
 * `GwdFormat.Read`: the places of the picture stand as a bitmap of eight or twenty four bits, and where the
 * shape of those places stands beside them, every place of the shape stands for the place of the colour of the
 * picture it stands before, standing the other way round from it.
 */
export function composeGwd(
	data: Buffer,
	layout: GwdLayout,
	shape: GwdShapeLayout | undefined,
): Buffer {
	const image = decodeGwd(data, 0, layout);
	if (!shape) {
		return BITS_8 === layout.bitsPerPixel
			? writeBmp8(layout.width, layout.height, image)
			: writeBmp24(layout.width, layout.height, image);
	}
	const alpha = decodeGwd(data, shape.offset, shape);
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let src = 0;
	let at = 0;
	for (let place = 0; place < layout.width * layout.height; place += 1) {
		pixels[at] = image[src] ?? 0;
		pixels[at + 1] = image[src + 1] ?? 0;
		pixels[at + 2] = image[src + 2] ?? 0;
		pixels[at + 3] = ~(alpha[place] ?? 0) & 0xff;
		src += COLOUR_PLANES;
		at += 4;
	}
	return writeBmp32(layout.width, layout.height, pixels);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const advSysGwdImageDescriptor: FormatDescriptor = {
	id: "advsys-gwd-image",
	name: "AdvSys3 engine image format",
	extensions: ["gwd"],
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
			source: "ArcFormats/AdvSys/ImageGWD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readGwd(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readGwdLayout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not a GWD picture");
	const shape = readGwdShapeLayout(stored, layout, Number(source.size));
	return { stored, layout, shape };
}

export const advSysGwdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advSysGwdImageDescriptor,
	// The reference registers no word at all, so a picture of this kind is tried after every kind that is told
	// by a word of its own.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readGwdLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const { layout, shape } = await readGwd(source);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: 0n,
			size: source.size,
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: shape ? BITS_32 : layout.bitsPerPixel,
				shape: shape !== undefined,
			},
		});
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				bitsPerPixel: shape ? BITS_32 : layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const { stored, layout, shape } = await readGwd(source);
		// The rows of the picture are padded to four bytes by the bitmap writer.
		return Readable.from([composeGwd(stored, layout, shape)]);
	},
});
