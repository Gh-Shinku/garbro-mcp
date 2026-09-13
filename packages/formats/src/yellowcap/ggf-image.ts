// Format reference: GARbro "Legacy/YellowCap/ImageGGF.cs", class `GgfFormat` (a bare BMP behind eight
// bytes that repeat its dimensions). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The embedded bitmap starts here, with its own `BM` signature. */
const BMP_OFFSET = 8;
const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 4;
/** Fields of the embedded bitmap header. */
const BMP_SIZE_OFFSET = BMP_OFFSET + 2;
const BMP_INFO_SIZE_OFFSET = BMP_OFFSET + 14;
const BMP_WIDTH_OFFSET = BMP_OFFSET + 18;
const BMP_HEIGHT_OFFSET = BMP_OFFSET + 22;
const BMP_BPP_OFFSET = BMP_OFFSET + 28;
/** A `BITMAPFILEHEADER` plus a `BITMAPINFOHEADER`; OS/2 core headers are not accepted. */
const BMP_HEADER_SIZE = 54;
const BITMAPINFOHEADER_SIZE = 40;

interface GgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * GARbro `GgfFormat.ReadMetaData` reads ten bytes, requires `BM` at offset 8, then reads the bitmap
 * metadata from there and checks that its dimensions agree with the copies in the eight byte header.
 * A bitmap height is signed — a negative value means top down — so GARbro compares the absolute value.
 */
async function readLayout(source: ByteSource): Promise<GgfLayout | undefined> {
	// Ten bytes would let the `BM` check run, but the bitmap header itself needs fifty four.
	if (source.size < BigInt(BMP_OFFSET + BMP_HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(
			await source.readAt(0n, BMP_OFFSET + BMP_HEADER_SIZE),
		);
		if (header.toString("latin1", BMP_OFFSET, BMP_OFFSET + 2) !== "BM")
			return undefined;
		const declaredWidth = header.readUInt32LE(WIDTH_OFFSET);
		const declaredHeight = header.readUInt32LE(HEIGHT_OFFSET);
		const dataSize = Number(source.size) - BMP_OFFSET;
		const bmpSize = header.readUInt32LE(BMP_SIZE_OFFSET);
		if (
			bmpSize < BMP_HEADER_SIZE ||
			BigInt(bmpSize) > source.size - BigInt(BMP_OFFSET)
		)
			return undefined;
		if (header.readUInt32LE(BMP_INFO_SIZE_OFFSET) < BITMAPINFOHEADER_SIZE)
			return undefined;
		const width = header.readInt32LE(BMP_WIDTH_OFFSET);
		const signedHeight = header.readInt32LE(BMP_HEIGHT_OFFSET);
		if (width <= 0 || signedHeight === 0) return undefined;
		const height = Math.abs(signedHeight);
		// The header's copies have to agree with the bitmap's own dimensions.
		if (declaredWidth !== width >>> 0) return undefined;
		if (declaredHeight !== height >>> 0) return undefined;
		const bitsPerPixel = header.readUInt16LE(BMP_BPP_OFFSET);
		if (bitsPerPixel === 0) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			dataOffset: BMP_OFFSET,
			dataSize,
		};
	} catch {
		return undefined;
	}
}

export const ggfImageDescriptor: FormatDescriptor = {
	id: "yellowcap-ggf-image",
	name: "BMP-embedded image format",
	extensions: ["ggf"],
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
			source: "Legacy/YellowCap/ImageGGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ggfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ggfImageDescriptor,
	// The reference declares no signature; `detect` checks the embedded `BM` marker.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YellowCap GGF image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The embedded stream is the bitmap itself, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YellowCap GGF image");
		// Everything from offset 8 to the end of the file is the bitmap, so a copy is enough.
		const bitmap = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		return Readable.from([bitmap]);
	},
});
