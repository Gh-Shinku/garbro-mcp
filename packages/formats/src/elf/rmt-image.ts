// Format reference: GARbro "ArcFormats/elf/ImageRMT.cs", class `RmtFormat` (an Ai5 engine image: LZSS over a
// delta coded bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `RMT `. */
const SIGNATURE = Buffer.from("RMT ", "ascii");
const HEADER_SIZE = 0x14;
const OFFSET_X = 4;
const OFFSET_Y = 8;
const WIDTH_OFFSET = 0x0c;
const HEIGHT_OFFSET = 0x10;
const PIXEL_OFFSET = 0x14;
const BYTES_PER_PIXEL = 4;

interface RmtLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

/**
 * `ReadMetaData` reads twenty bytes and takes the two position words and then the dimensions. The depth is
 * always thirty two and nothing else in the header is looked at.
 */
async function readLayout(source: ByteSource): Promise<RmtLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const offsetX = header.readInt32LE(OFFSET_X);
		const offsetY = header.readInt32LE(OFFSET_Y);
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height, offsetX, offsetY };
	} catch {
		return undefined;
	}
}

/**
 * The decompressed pixels are differences: every pixel holds what to add to the one before it, and every row
 * what to add to the row above. The reference adds, in place and byte by byte, the pixel four bytes earlier
 * for the first row, then the pixel a stride earlier for every other row. Both steps wrap at a byte, which is
 * what adding to a `byte` does in C#.
 */
function applyDelta(pixels: Buffer, stride: number): void {
	for (let i = BYTES_PER_PIXEL; i < stride; i += 1)
		pixels[i] = ((pixels[i] ?? 0) + (pixels[i - BYTES_PER_PIXEL] ?? 0)) & 0xff;
	for (let i = stride; i < pixels.length; i += 1)
		pixels[i] = ((pixels[i] ?? 0) + (pixels[i - stride] ?? 0)) & 0xff;
}

export const rmtImageDescriptor: FormatDescriptor = {
	id: "ai5-rmt-image",
	name: "Ai5 engine compressed image",
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
			source: "ArcFormats/elf/ImageRMT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rmtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rmtImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 RMT image");
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
					bitsPerPixel: 32,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				bitsPerPixel: 32,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ai5 RMT image");
		const stride = layout.width * BYTES_PER_PIXEL;
		const needed = stride * layout.height;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		// The reference reads through an LZSS stream into a buffer of exactly the pixel count, so it stops there
		// and does not check how much arrived: a stream that runs out leaves the remaining pixels zero, and
		// input past the last pixel is never read.
		const decoded = inflateLzss(stored, { outputLength: needed });
		const pixels: Buffer = Buffer.alloc(needed);
		decoded.copy(pixels, 0, 0, Math.min(decoded.length, needed));
		applyDelta(pixels, stride);
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
