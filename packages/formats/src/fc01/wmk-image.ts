// Format reference: GARbro "ArcFormats/FC01/ImageWMK.cs", class `WmkFormat` (a mask image with no
// signature: the file length is what identifies it). GARbro commit
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

const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 4;
/** The length check accounts for a header this long, while the pixels start eight bytes earlier. */
const LENGTH_BASE = 0x10;
const PIXEL_OFFSET = 8;
const BITS_PER_PIXEL = 8;

interface WmkLayout {
	width: number;
	height: number;
	pixelOffset: number;
	pixelSize: number;
}

/**
 * GARbro `WmkFormat.ReadMetaData`: no signature, the dimensions at the start and the file length
 * having to be exactly `width * height + 0x10`. The reference reads the pixels from offset 8, so the
 * eight bytes between the pixels and the end of the accounted region are not part of the image.
 */
async function readLayout(source: ByteSource): Promise<WmkLayout | undefined> {
	if (source.size <= BigInt(LENGTH_BASE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, PIXEL_OFFSET));
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// A zero sized mask would match any file of exactly 0x10 bytes, so it is declined (deviation).
		if (width === 0 || height === 0) return undefined;
		const pixelSize = BigInt(width) * BigInt(height);
		if (pixelSize + BigInt(LENGTH_BASE) !== source.size) return undefined;
		if (Number(pixelSize) > Number.MAX_SAFE_INTEGER) return undefined;
		return {
			width,
			height,
			pixelOffset: PIXEL_OFFSET,
			pixelSize: Number(pixelSize),
		};
	} catch {
		return undefined;
	}
}

export const wmkImageDescriptor: FormatDescriptor = {
	id: "fc01-wmk-image",
	name: "Cocktail Soft bitmap mask format",
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
			source: "ArcFormats/FC01/ImageWMK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wmkImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wmkImageDescriptor,
	// No signature: the length relation is the whole detection, as in the reference.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Cocktail Soft WMK mask",
			);
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
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Cocktail Soft WMK mask",
			);
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		// `ImageData.Create` reports `Gray8` top down, which is what the grayscale bitmap holds.
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
