// Format reference: GARbro "ArcFormats/Risa/ImageSYG.cs", class `SygFormat` (Risa game platform image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `$SYG`, which the reference writes as the little endian word 0x47595324. */
const MARKER: Buffer = Buffer.from("$SYG", "latin1");
const HEADER_SIZE = 0x20;
/** The header's last word points at a block of transparency, or at nothing. */
const ALPHA_OFFSET_OFFSET = 0x1c;
/** Colours are stored one pixel after another with no row padding at all. */
const BYTES_PER_PIXEL = 3;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface SygLayout {
	width: number;
	height: number;
	alphaOffset: number;
	bitsPerPixel: number;
}

async function readLayout(source: ByteSource): Promise<SygLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		const alphaOffset = header.readUInt32LE(ALPHA_OFFSET_OFFSET);
		return {
			width: header.readUInt32LE(0x10),
			height: header.readUInt32LE(0x14),
			alphaOffset,
			// The header promises a fourth byte per pixel whenever it points anywhere at all.
			bitsPerPixel: alphaOffset === 0 ? 24 : 32,
		};
	} catch {
		return undefined;
	}
}

export const risaSygImageDescriptor: FormatDescriptor = {
	id: "risa-syg-image",
	name: "Risa game platform image",
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
			source: "ArcFormats/Risa/ImageSYG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const risaSygImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: risaSygImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Risa image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
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
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Risa image");
		const { width, height, alphaOffset } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Risa image size");
		}
		const pixelCount = width * height;
		if (pixelCount * 4 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Risa image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// A file that stops inside the colours still produces an image: the missing bytes stay black.
		const pixels: Buffer = Buffer.alloc(pixelCount * BYTES_PER_PIXEL, 0x00);
		const stored = Math.min(
			pixels.length,
			Math.max(0, file.length - HEADER_SIZE),
		);
		file.copy(pixels, 0, HEADER_SIZE, HEADER_SIZE + stored);
		if (alphaOffset !== 0) {
			const alpha = Buffer.alloc(pixelCount, 0x00);
			const alphaStart = HEADER_SIZE + alphaOffset;
			const alphaStored = Math.min(
				alpha.length,
				Math.max(0, file.length - alphaStart),
			);
			file.copy(alpha, 0, alphaStart, alphaStart + alphaStored);
			// The reference only uses the transparency when the whole block is there; a block that runs
			// past the end of the file leaves the image at three bytes per pixel.
			if (alphaStored === alpha.length) {
				const output: Buffer = Buffer.alloc(pixelCount * 4, 0x00);
				for (let index = 0; index < pixelCount; index += 1) {
					output[index * 4] = pixels[index * 3] ?? 0;
					output[index * 4 + 1] = pixels[index * 3 + 1] ?? 0;
					output[index * 4 + 2] = pixels[index * 3 + 2] ?? 0;
					output[index * 4 + 3] = alpha[index] ?? 0;
				}
				// The reference hands this image over as stored, so the bitmap is top down.
				return Readable.from([writeBmp32(width, height, output, false)]);
			}
		}
		return Readable.from([writeBmp24(width, height, pixels, false)]);
	},
});
