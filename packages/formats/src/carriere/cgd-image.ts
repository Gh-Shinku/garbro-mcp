// Format reference: GARbro "ArcFormats/Carriere/ImageCGD.cs", class `CgdFormat` (a standalone image
// resource: a twenty byte header and raw top down BGRA pixels).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'cgd' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x63, 0x67, 0x64, 0x00]);
const HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 12;
const HEIGHT_OFFSET = 16;
/** The reference always reports four bytes per pixel. */
const BYTES_PER_PIXEL = 4;
const BITS_PER_PIXEL = 32;

interface CgdLayout {
	width: number;
	height: number;
	pixelOffset: number;
	pixelSize: number;
}

/** GARbro `CgdFormat.ReadMetaData`: the header only carries the dimensions. */
async function readLayout(source: ByteSource): Promise<CgdLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET) >>> 0;
		const height = header.readUInt32LE(HEIGHT_OFFSET) >>> 0;
		if (width === 0 || height === 0) return undefined;
		const pixelSize = width * height * BYTES_PER_PIXEL;
		// The reference simply reads that many bytes and fails on a short read.
		if (!Number.isSafeInteger(pixelSize)) return undefined;
		if (BigInt(HEADER_SIZE + pixelSize) > source.size) return undefined;
		return { width, height, pixelOffset: HEADER_SIZE, pixelSize };
	} catch {
		return undefined;
	}
}

/**
 * Wraps the pixels in a bitmap. The reference reports them with `ImageData.Create`, i.e. top down,
 * so the bitmap uses a negative height to keep the byte order untouched.
 */
function writeBitmap(layout: CgdLayout, pixels: Buffer): Buffer {
	const header = Buffer.alloc(54);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(header.length + pixels.length, 2);
	header.writeUInt32LE(header.length, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(layout.width, 18);
	header.writeInt32LE(-layout.height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(BITS_PER_PIXEL, 28);
	header.writeUInt32LE(0, 30);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

export const cgdImageDescriptor: FormatDescriptor = {
	id: "carriere-cgd-image",
	name: "Carriere image format",
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
			source: "ArcFormats/Carriere/ImageCGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cgdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cgdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Carriere CGD image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.pixelOffset),
				size: BigInt(layout.pixelSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			// A bitmap header is prepended, so the payload is longer than the stored pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Carriere CGD image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		return Readable.from([writeBitmap(layout, pixels)]);
	},
});
