// Format reference: GARbro "ArcFormats/Favorite/ImageHZC.cs", classes `HzcFormat`, `HzcMetaData` and
// `HzcDecoder` (a zlib stream of raw pixels behind an `NVSG` head). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp24,
	writeBmp32,
	writeBmp8,
	writeBmp8Palette,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'hzc1', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("hzc1", "latin1");
/** The head the reference reads at once. */
const HEADER_SIZE = 0x2c;
const TAG_FIELD = 0x0c;
const TAG = Buffer.from("NVSG", "latin1");
const TYPE_FIELD = 0x12;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x16;
const OFFSET_X_FIELD = 0x18;
const OFFSET_Y_FIELD = 0x1a;
const UNPACKED_SIZE_FIELD = 4;
const HEADER_SIZE_FIELD = 8;
/** Where the compressed stream begins, past the twelve byte block the head size is measured from. */
const STREAM_BASE = 12;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** The two colours of the two bit palette the reference builds for the fourth kind. */
const MONOCHROME_PALETTE = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00,
]);

export interface HzcLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The kind of the picture, which decides its depth and its layout. */
	type: number;
	bitsPerPixel: number;
	/** The size of the unpacked picture the head declares, and how far the head itself reaches. */
	unpackedSize: number;
	headerSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `HzcFormat.ReadMetaData`: the head is tagged `NVSG` at `0x0C`, and its kind stands at `0x12`. The
 * measurements and the placement are the words behind it. The depth is twenty four bits for the first kind,
 * thirty two for the second and third, and eight for every kind above them; the size of the unpacked picture
 * and the reach of the head stand at four and eight.
 */
export function readHzcLayout(data: Buffer): HzcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!data.subarray(TAG_FIELD, TAG_FIELD + TAG.length).equals(TAG))
		return undefined;
	const type = data.readUInt16LE(TYPE_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const offsetX = data.readInt16LE(OFFSET_X_FIELD);
	const offsetY = data.readInt16LE(OFFSET_Y_FIELD);
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	const headerSize = data.readInt32LE(HEADER_SIZE_FIELD);
	const bitsPerPixel = 0 === type ? 24 : type > 2 ? 8 : 32;
	return {
		width,
		height,
		offsetX,
		offsetY,
		type,
		bitsPerPixel,
		unpackedSize,
		headerSize,
	};
}
/** `HzcDecoder`: the kind decides which pixels the reference hands out, and the fourth kind is monochrome. */
function decodePixels(
	layout: HzcLayout,
	pixels: Buffer,
): { pixels: Buffer; palette?: Buffer; bitsPerPixel: number } {
	switch (layout.type) {
		case 0:
			return { pixels, bitsPerPixel: 24 };
		case 1:
		case 2:
			return { pixels, bitsPerPixel: 32 };
		case 3:
			return { pixels, bitsPerPixel: 8 };
		case 4:
			return {
				pixels,
				palette: MONOCHROME_PALETTE,
				bitsPerPixel: 8,
			};
		default:
			throw invalidPicture(
				`Favorite View Point picture kind ${layout.type} is not supported`,
			);
	}
}

/** Writes the pixels out in the layout of the kind they belong to. */
function writePixels(
	layout: HzcLayout,
	pixels: Buffer,
	palette: Buffer | undefined,
): Buffer {
	if (layout.type === 4) {
		// The reference builds a two colour palette; the shared writer rounds it out to a full map.
		const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
		(palette ?? MONOCHROME_PALETTE).copy(entries, 0);
		return writeBmp8Palette(layout.width, layout.height, pixels, entries);
	}
	if (layout.type === 3) {
		// `PixelFormats.Gray8` is a ramp of greys, which the shared writer builds.
		return writeBmp8(layout.width, layout.height, pixels);
	}
	if (layout.bitsPerPixel === 24) {
		return writeBmp24(layout.width, layout.height, pixels);
	}
	return writeBmp32(layout.width, layout.height, pixels);
}

async function readLayout(source: ByteSource): Promise<HzcLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readHzcLayout(header);
	} catch {
		return undefined;
	}
}

export const favoriteHzcImageDescriptor: FormatDescriptor = {
	id: "favorite-hzc-image",
	name: "Favorite View Point image format",
	extensions: ["hzc"],
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
			source: "ArcFormats/Favorite/ImageHZC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const favoriteHzcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: favoriteHzcImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Favorite View Point picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(STREAM_BASE + layout.headerSize),
				size: source.size - BigInt(STREAM_BASE + layout.headerSize),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The pixels are unfolded from a compressed stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "zlib",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				kind: layout.type,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Favorite View Point picture");
		}
		const stride = (layout.width * layout.bitsPerPixel) / 8;
		const expected = stride * layout.height;
		if (!Number.isSafeInteger(expected) || expected < 0 || expected > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Favorite View Point picture of ${expected} bytes is too large`,
			);
		}
		const start = STREAM_BASE + layout.headerSize;
		if (start > source.size) {
			throw invalidPicture(
				"Favorite View Point picture stands past its own end",
			);
		}
		let pixels: Buffer;
		if (0 === expected) {
			pixels = Buffer.alloc(0);
		} else {
			const stored = Buffer.from(
				await source.readAt(BigInt(start), Number(source.size) - start),
			);
			try {
				pixels = await inflateZlibBuffer(stored, expected);
			} catch {
				throw invalidPicture(
					"Favorite View Point picture is cut short of its stream",
				);
			}
		}
		const decoded = decodePixels(layout, pixels);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writePixels(layout, decoded.pixels, decoded.palette),
		]);
	},
});
