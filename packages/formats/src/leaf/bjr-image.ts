// Format reference: GARbro "ArcFormats/Leaf/ImageBJR.cs", classes `BjrFormat` and `BjrMetaData`
// (Leaf obfuscated bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, encodeCp932 } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** A bitmap header, and the word a bitmap opens with. */
const HEADER_SIZE = 0x36;
const MAGIC: Buffer = Buffer.from("BM", "latin1");
/** The reference reads this format only from a name of its own. */
const EXTENSION = "bjr";
const SIZE_FIELD = 2;
const DATA_OFFSET_FIELD = 0x0a;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const DEPTH_FIELD = 0x1c;
/** The depths the reference writes back, and the ramp of greys it falls back to for anything else. */
const DEPTH_24 = 24;
const DEPTH_32 = 32;

export interface BjrLayout {
	width: number;
	height: number;
	/** The height as the header holds it, whose sign says which way up the stored rows are. */
	flipped: boolean;
	bitsPerPixel: number;
	imageOffset: number;
	imageLength: number;
}

function hasExtension(sourcePath: string, extension: string): boolean {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	const dot = name.lastIndexOf(".");
	return dot >= 0 && name.slice(dot + 1).toLowerCase() === extension;
}

/**
 * `BjrFormat.ReadMetaData`: the header is the header of a bitmap, and the reference reads only its first six
 * and thirty bytes. A positive height means the stored rows are the right way up for a bitmap, which is the
 * way up a bitmap keeps them; a negative one means they are not.
 */
export function readBjrLayout(data: Buffer): BjrLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
	const rows = data.readInt32LE(HEIGHT_FIELD);
	if (rows === 0) return undefined;
	return {
		width: data.readUInt32LE(WIDTH_FIELD),
		height: Math.abs(rows),
		flipped: rows > 0,
		bitsPerPixel: data.readUInt16LE(DEPTH_FIELD),
		imageOffset: data.readUInt32LE(DATA_OFFSET_FIELD),
		imageLength: data.readUInt32LE(SIZE_FIELD),
	};
}

/**
 * `BjrFormat.Read`: every byte of the picture is turned by a key made of the letters of the file's own name,
 * which makes this an obfuscation rather than a compression: the rows are all there, only shuffled and turned.
 * The name is read as its own bytes, so a name outside ascii turns the picture differently — which is what the
 * reference does — and the row each row of the output comes from is counted with the growing key.
 */
function unobfuscate(
	source: Buffer,
	name: string,
	height: number,
	stride: number,
): Buffer {
	const nameBytes = encodeCp932(name);
	let lineKey = 0;
	let evenKey = 0xff;
	let oddKey = 0;
	for (const byte of nameBytes) {
		lineKey ^= byte;
		evenKey = (evenKey + byte) & 0xff;
		oddKey = (oddKey - byte) & 0xff;
	}
	const pixels: Buffer = Buffer.alloc(source.length, 0x00);
	let destination = 0;
	for (let y = 0; y < height; y += 1) {
		lineKey += 7;
		const row = (lineKey % height) * stride;
		for (let x = 0; x < stride; x += 1) {
			const value = source[row + x];
			if (value === undefined) break;
			pixels[destination + x] =
				(x & 1) === 0 ? (evenKey - value) & 0xff : (oddKey + value) & 0xff;
		}
		destination += stride;
	}
	return pixels;
}

export const leafBjrImageDescriptor: FormatDescriptor = {
	id: "leaf-bjr-image",
	name: "Leaf obfuscated bitmap",
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
			source: "ArcFormats/Leaf/ImageBJR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const leafBjrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafBjrImageDescriptor,
	detection: { signatures: [{ bytes: MAGIC }], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath, EXTENSION)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readBjrLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath, EXTENSION)) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Leaf bitmap");
		}
		const layout = readBjrLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Leaf bitmap");
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
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							flipped: layout.flipped,
							imageOffset: layout.imageOffset,
							imageLength: layout.imageLength,
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
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readBjrLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Leaf bitmap");
		}
		if (layout.width <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Leaf bitmap size ${layout.width}x${layout.height}`,
			);
		}
		const stride = (layout.width * (layout.bitsPerPixel >> 3) + 3) & ~3;
		const length = stride * layout.height;
		if (layout.bitsPerPixel < 8 || layout.bitsPerPixel % 8 !== 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Leaf bitmap depth ${layout.bitsPerPixel}`,
			);
		}
		if (layout.imageOffset + length > stored.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Leaf bitmap is cut short of its pixels",
			);
		}
		const pixels = unobfuscate(
			stored.subarray(layout.imageOffset, layout.imageOffset + length),
			sourcePath.replace(/^.*[/\\]/, ""),
			layout.height,
			stride,
		);
		if (DEPTH_24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, layout.flipped),
			]);
		}
		if (DEPTH_32 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, layout.flipped),
			]);
		}
		// Any other depth is handed the ramp of greys, which is what the reference falls back to.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, layout.flipped),
		]);
	},
});
