// Format reference: GARbro "ArcFormats/Leaf/ImageLFG.cs", classes `LfgFormat`, `LfgMetaData` and
// `LfgReader` (a Leaf picture: sixteen colours of four places apiece, a table that stands every pair of places
// of the picture in the order a bitmap holds it, and a walk of pairs of places whose runs lean on the places
// that stand before them). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'LEAFCODE', the word the reference registers. */
const SIGNATURE = Buffer.from("LEAFCODE", "latin1");
const HEADER_SIZE = 0x30;
/** The places of the picture and the byte that says which way its places are written. */
const OFFSET_X_FIELD = 0x20;
const OFFSET_Y_FIELD = 0x22;
const RIGHT_FIELD = 0x24;
const BOTTOM_FIELD = 0x26;
const MODE_FIELD = 0x28;
const KEY_COLOR_FIELD = 0x29;
const IMAGE_SIZE_FIELD = 0x2c;
/** The colours of the picture: sixteen of them, three parts apiece, every part of four places standing in the
 * places of the bytes behind the word. */
const PALETTE_FIELD = 0x08;
const PALETTE_COLORS = 16;
const PALETTE_BYTES = PALETTE_COLORS * 3;
/** Where the walk of the picture begins and how wide its frame is. */
const WALK_FIELD = 0x30;
const FRAME_SIZE = 0x1000;
const FRAME_INIT = 0xfee;
/** The two ways the places of the picture are written: along a row, or down a column. */
const ROW_MODE = 1;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `LfgReader.ColorMap`: what a pair of places of the walk stands for. */
const COLOR_MAP = new Uint8Array([
	0x00, 0x01, 0x10, 0x11, 0x02, 0x03, 0x12, 0x13, 0x20, 0x21, 0x30, 0x31, 0x22,
	0x23, 0x32, 0x33, 0x04, 0x05, 0x14, 0x15, 0x06, 0x07, 0x16, 0x17, 0x24, 0x25,
	0x34, 0x35, 0x26, 0x27, 0x36, 0x37, 0x40, 0x41, 0x50, 0x51, 0x42, 0x43, 0x52,
	0x53, 0x60, 0x61, 0x70, 0x71, 0x62, 0x63, 0x72, 0x73, 0x44, 0x45, 0x54, 0x55,
	0x46, 0x47, 0x56, 0x57, 0x64, 0x65, 0x74, 0x75, 0x66, 0x67, 0x76, 0x77, 0x08,
	0x09, 0x18, 0x19, 0x0a, 0x0b, 0x1a, 0x1b, 0x28, 0x29, 0x38, 0x39, 0x2a, 0x2b,
	0x3a, 0x3b, 0x0c, 0x0d, 0x1c, 0x1d, 0x0e, 0x0f, 0x1e, 0x1f, 0x2c, 0x2d, 0x3c,
	0x3d, 0x2e, 0x2f, 0x3e, 0x3f, 0x48, 0x49, 0x58, 0x59, 0x4a, 0x4b, 0x5a, 0x5b,
	0x68, 0x69, 0x78, 0x79, 0x6a, 0x6b, 0x7a, 0x7b, 0x4c, 0x4d, 0x5c, 0x5d, 0x4e,
	0x4f, 0x5e, 0x5f, 0x6c, 0x6d, 0x7c, 0x7d, 0x6e, 0x6f, 0x7e, 0x7f, 0x80, 0x81,
	0x90, 0x91, 0x82, 0x83, 0x92, 0x93, 0xa0, 0xa1, 0xb0, 0xb1, 0xa2, 0xa3, 0xb2,
	0xb3, 0x84, 0x85, 0x94, 0x95, 0x86, 0x87, 0x96, 0x97, 0xa4, 0xa5, 0xb4, 0xb5,
	0xa6, 0xa7, 0xb6, 0xb7, 0xc0, 0xc1, 0xd0, 0xd1, 0xc2, 0xc3, 0xd2, 0xd3, 0xe0,
	0xe1, 0xf0, 0xf1, 0xe2, 0xe3, 0xf2, 0xf3, 0xc4, 0xc5, 0xd4, 0xd5, 0xc6, 0xc7,
	0xd6, 0xd7, 0xe4, 0xe5, 0xf4, 0xf5, 0xe6, 0xe7, 0xf6, 0xf7, 0x88, 0x89, 0x98,
	0x99, 0x8a, 0x8b, 0x9a, 0x9b, 0xa8, 0xa9, 0xb8, 0xb9, 0xaa, 0xab, 0xba, 0xbb,
	0x8c, 0x8d, 0x9c, 0x9d, 0x8e, 0x8f, 0x9e, 0x9f, 0xac, 0xad, 0xbc, 0xbd, 0xae,
	0xaf, 0xbe, 0xbf, 0xc8, 0xc9, 0xd8, 0xd9, 0xca, 0xcb, 0xda, 0xdb, 0xe8, 0xe9,
	0xf8, 0xf9, 0xea, 0xeb, 0xfa, 0xfb, 0xcc, 0xcd, 0xdc, 0xdd, 0xce, 0xcf, 0xde,
	0xdf, 0xec, 0xed, 0xfc, 0xfd, 0xee, 0xef, 0xfe, 0xff,
]);

