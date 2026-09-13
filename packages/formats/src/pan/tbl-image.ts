// Format reference: GARbro "Legacy/Pan/ImageTBL.cs", class `TblFormat` (a standalone image resource:
// a twenty byte header and raw top down eight bit pixels, i.e. a bitmap mask).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'tbl' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x74, 0x62, 0x6c, 0x00]);
const HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 0xc;
const HEIGHT_OFFSET = 0x10;
const BITS_PER_PIXEL = 8;

interface TblLayout {
	width: number;
	height: number;
	/** Bitmap rows are padded to four byte boundaries. */
	stride: number;
	pixelOffset: number;
	pixelSize: number;
}

/** GARbro `TblFormat.ReadMetaData`: the header only carries the dimensions. */
async function readLayout(source: ByteSource): Promise<TblLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET) >>> 0;
		const height = header.readUInt32LE(HEIGHT_OFFSET) >>> 0;
		if (width === 0 || height === 0) return undefined;
		const pixelSize = width * height;
		const stride = (width + 3) & ~3;
		if (
			!Number.isSafeInteger(pixelSize) ||
			!Number.isSafeInteger(stride * height)
		)
			return undefined;
		// The reference reads the pixels unchecked and fails on a short read.
		if (BigInt(HEADER_SIZE + pixelSize) > source.size) return undefined;
		return {
			width,
			height,
			stride,
			pixelOffset: HEADER_SIZE,
			pixelSize,
		};
	} catch {
		return undefined;
	}
}

export const tblImageDescriptor: FormatDescriptor = {
	id: "pan-tbl-image",
	name: "Pan engine bitmap mask",
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
			source: "Legacy/Pan/ImageTBL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tblImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tblImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan engine TBL image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan engine TBL image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), layout.pixelSize),
		);
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
