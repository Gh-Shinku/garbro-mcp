// Format reference: GARbro "Legacy/HillField/ImageIMG.cs", class `ImgFormat` (an uncompressed twenty four
// bit BGR image). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const PIXEL_OFFSET = 8;
const BYTES_PER_PIXEL = 3;
/** The reference accepts the exact size or two bytes more, because the pixels start at offset eight. */
const TRAILING_SLACK = [0, 2];

interface ImgLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` gates on the extension, reads the dimensions and then accepts the file only when three
 * bytes per pixel account for the length, allowing two trailing bytes beyond the pixel data. The pixels
 * themselves start at offset eight, so the check is on the length rather than on an offset.
 */
async function readFields(source: ByteSource): Promise<ImgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(0);
		const height = header.readUInt32LE(4);
		// The reference would accept a zero sized image with an eight or ten byte file; nothing can be
		// drawn from one.
		if (width === 0 || height === 0) return undefined;
		const bitmapSize = width * height * BYTES_PER_PIXEL;
		const extra = Number(source.size) - PIXEL_OFFSET - bitmapSize;
		if (!TRAILING_SLACK.includes(extra)) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const hillFieldImgImageDescriptor: FormatDescriptor = {
	id: "hillfield-img-image",
	name: "Hill Field script system image format",
	extensions: ["img"],
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
			source: "Legacy/HillField/ImageIMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hillFieldImgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hillFieldImgImageDescriptor,
	// The reference declares no signature; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "img") return false;
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hill Field IMG image");
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
					bitsPerPixel: 24,
				} as Record<string, unknown>,
			}),
			// The pixels are copied from a fixed offset and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hill Field IMG image");
		const needed = layout.width * layout.height * BYTES_PER_PIXEL;
		const pixels = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), needed),
		);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