export interface LfgLayout {
	/** The places of the picture, in eight places of a byte. */
	width: number;
	height: number;
	/** How many bytes stand in a row of the picture. */
	stride: number;
	/** How many bytes the walk of the picture gives. */
	imageSize: number;
	/** Which way the places of the picture are written. */
	mode: number;
	/** The colour the picture stands for as its shape. */
	keyColor: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `LfgFormat.ReadMetaData`: the word `LEAFCODE` stands at the beginning of the file, the places of the picture
 * stand at four words behind it — how far its left and its top edge stand from nought and how far its right and
 * its bottom edge do, the width of the picture standing in eight places of a byte — and the byte behind those
 * says which way the places are written, the byte behind that the colour that stands for the shape of the
 * picture and the word behind those how many bytes its walk gives.
 */
export function readLfgLayout(
	data: Buffer,
	fileLength = data.length,
): LfgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	const left = data.readInt16LE(OFFSET_X_FIELD);
	const top = data.readInt16LE(OFFSET_Y_FIELD);
	const right = data.readInt16LE(RIGHT_FIELD);
	const bottom = data.readInt16LE(BOTTOM_FIELD);
	const width = (right - left + 1) * 8;
	const height = bottom - top + 1;
	if (width <= 0 || height <= 0) return undefined;
	if (width * height > LIMIT) return undefined;
	const imageSize = data.readInt32LE(IMAGE_SIZE_FIELD);
	if (imageSize <= 0 || imageSize > LIMIT) return undefined;
	return {
		width,
		height,
		stride: width >> 1,
		imageSize,
		mode: data[MODE_FIELD] ?? 0,
		keyColor: data[KEY_COLOR_FIELD] ?? 0,
	};
}

/**
 * `LfgReader.ReadPalette`: the colours of the picture stand in the twenty four bytes behind the word of the
 * file, every byte of them standing for two parts of a colour of four places, the higher four places of the
 * byte first; every part of four places stands for thirty four places of a colour of eight bits, and the red,
 * the green and the blue of a colour stand one behind the other.
 */
export function readLfgPalette(data: Buffer): Buffer {
	const parts = Buffer.alloc(PALETTE_COLORS * 3, 0x00);
	for (let at = 0; at < PALETTE_BYTES; at += 1) {
		const byte = data[PALETTE_FIELD + (at >> 1)] ?? 0;
		const value = 0 === (at & 1) ? byte >> 4 : byte & 0x0f;
		parts[at] = (value * 0x11) & 0xff;
	}
	return parts;
}

