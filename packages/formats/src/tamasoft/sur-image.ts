// Format reference: GARbro "ArcFormats/TamaSoft/ImageSUR.cs", class `SurFormat` (a thirty two bit BGRA image
// compressed with the engine's own LZSS variant). GARbro commit
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
import { unpackSurLzss } from "./sur-lzss.js";

/** `ESUR`. */
const SIGNATURE = Buffer.from([0x45, 0x53, 0x55, 0x52]);
const HEADER_SIZE = 0x10;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
/** Sixteen bytes between the header and the stream are never read. */
const PIXEL_OFFSET = 0x20;
const BYTES_PER_PIXEL = 4;

interface SurLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads sixteen bytes and takes the dimensions from the last eight of them; the first eight are
 * never used, and neither are the sixteen bytes between the header and the compressed stream.
 *
 * The `BTN` button image embeds a whole SUR file at a computed offset and rebases every read on it, so the
 * reader takes the offset the header sits at.
 */
export async function readSurLayout(
	source: ByteSource,
	baseOffset = 0,
): Promise<SurLayout | undefined> {
	if (source.size < BigInt(baseOffset + HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(
			await source.readAt(BigInt(baseOffset), HEADER_SIZE),
		);
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const surImageDescriptor: FormatDescriptor = {
	id: "tamasoft-sur-image",
	name: "TamaSoft ADV system image",
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
			source: "ArcFormats/TamaSoft/ImageSUR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const surImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: surImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSurLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readSurLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft SUR image");
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
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "sur-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readSurLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft SUR image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		const needed = layout.width * layout.height * BYTES_PER_PIXEL;
		let pixels: Buffer;
		try {
			pixels = unpackSurLzss(stored, needed);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated TamaSoft SUR image");
		}
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
