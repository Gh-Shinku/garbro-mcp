// Format reference: GARbro "Legacy/Artel/ImageMRL.cs", classes `MrlFormat`, `MrlMetaData` and the three
// static walks `DecryptInput`, `MrlDecompress` and `RestoreOutput` (an Artel ADVG picture whose channels stand
// apart and whose stream is obfuscated, run length coded and then walked differentially). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'MuMR' plus the `L` behind it, the format signature as a little endian word. */
const SIGNATURE = Buffer.from("MuMR", "latin1");
const TAG_FIELD = 4;
const TAG = 0x4c;
const HEADER_SIZE = 0x18;
const FLAGS_FIELD = 8;
/** The flag that says an alpha channel is there. */
const ALPHA_FLAG = 8;
const DEPTH_FIELD = 0xc;
const WIDTH_FIELD = 0x10;
const HEIGHT_FIELD = 0x14;
/** The colour map of an eight bit picture stands behind the head. */
const PALETTE_SIZE = 0x100 * 4;
/** The key the stream is turned over with, and the depths the reader knows. */
const INPUT_KEY = 8;
const DEPTHS = [8, 24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface MrlLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	hasAlpha: boolean;
}

export interface MrlPicture {
	/** The pixels in the order a bitmap wants, with the rows bottom up. */
	pixels: Buffer;
	palette?: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MrlFormat.ReadMetaData`: the four bytes of the signature stand behind a `L`, the word at twelve is the
 * depth in bytes — which the reference turns into bits by multiplying by eight — and the flag at eight says
 * whether an alpha channel is there. A picture of twenty four bits with an alpha channel is reported as thirty
 * two, and the width and the height stand at sixteen and twenty.
 */
export function readMrlLayout(data: Buffer): MrlLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data[TAG_FIELD] !== TAG) return undefined;
	const bytesPerPixel = data.readUInt16LE(DEPTH_FIELD);
	let bitsPerPixel = bytesPerPixel * 8;
	const hasAlpha = 0 !== ((data[FLAGS_FIELD] ?? 0) & ALPHA_FLAG);
	if (24 === bitsPerPixel && hasAlpha) bitsPerPixel = 32;
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const size = width * height * (bitsPerPixel / 8);
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, bitsPerPixel, hasAlpha };
}

/** `DecryptInput`: every byte is turned over with a key that begins at eight and steps on by one. */
export function decryptMrl(data: Buffer, key = INPUT_KEY): Buffer {
	const output: Buffer = Buffer.alloc(data.length, 0x00);
	let current = key & 0xff;
	for (let index = 0; index < data.length; index += 1) {
		output[index] = (data[index] ?? 0) ^ current;
		current = (current + 1) & 0xff;
	}
	return output;
}

/**
 * `MrlDecompress`: a byte that is not nothing stands for itself; a byte of nothing stands for a run, whose
 * length is one plus the bytes behind it, of which every byte of all ones asks for one more to be added.
 */
export function mrlDecompress(input: Buffer, outputLength: number): Buffer {
	const output: Buffer = Buffer.alloc(Math.max(0, outputLength), 0x00);
	let src = 0;
	let dst = 0;
	while (src < input.length && dst < output.length) {
		let value = input[src] ?? 0;
		src += 1;
		if (value !== 0) {
			output[dst] = value;
			dst += 1;
		} else {
			let count = 1;
			do {
				if (src >= input.length) {
					throw invalidPicture("Artel picture is cut short of its stream");
				}
				value = input[src] ?? 0;
				src += 1;
				count += value;
			} while (0xff === value);
			dst += count;
		}
	}
	return output;
}

/**
 * `RestoreOutput`: the first byte stands as it is, and every byte behind it is the one before it turned over
 * with it — so the walk carries the last value it wrote.
 */
export function restoreMrl(pixels: Buffer): Buffer {
	if (pixels.length === 0) return pixels;
	let key = pixels[0] ?? 0;
	for (let index = 1; index < pixels.length; index += 1) {
		pixels[index] = (pixels[index] ?? 0) ^ key;
		key = pixels[index] ?? 0;
	}
	return pixels;
}

/**
 * `MrlFormat.Read`: a picture of eight bits carries a colour map of four byte entries behind its head, and its
 * bytes are turned over, unfolded and walked. A picture of twenty four or thirty two bits stands as one plane
 * a channel, which is read into the interleaved pixels a bitmap wants; a picture of eight bits with an alpha
 * channel would read its alpha channel from behind the end of the pixels it holds, which the reference's own
 * array read answers with an exception, so such a picture is refused here as well.
 */
export function unpackMrl(data: Buffer, layout: MrlLayout): MrlPicture {
	if (8 === layout.bitsPerPixel && layout.hasAlpha) {
		throw invalidPicture(
			"Artel picture asks for an alpha channel without a place to hold it",
		);
	}
	let position = HEADER_SIZE;
	let palette: Buffer | undefined;
	if (8 === layout.bitsPerPixel) {
		if (position + PALETTE_SIZE > data.length) {
			throw invalidPicture("Artel picture is cut short of its colour map");
		}
		palette = Buffer.from(data.subarray(position, position + PALETTE_SIZE));
		position += PALETTE_SIZE;
	}
	const depth = layout.bitsPerPixel / 8;
	const stride = layout.width * depth;
	const channelSize = layout.width * layout.height;
	const planes = mrlDecompress(
		decryptMrl(data.subarray(position)),
		stride * layout.height,
	);
	restoreMrl(planes);
	if (8 === layout.bitsPerPixel) {
		return palette === undefined
			? { pixels: planes }
			: { pixels: planes, palette };
	}
	const pixels: Buffer = Buffer.alloc(planes.length, 0x00);
	let src = 0;
	for (let channel = 0; channel < depth; channel += 1) {
		let dst = channel;
		for (let index = 0; index < channelSize; index += 1) {
			pixels[dst] = planes[src] ?? 0;
			src += 1;
			dst += depth;
		}
	}
	return { pixels };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<MrlLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readMrlLayout(header);
	} catch {
		return undefined;
	}
}

export const artelMrlImageDescriptor: FormatDescriptor = {
	id: "artel-mrl-image",
	name: "Artel ADVG engine image format",
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
			source: "Legacy/Artel/ImageMRL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const artelMrlImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: artelMrlImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const layout = await readLayout(source);
		// A picture of eight bits with an alpha channel has no place to hold it, as the reference's own read
		// finds out, so such a file is not offered.
		return (
			layout !== undefined && !(8 === layout.bitsPerPixel && layout.hasAlpha)
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an Artel picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				encrypted: true,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					hasAlpha: layout.hasAlpha,
				},
			}),
			// The channels are unfolded from an obfuscated stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "rle",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				hasAlpha: layout.hasAlpha,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an Artel picture");
		}
		const stored = await readStored(source);
		const picture = unpackMrl(stored, layout);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		if (8 === layout.bitsPerPixel) {
			if (!picture.palette) {
				throw invalidPicture("Artel picture is missing its colour map");
			}
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					picture.pixels,
					picture.palette,
					true,
				),
			]);
		}
		if (layout.hasAlpha) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, picture.pixels, true),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, picture.pixels, true),
		]);
	},
});