/**
 * `LfgReader.Unpack`: the walk of the picture takes pairs of places at a time. A step whose place of the byte
 * at hand stands takes a byte of the walk, which the table of the picture stands for a pair of places; any
 * other step takes two bytes, whose four lowest places are how many pairs stand there, less three, and whose
 * twelve places above them name where in the frame the pairs stand — the frame being walked round as it is
 * written. The places of the picture stand along the rows of a picture of the first way and down its columns of
 * the second.
 */
export function unpackLfg(data: Buffer, layout: LfgLayout): Buffer {
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	const output: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	let framePos = FRAME_INIT;
	let dst = 0;
	let x = 0;
	let y = 0;
	let cursor = WALK_FIELD;
	const next = (): void => {
		if (ROW_MODE === layout.mode) {
			dst += 1;
			x += 1;
			if (x >= layout.stride) {
				x = 0;
				y += 1;
				dst = y * layout.stride;
			}
		} else {
			dst += layout.stride;
			y += 1;
			if (y >= layout.height) {
				y = 0;
				x += 1;
				dst = x;
			}
		}
	};
	const write = (color: number): void => {
		if (dst >= output.length) {
			throw invalidPicture("Leaf picture walks beyond its own places");
		}
		frame[framePos & (FRAME_SIZE - 1)] = color;
		framePos += 1;
		output[dst] = color;
		next();
	};
	let count = 0;
	let control = 0;
	let mask = 0;
	while (count < layout.imageSize) {
		mask >>= 1;
		if (0 === mask) {
			if (cursor >= data.length) {
				throw invalidPicture("Leaf picture is cut short of its walk");
			}
			control = data[cursor] ?? 0;
			cursor += 1;
			mask = 0x80;
		}
		if (0 !== (control & mask)) {
			if (cursor >= data.length) {
				throw invalidPicture("Leaf picture is cut short of its walk");
			}
			write(COLOR_MAP[data[cursor] ?? 0] ?? 0);
			cursor += 1;
			count += 1;
		} else {
			if (cursor + 2 > data.length) {
				throw invalidPicture("Leaf picture is cut short of its walk");
			}
			const word = (data[cursor] ?? 0) | ((data[cursor + 1] ?? 0) << 8);
			cursor += 2;
			let length = (word & 0x0f) + 3;
			let offset = word >> 4;
			while (length > 0 && count < layout.imageSize) {
				write(frame[offset & (FRAME_SIZE - 1)] ?? 0);
				offset += 1;
				count += 1;
				length -= 1;
			}
		}
	}
	return output;
}

/** The rows of the picture gathered into the rows a bitmap holds, every row of it padded to four bytes. */
function packLfgRows(pixels: Buffer, layout: LfgLayout): Buffer {
	const stride = (layout.stride + 3) & ~3;
	if (stride === layout.stride) return pixels;
	const packed: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		pixels.copy(
			packed,
			row * stride,
			row * layout.stride,
			row * layout.stride + layout.stride,
		);
	}
	return packed;
}

/** The picture of a sound, gathered into a bitmap of four bits with the colours of its head. */
export function decodeLfg(data: Buffer, layout: LfgLayout): Buffer {
	const pixels = packLfgRows(unpackLfg(data, layout), layout);
	return writeBmp4(layout.width, layout.height, pixels, readLfgPalette(data));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const leafLfgImageDescriptor: FormatDescriptor = {
	id: "leaf-lfg-image",
	name: "Leaf image format",
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
			source: "ArcFormats/Leaf/ImageLFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafLfgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafLfgImageDescriptor,
	// The reference registers the word `LEAFCODE` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readLfgLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLfgLayout(await readStored(source), Number(source.size));
		if (!layout) throw invalidPicture("Not a Leaf picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(WALK_FIELD),
				size: source.size - BigInt(WALK_FIELD),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
					keyColor: layout.keyColor,
				},
			}),
			// The walk of pairs of places is gathered into a bitmap of four bits.
		};
		return { entries: [entry], metadata: { image: "bmp", bitsPerPixel: 4 } };
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readLfgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Leaf picture");
		return Readable.from([decodeLfg(stored, layout)]);
	},
});
