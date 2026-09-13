// Format reference: GARbro "ArcFormats/Seraphim/ImageCP3.cs", class `Cp3Format` (the single image view
// of a CP3X frame; `ArcCP3.cs` holds the multi-frame archive opener). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'CP3X' as stored. */
const SIGNATURE = Buffer.from("CP3X", "ascii");
/** The reference reads a 0x3C byte header and takes the dimensions from its tail. */
const HEADER_SIZE = 0x3c;
const WIDTH_OFFSET = 0x34;
const HEIGHT_OFFSET = 0x38;
const BYTES_PER_PIXEL = 4;
const BITS_PER_PIXEL = 32;

interface Cp3Layout {
	width: number;
	height: number;
	pixelOffset: number;
	pixelSize: number;
}

/**
 * GARbro `Cp3Format.ReadMetaData`: the dimensions live in the header of the **first frame**, which
 * starts at 0x2C, so width and height sit at 0x34 and 0x38 and the pixels follow at 0x3C.
 */
async function readLayout(source: ByteSource): Promise<Cp3Layout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const pixelSize = width * height * BYTES_PER_PIXEL;
		if (!Number.isSafeInteger(pixelSize)) return undefined;
		// The reference reads the pixels unchecked and fails on a short read.
		if (BigInt(HEADER_SIZE + pixelSize) > source.size) return undefined;
		return { width, height, pixelOffset: HEADER_SIZE, pixelSize };
	} catch {
		return undefined;
	}
}

export const cp3ImageDescriptor: FormatDescriptor = {
	id: "seraphim-cp3-image",
	name: "Seraphim engine multi-frame image",
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
			source: "ArcFormats/Seraphim/ImageCP3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cp3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cp3ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim CP3 image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim CP3 image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		// `ImageData.CreateFlipped` keeps the stored rows, so the bitmap is bottom up: the pixels are
		// copied verbatim and only the header sign differs from the top down ports.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
