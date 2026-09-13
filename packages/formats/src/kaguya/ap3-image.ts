// Format reference: GARbro "ArcFormats/Kaguya/ImageAP.cs", class `Ap3Format` (KaGuYa image, three depths).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { AP_MAX_DIMENSION } from "./ap-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'AP-3'`. */
const SIGNATURE = Buffer.from([0x41, 0x50, 0x2d, 0x33]);
/** The header the metadata read covers, depth included — the field AP-2 walks past. */
const HEADER_SIZE = 0x18;
const OFFSET_X_POSITION = 4;
const OFFSET_Y_POSITION = 8;
const WIDTH_POSITION = 0x0c;
const HEIGHT_POSITION = 0x10;
const DEPTH_POSITION = 0x14;
const DATA_OFFSET = HEADER_SIZE;
/** The three depths this format accepts; eight is grayscale with no palette in the file. */
const DEPTHS = [8, 24, 32];
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface Ap3Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
}

/**
 * The same layout as AP-2 with the depth field filled in at 0x14, so the four bytes its sibling ignores are
 * read here and decide how the pixels are laid out. The dimensions are checked before the depth, and the depth
 * has to be one of eight, twenty four or thirty two.
 */
async function readFields(source: ByteSource): Promise<Ap3Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const width = head.readUInt32LE(WIDTH_POSITION);
		const height = head.readUInt32LE(HEIGHT_POSITION);
		if (width > AP_MAX_DIMENSION || height > AP_MAX_DIMENSION) return undefined;
		const bitsPerPixel = head.readInt32LE(DEPTH_POSITION);
		if (!DEPTHS.includes(bitsPerPixel)) return undefined;
		if ((width * height * bitsPerPixel) / 8 > MAX_PIXEL_BYTES) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			offsetX: head.readInt32LE(OFFSET_X_POSITION),
			offsetY: head.readInt32LE(OFFSET_Y_POSITION),
		};
	} catch {
		return undefined;
	}
}

export const ap3ImageDescriptor: FormatDescriptor = {
	id: "kaguya-ap3-image",
	name: "KaGuYa script engine image",
	extensions: ["alp"],
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
			source: "ArcFormats/Kaguya/ImageAP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ap3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ap3ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-3 image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-3 image");
		const byteCount = (layout.width * layout.height * layout.bitsPerPixel) / 8;
		let pixels: Buffer;
		try {
			pixels = Buffer.from(await source.readAt(BigInt(DATA_OFFSET), byteCount));
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-3 image");
		}
		// The whole buffer has to arrive, as in the other formats of this family, so a short stream fails
		// rather than being zero-filled.
		if (pixels.length !== byteCount)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-3 image");
		// `CreateFlipped` with a stride of exactly one row: the rows are stored top down and the bitmap
		// records that as a positive height, so nothing is reversed in any of the three depths.
		const { width, height } = layout;
		if (layout.bitsPerPixel === 8) {
			// Eight bit is `Gray8`, with no palette in the file at all.
			return Readable.from([writeBmp8(width, height, pixels, true)]);
		}
		if (layout.bitsPerPixel === 24) {
			return Readable.from([writeBmp24(width, height, pixels, true)]);
		}
		return Readable.from([writeBmp32(width, height, pixels, true)]);
	},
});
