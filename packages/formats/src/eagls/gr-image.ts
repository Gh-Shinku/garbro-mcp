// Format reference: GARbro "ArcFormats/Eagls/ImageGR.cs", classes `GrFormat` and `GrMetaData` (EAGLS
// system compressed bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll, inflateLzss } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, writeBmp32, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The word a bitmap opens with, which is what the reference looks for behind the unpacker. */
const BITMAP_PREFIX: Buffer = Buffer.from("BM", "latin1");
/** How much of the picture the reference unfolds to measure it, and where the measurements are. */
const META_SIZE = 0x26;
const FILE_SIZE_FIELD = 2;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const DEPTH_FIELD = 0x1c;
const IMAGE_SIZE_FIELD = 0x22;
/** Where the pixels of a bitmap start, which is what the reference keeps of its header. */
const PIXELS_OFFSET = 0x36;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface GrLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The length the bitmap declares for itself. */
	fileSize: number;
	/** The length of its pixels as the header names them, or as its measurements work out. */
	imageSize: number;
	/** How much the reference unfolds in all. */
	unpackedSize: number;
}

/**
 * The reference's `GrFormat.ReadMetaData`: the picture is a bitmap inside a run length stream, so its
 * measurements are whatever the first thirty eight bytes of the stream hold. A stream that stops first, or
 * one that unfolds to something other than a bitmap, is not one this format claims.
 */
export function readGrLayout(stored: Buffer): GrLayout | undefined {
	const header = inflateLzss(stored, { outputLength: META_SIZE });
	if (header.length !== META_SIZE) return undefined;
	if (!header.subarray(0, BITMAP_PREFIX.length).equals(BITMAP_PREFIX)) {
		return undefined;
	}
	const fileSize = header.readInt32LE(FILE_SIZE_FIELD);
	const width = header.readInt32LE(WIDTH_FIELD);
	const height = header.readInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = header.readInt16LE(DEPTH_FIELD);
	let imageSize = header.readInt32LE(IMAGE_SIZE_FIELD);
	if (0 === imageSize) imageSize = width * height * (bitsPerPixel >> 3);
	return {
		width,
		height,
		bitsPerPixel,
		fileSize,
		imageSize,
		// A picture of twenty four bits is unfolded as far as its header says, and every other one as far as
		// its pixels and the header behind them reach.
		unpackedSize: 24 === bitsPerPixel ? fileSize : imageSize + PIXELS_OFFSET,
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * The whole of the stream the picture is stored in. The reference unfolds it as it reads, a byte at a time,
 * so it never has to know how long the bitmap behind it is; unfolding it in one go needs a limit of its own.
 */
function inflateGr(stored: Buffer): Buffer {
	try {
		return inflateLzssAll(stored, {
			maxOutputLength: MAXIMUM_PICTURE_BYTES,
		});
	} catch (error) {
		if (error instanceof RangeError) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				"EAGLS picture unfolds to more than the limit",
			);
		}
		throw error;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const eaglsGrImageDescriptor: FormatDescriptor = {
	id: "eagls-gr-image",
	name: "EAGLS compressed bitmap",
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
			source: "ArcFormats/Eagls/ImageGR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eaglsGrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eaglsGrImageDescriptor,
	// The reference registers the format without a word of its own, so any file left over is offered to it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		return readGrLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGrLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an EAGLS picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported EAGLS picture size ${layout.width}x${layout.height}`,
			);
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
							fileSize: layout.fileSize,
							unpackedSize: layout.unpackedSize,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "eagls-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const stored = await readStored(source);
		const layout = readGrLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an EAGLS picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported EAGLS picture size ${layout.width}x${layout.height}`,
			);
		}
		if (
			!Number.isSafeInteger(layout.unpackedSize) ||
			layout.unpackedSize > MAXIMUM_PICTURE_BYTES
		) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`EAGLS picture of ${layout.unpackedSize} bytes is too large`,
			);
		}
		const data = inflateGr(stored);
		if (32 !== layout.bitsPerPixel) {
			// Every other depth is read out of the bitmap the stream unfolds to.
			const image = readBmpImage(data);
			if (!image) {
				throw invalidPicture("EAGLS picture holds no bitmap");
			}
			return Readable.from([writeBmpImage(image)]);
		}
		// A picture of thirty two bits is stored the way a bitmap stores its rows and handed out the other
		// way up, so the rows are read from the back. The reference leaves the fifty four bytes of the bitmap
		// header in front of its pixels, which puts the first rows of the picture off by that much; the port
		// skips them, which is what its own comment says it means to do.
		const stride = layout.width * 4;
		if (data.length < PIXELS_OFFSET + stride * layout.height) {
			throw invalidPicture("EAGLS picture unfolds short of its pixels");
		}
		const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			data.copy(
				pixels,
				(layout.height - 1 - row) * stride,
				PIXELS_OFFSET + row * stride,
				PIXELS_OFFSET + (row + 1) * stride,
			);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
