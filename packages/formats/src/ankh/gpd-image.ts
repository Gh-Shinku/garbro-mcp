// Format reference: GARbro "ArcFormats/Ankh/ImageGPD.cs", class `GpdFormat` (an LZSS compressed twenty four
// bit image whose stream starts either at offset twelve or at offset sixteen, depending on a field at offset
// twelve). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `gpd`. */
/** `gpd` and a null: the reference compares a whole little endian word, so the fourth byte counts. */
const SIGNATURE = Buffer.from([0x67, 0x70, 0x64, 0x00]);
const HEADER_SIZE = 0x10;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
const STREAM_FLAG_OFFSET = 0x0c;
/** The stream begins at the flag itself when it is set, and past it when it is clear. */
const SHORT_HEADER = 12;
const LONG_HEADER = 16;
const BYTES_PER_PIXEL = 3;

interface GpdLayout {
	width: number;
	height: number;
	streamOffset: number;
}

/**
 * `ReadMetaData` reads sixteen bytes and takes the width, the height and the stream offset from them. The
 * offset is twelve when the word at offset twelve is non-zero and sixteen when it is zero, which means a file
 * with the short header starts its compressed stream *inside* that word: its first control byte is the byte
 * that selects the layout in the first place. The MSK reader in this engine's directory has the same shape.
 */
async function readLayout(source: ByteSource): Promise<GpdLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return {
			width,
			height,
			streamOffset:
				header.readInt32LE(STREAM_FLAG_OFFSET) !== 0
					? SHORT_HEADER
					: LONG_HEADER,
		};
	} catch {
		return undefined;
	}
}

/**
 * The reference allocates the pixel buffer and reads as much of the decompressed stream as fits. A stream that
 * ends early therefore leaves the rest of the buffer zeroed rather than failing, which is the same behaviour
 * the MSK and GR1 readers document.
 */
async function readPixels(
	source: ByteSource,
	layout: GpdLayout,
): Promise<Buffer> {
	const needed = layout.width * layout.height * BYTES_PER_PIXEL;
	const stored = Buffer.from(
		await source.readAt(
			BigInt(layout.streamOffset),
			Number(source.size) - layout.streamOffset,
		),
	);
	const decoded = Buffer.from(
		inflateLzssAll(stored, { maxOutputLength: needed }),
	);
	const pixels = Buffer.alloc(needed);
	decoded.copy(pixels, 0, 0, Math.min(decoded.length, needed));
	return pixels;
}

export const ankhGpdImageDescriptor: FormatDescriptor = {
	id: "ankh-gpd-image",
	name: "Ankh image format",
	extensions: ["gpd"],
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
			source: "ArcFormats/Ankh/ImageGPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ankhGpdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ankhGpdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ankh GPD image");
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
					bitsPerPixel: 24,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
				streamOffset: layout.streamOffset,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ankh GPD image");
		const pixels = await readPixels(source, layout);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
