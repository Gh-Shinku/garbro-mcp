// Format reference: GARbro "ArcFormats/Qlie/ImageABMP.cs", classes `AbmpFormat` and `Abmp6MetaData`
// (QLIE engine image format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { readPngHeaderFields } from "../shared/png.js";

/** `ABMP`, and then the six bytes the reference checks for. */
const SIGNATURE: Buffer = Buffer.from("ABMP", "ascii");
const MAGIC = "ABMP6\0";
const HEADER_SIZE = 0x10;
/** The field at this offset counts from the end of the container header. */
const DATA_OFFSET_FIELD = 0x0c;
const CONTAINER_BASE = 0x10;
/** The words the payload may open with, and the two the reference reads as a bitmap. */
const PNG_SIGNATURE = 0x474e5089;
const JPEG_SIGNATURE = 0xe0ffd8ff;
const BMP_SIGNATURE = 0x4d42;
/** The length the payload declares for itself sits behind the word of a bitmap. */
const BMP_SIZE_FIELD = 2;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export type AbmpPayloadFormat = "png" | "jpeg" | "bmp";

export interface AbmpLayout {
	/** Where the payload starts, which is behind the word of its length. */
	offset: number;
	size: number;
	format: AbmpPayloadFormat;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `AbmpFormat.ReadMetaData`: a container that holds one picture in one of three formats. The word at the offset
 * the header names is the payload's own length — except for a bitmap, whose length is taken from the header of
 * the bitmap itself. What the payload says about itself is what the metadata reports, so a payload no reader of
 * its own would open is not one this format claims.
 */
export function readAbmpLayout(data: Buffer): AbmpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, MAGIC.length) !== MAGIC) return undefined;
	let offset = data.readUInt32LE(DATA_OFFSET_FIELD) + CONTAINER_BASE;
	if (offset + 8 > data.length) return undefined;
	let size = data.readUInt32LE(offset);
	const signature = data.readUInt32LE(offset + 4);
	let format: AbmpPayloadFormat;
	if (PNG_SIGNATURE === signature) {
		format = "png";
	} else if (JPEG_SIGNATURE === signature) {
		format = "jpeg";
	} else if (BMP_SIGNATURE === (signature & 0xffff)) {
		format = "bmp";
		// A bitmap carries the length of the whole of itself, where the container's word is behind it.
		size = data.readUInt32LE(offset + 4 + BMP_SIZE_FIELD);
	} else {
		return undefined;
	}
	offset += 4;
	if (size > MAXIMUM_PICTURE_BYTES) return undefined;
	// The reference's own region is shortened by the end of the file rather than refused.
	const payloadSize = Math.min(size, data.length - offset);
	const payload = data.subarray(offset, offset + payloadSize);
	const fields =
		"png" === format
			? readPngHeaderFields(payload)
			: "jpeg" === format
				? readJpegHeaderFields(payload)
				: readBmpHeaderFields(payload);
	if (!fields) return undefined;
	return { offset, size: payloadSize, format, ...fields };
}

export const qlieAbmpImageDescriptor: FormatDescriptor = {
	id: "qlie-abmp-image",
	name: "QLIE engine image",
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
			source: "ArcFormats/Qlie/ImageABMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const qlieAbmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qlieAbmpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readAbmpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAbmpLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a QLIE picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(
							fileName,
							"jpeg" === layout.format ? "jpg" : layout.format,
						),
						offset: BigInt(layout.offset),
						size: BigInt(layout.size),
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							payloadFormat: layout.format,
						},
					}),
					// A picture of twenty four bits is padded by its writer, and so is a bitmap rewritten here.
					sizeKnown: false,
				},
			],
			metadata: {
				image: "jpeg" === layout.format ? "jpg" : layout.format,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAbmpLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a QLIE picture");
		}
		const payload = Buffer.from(
			stored.subarray(layout.offset, layout.offset + layout.size),
		);
		if ("bmp" !== layout.format) {
			// The reference decodes these two through its own imaging layer; the port hands them over as they are.
			return Readable.from([payload]);
		}
		const image = readBmpImage(payload);
		if (!image) {
			throw new GarbroError("INVALID_ARCHIVE", "QLIE picture holds no bitmap");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
