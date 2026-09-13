// Format reference: GARbro "Legacy/AnotherRoom/ImageGR1.cs", class `Gr1Format` (an LZSS compressed 16 bit
// 555 bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `LUVL`, which together with the marker below reads as `LUVLATIO` in the header. */
const SIGNATURE = Buffer.from([0x4c, 0x55, 0x56, 0x4c]);
const MARKER_OFFSET = 4;
const MARKER = Buffer.from("LATIO", "ascii");
const HEADER_SIZE = 0x24;
const WIDTH_OFFSET = 0x1c;
const HEIGHT_OFFSET = 0x20;
const BYTES_PER_PIXEL = 2;
/** The stream has no declared unpacked size, so decompression is bounded instead. */
const MAX_OUTPUT = 0x4000000;

interface Gr1Layout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads the header and checks the `LATIO` marker right after the signature; the dimensions
 * sit at the end of the header. Nothing else is validated.
 */
async function readLayout(source: ByteSource): Promise<Gr1Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (
			!header
				.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length)
				.equals(MARKER)
		)
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would decode a zero sized image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

/** Decodes the stream at 0x24 and expands it to the pixel buffer the reference allocates. */
async function readPixels(
	source: ByteSource,
	layout: Gr1Layout,
): Promise<Buffer | undefined> {
	try {
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		const decoded = Buffer.from(
			inflateLzssAll(stored, { maxOutputLength: MAX_OUTPUT }),
		);
		// The reference reads into a zero filled buffer, so a stream that ends early leaves zeros.
		const pixels = Buffer.alloc(layout.width * BYTES_PER_PIXEL * layout.height);
		decoded.copy(pixels, 0, 0, Math.min(decoded.length, pixels.length));
		return pixels;
	} catch {
		return undefined;
	}
}

export const gr1ImageDescriptor: FormatDescriptor = {
	id: "anotherroom-gr1-image",
	name: "AnotherRoom compressed bitmap",
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
			source: "Legacy/AnotherRoom/ImageGR1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gr1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gr1ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom GR1 image");
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
					// The source pixels are fifteen bit, which a bitmap records as sixteen.
					bitsPerPixel: 15,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the output.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom GR1 image");
		const pixels = await readPixels(source, layout);
		if (!pixels)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom GR1 image");
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, true),
		]);
	},
});
