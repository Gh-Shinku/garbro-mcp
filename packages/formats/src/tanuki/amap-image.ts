// Format reference: GARbro "ArcFormats/TanukiSoft/ImageAF.cs", class `AmapFormat` (TanukiSoft bitmap format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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

/** `AMAP`, the reference's little endian word 0x50414D41. */
const MARKER: Buffer = Buffer.from("AMAP", "latin1");
const HEADER_SIZE = 0x14;
/** The unpacked length sits at the end of the header and the stream follows it. */
const UNPACKED_SIZE_OFFSET = 0x10;
const DATA_OFFSET = 0x14;
/** Every TanukiSoft bitmap is a grey image. */
const BITS_PER_PIXEL = 8;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface AmapLayout {
	width: number;
	height: number;
	unpackedSize: number;
}

async function readLayout(source: ByteSource): Promise<AmapLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		const width = header.readUInt16LE(4);
		const height = header.readUInt16LE(6);
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_OFFSET);
		if (unpackedSize <= 0) return undefined;
		// The reference hands the unpacked buffer to the image layer, which needs a whole image; a length
		// that cannot hold one fails there and here.
		if (unpackedSize < width * height) return undefined;
		return { width, height, unpackedSize };
	} catch {
		return undefined;
	}
}

export const tanukiAmapImageDescriptor: FormatDescriptor = {
	id: "tanuki-amap-image",
	name: "TanukiSoft bitmap",
	extensions: ["af"],
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
			source: "ArcFormats/TanukiSoft/ImageAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tanukiAmapImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tanukiAmapImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TanukiSoft bitmap");
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
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TanukiSoft bitmap");
		const { width, height, unpackedSize } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid TanukiSoft bitmap size",
			);
		}
		if (unpackedSize > MAX_IMAGE_BYTES) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"TanukiSoft bitmap is too large",
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The stream is the library's default LzssStream, which the reader here calls its own copy of: a
		// frame of 0x1000 bytes, a window position starting at 0xFEE, and the offset in the pair of bytes'
		// high twelve bits.
		const decoded = inflateLzss(file.subarray(DATA_OFFSET), {
			outputLength: unpackedSize,
		});
		const pixels: Buffer = Buffer.alloc(width * height, 0x00);
		decoded.copy(pixels, 0, 0, Math.min(pixels.length, decoded.length));
		// The reference hands this image over as its stream reads, so the bitmap is top down.
		return Readable.from([writeBmp8(width, height, pixels, false)]);
	},
});
