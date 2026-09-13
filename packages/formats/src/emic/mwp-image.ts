// Format reference: GARbro "ArcFormats/Emic/ImageMWP.cs", class `MwpFormat` (a headerless 32 bit bitmap
// that the engine also stores under a second signature). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `MWP\x10`. */
const SIGNATURE = Buffer.from([0x4d, 0x57, 0x50, 0x10]);
/** The engine also stores the same body under `TEYL`, which the reference registers as a second word. */
const ALT_SIGNATURE = Buffer.from([0x54, 0x45, 0x59, 0x4c]);
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
const PIXEL_OFFSET = 0x0c;
const BYTES_PER_PIXEL = 4;

interface MwpLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` seeks to offset four and reads the dimensions without checking anything else, so the port
 * derives the layout from the header alone and leaves the pixel count to extraction.
 */
async function readLayout(source: ByteSource): Promise<MwpLayout | undefined> {
	if (source.size < BigInt(PIXEL_OFFSET)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, PIXEL_OFFSET));
		const signature = head.subarray(0, 4);
		if (!signature.equals(SIGNATURE) && !signature.equals(ALT_SIGNATURE))
			return undefined;
		const width = head.readUInt32LE(WIDTH_OFFSET);
		const height = head.readUInt32LE(HEIGHT_OFFSET);
		// The reference would create an empty image here; nothing can be drawn from it.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const mwpImageDescriptor: FormatDescriptor = {
	id: "emic-mwp-image",
	name: "Emic engine bitmap",
	extensions: ["mwp", "bmp"],
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
			source: "ArcFormats/Emic/ImageMWP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mwpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mwpImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }, { bytes: ALT_SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Emic MWP image");
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
					bitsPerPixel: 32,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Emic MWP image");
		const needed = layout.width * layout.height * BYTES_PER_PIXEL;
		// The reference fills a buffer of exactly this size and throws when the file is shorter.
		if (source.size < BigInt(PIXEL_OFFSET + needed))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Emic MWP image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), needed),
		);
		// `ImageData.Create` with `Bgra32` stores rows top down and keeps the byte order.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
