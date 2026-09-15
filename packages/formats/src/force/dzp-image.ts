// Format reference: GARbro "Legacy/Force/ImageDZP.cs", class `DzpFormat` (Force image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/**
 * The reference registers this format under two words rather than one: the depth the picture opens with,
 * which is either of these two and nothing else.
 */
const SIGNATURE_24: Buffer = Buffer.from([24, 0, 0, 0]);
const SIGNATURE_8: Buffer = Buffer.from([8, 0, 0, 0]);
/** The reference reads this format only from a name of its own. */
const EXTENSION = "dzp";
const HEADER_SIZE = 0x0c;
const DEPTH_FIELD = 0;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
/** The width and the height are kept in blocks of four pixels, and a picture is no more than 4096 blocks. */
const BLOCK = 4;
const MAXIMUM_BLOCKS = 0x1000;
/** A picture of eight bits keeps a colour map of 256 colours, four bytes to a colour. */
const PALETTE_SIZE = 0x400;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface DzpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function hasExtension(sourcePath: string, extension: string): boolean {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	const dot = name.lastIndexOf(".");
	return dot >= 0 && name.slice(dot + 1).toLowerCase() === extension;
}

/**
 * `DzpFormat.ReadMetaData`: the depth of the picture, then its width and its height in blocks of four pixels
 * rather than in pixels. The reference reads this format from its name as well, and a picture of more than
 * 4096 blocks either way is not one it claims.
 */
export function readDzpLayout(data: Buffer): DzpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	if (8 !== bitsPerPixel && 24 !== bitsPerPixel) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || width > MAXIMUM_BLOCKS) return undefined;
	if (0 === height || height > MAXIMUM_BLOCKS) return undefined;
	return { width: width * BLOCK, height: height * BLOCK, bitsPerPixel };
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `DzpFormat.Unpack8BPP`: a byte and the count of times it is written. The reference stops at the end of the
 * stream and leaves the rest of the picture as it was, which is where the zeroes of a short stream come from;
 * a run that reaches past the picture throws there and is refused here.
 */
function unpack8Bpp(data: Buffer, offset: number, pixels: Buffer): void {
	let position = offset;
	let written = 0;
	while (written < pixels.length && position < data.length) {
		const value = data[position] ?? 0;
		const count = data[position + 1];
		position += 2;
		if (count === undefined) break;
		if (written + count > pixels.length) {
			throw invalidPicture("Force run reaches outside its picture");
		}
		for (let i = 0; i < count; i += 1) {
			pixels[written] = value;
			written += 1;
		}
	}
}

/**
 * `DzpFormat.Unpack24BPP`: three bytes are the pixel itself and the byte behind them is how many times its
 * three bytes are repeated — counted from the pixel just read, so the copy runs over itself. A count of
 * nothing is a pixel of its own with nothing behind it. A run that reaches past the picture is refused, where
 * the reference's own copy would throw.
 */
function unpack24Bpp(data: Buffer, offset: number, pixels: Buffer): void {
	let position = offset;
	let written = 0;
	while (written < pixels.length && position < data.length) {
		const got = Math.min(3, data.length - position);
		data.copy(pixels, written, position, position + got);
		position += got;
		if (got < 3) break;
		const byte = data[position];
		position += 1;
		if (byte === undefined) break;
		if (byte > 0) {
			const count = byte * 3;
			if (written + count > pixels.length) {
				throw invalidPicture("Force run reaches outside its picture");
			}
			if (!copyOverlapped(pixels, written, written + 3, count - 3)) {
				throw invalidPicture("Force run reaches outside its picture");
			}
			written += count;
		}
	}
}

export const forceDzpImageDescriptor: FormatDescriptor = {
	id: "force-dzp-image",
	name: "Force image",
	extensions: [EXTENSION],
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
			source: "Legacy/Force/ImageDZP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const forceDzpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: forceDzpImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE_24 }, { bytes: SIGNATURE_8 }],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath, EXTENSION)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readDzpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath, EXTENSION)) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Force picture");
		}
		const layout = readDzpLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Force picture");
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
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDzpLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Force picture");
		}
		const length = layout.width * layout.height * (layout.bitsPerPixel >> 3);
		if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Force picture of ${length} bytes is too large`,
			);
		}
		let palette: Buffer | undefined;
		let offset = HEADER_SIZE;
		if (8 === layout.bitsPerPixel) {
			if (stored.length < HEADER_SIZE + PALETTE_SIZE) {
				throw invalidPicture("Force picture carries no colour map");
			}
			palette = Buffer.from(
				stored.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_SIZE),
			);
			offset += PALETTE_SIZE;
		}
		const pixels: Buffer = Buffer.alloc(length, 0x00);
		if (8 === layout.bitsPerPixel) {
			unpack8Bpp(stored, offset, pixels);
		} else {
			unpack24Bpp(stored, offset, pixels);
		}
		// The pixels are kept one behind the other, with no padding between the rows of the picture.
		return Readable.from([
			palette
				? writeBmp8Palette(layout.width, layout.height, pixels, palette)
				: writeBmp24(layout.width, layout.height, pixels),
		]);
	},
});
