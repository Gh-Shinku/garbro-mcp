// Format reference: GARbro "ArcFormats/Propeller/ImageMGR.cs", classes `MgrFormat` and `MgrMetaData`
// (Propeller image format). The decompressor it uses is the one of `ArcMGR.cs`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	writeBmp32,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { decompressMgrFrame } from "./mgr.js";

const MAXIMUM_FRAME_COUNT = 0x100;
/** How much of the picture the reference unfolds to read its header. */
const BMP_HEADER_SIZE = 0x36;
const SIZE_FIELDS = 8;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;
const DEPTH_32 = 32;
/** Where a bitmap keeps the offset of its pixels, which the reference reads off the unfolded picture. */
const DATA_OFFSET_FIELD = 0x0a;

export interface MgrImageLayout {
	/** Where the stream of the picture starts. */
	offset: number;
	packedSize: number;
	unpackedSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `MgrFormat.ReadMetaData`: how many pictures the file holds, a table of their offsets when it holds more
 * than one, and then the length the picture unfolds to and the length of the stream behind it. The reference
 * reads the header of the bitmap off the first fifty four bytes of the unfolded picture, so a picture whose
 * stream does not unfold to a bitmap header is not one this format claims.
 */
export function readMgrImageLayout(data: Buffer): MgrImageLayout | undefined {
	if (data.length < 2) return undefined;
	const count = data.readInt16LE(0);
	if (count <= 0 || count >= MAXIMUM_FRAME_COUNT) return undefined;
	let offset: number;
	if (count > 1) {
		if (data.length < 6) return undefined;
		offset = data.readInt32LE(2);
		// The first picture of a table of pictures follows the table itself.
		if (offset !== 2 + count * 4) return undefined;
	} else {
		offset = 2;
	}
	if (offset + SIZE_FIELDS > data.length) return undefined;
	const unpackedSize = data.readInt32LE(offset);
	const packedSize = data.readInt32LE(offset + 4);
	offset += SIZE_FIELDS;
	if (packedSize < 0 || offset + packedSize > data.length) return undefined;
	if (unpackedSize < BMP_HEADER_SIZE || unpackedSize > MAXIMUM_PICTURE_BYTES) {
		return undefined;
	}
	let header: Buffer;
	try {
		header = decompressMgrFrame(
			data.subarray(offset, offset + packedSize),
			BMP_HEADER_SIZE,
			true,
		);
	} catch {
		return undefined;
	}
	const fields = readBmpHeaderFields(header);
	if (!fields) return undefined;
	return { offset, packedSize, unpackedSize, ...fields };
}

export const propellerMgrImageDescriptor: FormatDescriptor = {
	id: "propeller-mgr-image",
	name: "Propeller image",
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
			source: "ArcFormats/Propeller/ImageMGR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const propellerMgrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: propellerMgrImageDescriptor,
	// The reference registers this format under no word at all, so every file is offered to it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 8n) return false;
		return readMgrImageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMgrImageLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Propeller picture");
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
							packedSize: layout.packedSize,
							unpackedSize: layout.unpackedSize,
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
		const layout = readMgrImageLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Propeller picture");
		}
		const packed = stored.subarray(
			layout.offset,
			layout.offset + layout.packedSize,
		);
		const picture = decompressMgrFrame(packed, layout.unpackedSize, true);
		if (DEPTH_32 !== layout.bitsPerPixel) {
			const image = readBmpImage(picture);
			if (!image) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Propeller picture holds no bitmap",
				);
			}
			return Readable.from([writeBmpImage(image)]);
		}
		// A picture of thirty two bits keeps its rows the other way up, and the reference turns them as it
		// copies them out of the bitmap the stream unfolded to.
		const stride = layout.width * 4;
		const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
		const start = picture.readInt32LE(DATA_OFFSET_FIELD);
		for (let row = 0; row < layout.height; row += 1) {
			const from = start + row * stride;
			const to = stride * (layout.height - 1 - row);
			picture.copy(pixels, to, from, from + stride);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
