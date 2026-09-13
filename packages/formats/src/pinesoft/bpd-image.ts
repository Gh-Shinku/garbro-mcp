// Format reference: GARbro "Legacy/PineSoft/ImageBPD.cs", class `BpdFormat` (a standalone image
// resource: an eight byte header and raw top down BGRA pixels).
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

/** 'BPD' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x42, 0x50, 0x44, 0x00]);
const HEADER_SIZE = 8;
/** The dimensions are sixteen bit words here. */
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 6;
const BYTES_PER_PIXEL = 4;
const BITS_PER_PIXEL = 32;

interface BpdLayout {
	width: number;
	height: number;
	pixelOffset: number;
	pixelSize: number;
}

/** GARbro `BpdFormat.ReadMetaData`: the header only carries the dimensions. */
async function readLayout(source: ByteSource): Promise<BpdLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt16LE(WIDTH_OFFSET);
		const height = header.readUInt16LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const pixelSize = width * height * BYTES_PER_PIXEL;
		// The reference reads the pixels unchecked and fails on a short read.
		if (BigInt(HEADER_SIZE + pixelSize) > source.size) return undefined;
		return { width, height, pixelOffset: HEADER_SIZE, pixelSize };
	} catch {
		return undefined;
	}
}

/**
 * Wraps top down BGRA pixels in a 32 bit bitmap. A negative height records a top down image, which
 * keeps the stored byte order.
 */
function writeBitmap(width: number, height: number, pixels: Buffer): Buffer {
	const header = Buffer.alloc(54);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(header.length + pixels.length, 2);
	header.writeUInt32LE(header.length, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(-height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(BITS_PER_PIXEL, 28);
	header.writeUInt32LE(0, 30);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

export const bpdImageDescriptor: FormatDescriptor = {
	id: "pinesoft-bpd-image",
	name: "PineSoft image format",
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
			source: "Legacy/PineSoft/ImageBPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bpdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bpdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PineSoft BPD image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PineSoft BPD image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		return Readable.from([writeBitmap(layout.width, layout.height, pixels)]);
	},
});
