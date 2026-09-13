// Format reference: GARbro "ArcFormats/Softpal/ImageBPIC.cs", class `BpicFormat` (a raw image whose colour
// channels are stored the other way round). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `BPIC`. */
const SIGNATURE = Buffer.from("BPIC", "ascii");
const HEADER_SIZE = 0x10;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
/** The stored bytes per pixel, which is also the value that decides the depth. */
const PIXEL_SIZE_OFFSET = 12;
const PIXEL_OFFSET = 0x10;
/** Only these three are accepted, and the depth is eight bits a byte. */
const PIXEL_SIZES = [1, 3, 4];

interface BpicLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadMetaData` reads sixteen bytes and accepts the file when the word at twelve is one, three or four; the
 * width and height sit just before it and the depth is eight bits to that byte.
 */
async function readLayout(source: ByteSource): Promise<BpicLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const pixelSize = header.readInt32LE(PIXEL_SIZE_OFFSET);
		if (!PIXEL_SIZES.includes(pixelSize)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height, bitsPerPixel: pixelSize * 8 };
	} catch {
		return undefined;
	}
}

/**
 * The colour channels are stored the other way round, so the third byte of every pixel is swapped with the
 * first. The reference walks the buffer from index two, stepping a whole pixel at a time, which for a
 * twenty four bit image visits 2, 5, 8 and so on — the third byte of each pixel — and for a thirty two bit one
 * visits 2, 6, 10, so the swap happens once per pixel either way. A single byte a pixel has nothing to swap.
 *
 * The swap is done in place on the extracted copy, so the caller's buffer is not shared.
 */
function swapChannels(pixels: Buffer, pixelSize: number): Buffer {
	if (pixelSize === 1) return pixels;
	for (let i = 2; i < pixels.length; i += pixelSize) {
		const t = pixels[i] ?? 0;
		pixels[i] = pixels[i - 2] ?? 0;
		pixels[i - 2] = t;
	}
	return pixels;
}

export const bpicImageDescriptor: FormatDescriptor = {
	id: "softpal-bpic-image",
	name: "Softpal engine image",
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
			source: "ArcFormats/Softpal/ImageBPIC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bpicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bpicImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Softpal BPIC image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the converted pixels.
			sizeKnown: false,
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Softpal BPIC image");
		const pixelSize = layout.bitsPerPixel / 8;
		const needed = layout.width * layout.height * pixelSize;
		// `Read` throws when it cannot fill the buffer, so a short file fails here rather than being padded.
		if (Number(source.size) < PIXEL_OFFSET + needed)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Softpal BPIC image");
		const stored = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), needed),
		);
		const pixels = swapChannels(stored, pixelSize);
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		if (layout.bitsPerPixel === 8)
			return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
		if (layout.bitsPerPixel === 24)
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
