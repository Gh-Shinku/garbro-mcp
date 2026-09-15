// Format reference: GARbro "Legacy/Rina/ImageRAD.cs", classes `RadFormat` and `RadMetaData` (Rina engine
// image format, used by Angel Gather). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `'RA0\0'`, the compressed picture, and `'RAD\0'`, the one that stands as it is. */
const COMPRESSED_SIGNATURE = 0x00304152;
const RAW_SIGNATURE = 0x00444152;
/** The pictures have one size, which the reference writes down without looking at the file. */
const WIDTH = 640;
const HEIGHT = 480;
const DEPTH = 24;
const PIXEL_SIZE = 3;
const ALPHA_SIZE = 4;
/** The signature stands in front of the picture. */
const DATA_OFFSET = 4;
const RGB_LENGTH = WIDTH * HEIGHT * PIXEL_SIZE;
const ALPHA_LENGTH = WIDTH * HEIGHT;

export interface RadLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** `'RA0'` pictures hold both their planes packed, `'RAD'` ones hold them as they are. */
	compressed: boolean;
}

/**
 * `RadFormat.ReadMetaData`: the reference tells the two kinds of picture apart by the third letter of the
 * signature and takes the measurements for granted — every picture of this engine is 640 by 480, twenty four
 * bits a pixel.
 */
export function readRadLayout(data: Buffer): RadLayout | undefined {
	if (data.length < DATA_OFFSET) return undefined;
	const signature = data.readUInt32LE(0);
	if (signature !== COMPRESSED_SIGNATURE && signature !== RAW_SIGNATURE)
		return undefined;
	return {
		width: WIDTH,
		height: HEIGHT,
		bitsPerPixel: DEPTH,
		compressed: COMPRESSED_SIGNATURE === signature,
	};
}

/**
 * `RadFormat.UnpackRgb`: three bytes at a time, and where those three bytes are all nothing, the byte behind
 * them says how many pixels of nothing follow, which is the count the reader skips forward by. The reference
 * reads into the picture itself, so a stream that stops in the middle of a triple leaves what it read there;
 * a stream that ends before the picture is full leaves the rest of the picture at nothing.
 */
export function unpackRadRgb(
	data: Buffer,
	position: number,
): { pixels: Buffer; position: number } {
	const pixels: Buffer = Buffer.alloc(RGB_LENGTH, 0x00);
	let dst = 0;
	let at = position;
	while (dst < RGB_LENGTH) {
		if (at + PIXEL_SIZE > data.length) {
			data.copy(pixels, dst, at, data.length);
			at = data.length;
			break;
		}
		const triple = data.subarray(at, at + PIXEL_SIZE);
		at += PIXEL_SIZE;
		triple.copy(pixels, dst);
		let count = 1;
		if (0 === (triple[0] ?? 0) + (triple[1] ?? 0) + (triple[2] ?? 0)) {
			if (at >= data.length) break;
			count = data[at] ?? 0;
			at += 1;
		}
		dst += count * PIXEL_SIZE;
	}
	return { pixels, position: at };
}

/**
 * `RadFormat.UnpackAlpha`: a byte and the number of pixels it covers, each count held to what is left of the
 * picture. A count of nothing carries the stream on to the next pair without covering anything, and the pair
 * a stream that ends in the middle of one gives up on is dropped.
 */
export function unpackRadAlpha(data: Buffer, position: number): Buffer {
	const alpha: Buffer = Buffer.alloc(ALPHA_LENGTH, 0x00);
	let dst = 0;
	let at = position;
	while (dst < ALPHA_LENGTH) {
		if (at >= data.length) break;
		const value = data[at] ?? 0;
		at += 1;
		if (at >= data.length) break;
		let count = data[at] ?? 0;
		at += 1;
		count = Math.min(count, ALPHA_LENGTH - dst);
		while (count-- > 0) {
			alpha[dst] = value;
			dst += 1;
		}
	}
	return alpha;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rinaRadImageDescriptor: FormatDescriptor = {
	id: "rina-rad-image",
	name: "Rina engine image format",
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
			source: "Legacy/Rina/ImageRAD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rinaRadImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rinaRadImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([0x52, 0x41, 0x30, 0x00]) },
			{ bytes: Buffer.from([0x52, 0x41, 0x44, 0x00]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(DATA_OFFSET)) return false;
		return readRadLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readRadLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Rina picture");
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
							width: WIDTH,
							height: HEIGHT,
							bitsPerPixel: DEPTH,
							compressed: layout.compressed,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: DEPTH,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readRadLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a Rina picture");
		}
		let pixels: Buffer;
		let position: number;
		if (layout.compressed) {
			const unfolded = unpackRadRgb(stored, DATA_OFFSET);
			pixels = unfolded.pixels;
			position = unfolded.position;
		} else {
			pixels = Buffer.alloc(RGB_LENGTH, 0x00);
			stored.copy(
				pixels,
				0,
				DATA_OFFSET,
				Math.min(stored.length, DATA_OFFSET + RGB_LENGTH),
			);
			position = Math.min(stored.length, DATA_OFFSET + RGB_LENGTH);
		}
		// The reference peeks at the byte behind the picture: where the file ends there, the picture has no
		// transparency at all, and otherwise the plane of transparency follows the one of colour.
		if (position >= stored.length) {
			// The rows of the reference's pictures are written the other way up.
			return Readable.from([writeBmp24(WIDTH, HEIGHT, pixels, true)]);
		}
		const alpha: Buffer = layout.compressed
			? unpackRadAlpha(stored, position)
			: alphaPlane(stored, position);
		const output: Buffer = Buffer.alloc(WIDTH * HEIGHT * ALPHA_SIZE, 0x00);
		let at = 0;
		for (let index = 0; index < output.length; index += ALPHA_SIZE) {
			output[index] = pixels[at] ?? 0;
			output[index + 1] = pixels[at + 1] ?? 0;
			output[index + 2] = pixels[at + 2] ?? 0;
			output[index + 3] = alpha[at / PIXEL_SIZE] ?? 0;
			at += PIXEL_SIZE;
		}
		return Readable.from([writeBmp32(WIDTH, HEIGHT, output, true)]);
	},
});

/** The plane of transparency of a picture that keeps it as it is, read into a buffer of its own. */
function alphaPlane(stored: Buffer, position: number): Buffer {
	const alpha: Buffer = Buffer.alloc(ALPHA_LENGTH, 0x00);
	stored.copy(
		alpha,
		0,
		position,
		Math.min(stored.length, position + ALPHA_LENGTH),
	);
	return alpha;
}
