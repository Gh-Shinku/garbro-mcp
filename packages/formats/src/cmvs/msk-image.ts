// Format reference: GARbro "ArcFormats/Cmvs/ImageMSK.cs", class `MskFormat` (a grayscale image: a
// sixteen byte header and one byte per pixel). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'MSK0' as stored; `0x304B534D` as a little endian word. */
const SIGNATURE = Buffer.from("MSK0", "ascii");
const HEADER_SIZE = 0x10;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0xc;
const BITS_PER_PIXEL = 8;

interface MskLayout {
	width: number;
	height: number;
	pixelOffset: number;
	pixelSize: number;
}

/** GARbro `MskFormat.ReadMetaData`: the header carries only the dimensions. */
async function readLayout(source: ByteSource): Promise<MskLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference reads the pixels unchecked and fails on a short read.
		if (width === 0 || height === 0) return undefined;
		const pixelSize = width * height;
		if (!Number.isSafeInteger(pixelSize)) return undefined;
		if (BigInt(HEADER_SIZE) + BigInt(pixelSize) > source.size) return undefined;
		return { width, height, pixelOffset: HEADER_SIZE, pixelSize };
	} catch {
		return undefined;
	}
}

export const mskImageDescriptor: FormatDescriptor = {
	id: "cmvs-msk-image",
	name: "Cvns engine grayscale image format",
	// The reference sets this in its constructor.
	extensions: ["msk"],
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
			source: "ArcFormats/Cmvs/ImageMSK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mskImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mskImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cvns MSK image");
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
			// A bitmap header and palette are prepended, so the payload is longer.
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cvns MSK image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		// `ImageData.Create` reports `Gray8` top down, which is what the grayscale bitmap holds.
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
