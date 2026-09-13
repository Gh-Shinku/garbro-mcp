// Format reference: GARbro "ArcFormats/KScript/ImageKSL.cs", class `KslFormat` (an eight bit grey image whose
// pixels are masked with a key derived from two header bytes). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `KSLM`. */
const SIGNATURE = Buffer.from([0x4b, 0x53, 0x4c, 0x4d]);
const HEADER_SIZE = 0x14;
const KEY_OFFSET = 4;
const DATA_LENGTH_OFFSET = 8;
const WIDTH_OFFSET = 0x0c;
const HEIGHT_OFFSET = 0x10;
const PIXEL_OFFSET = 0x14;

interface KslLayout {
	width: number;
	height: number;
	/** `header[4] ^ header[5]`, taken from the stored bytes before any unmasking. */
	key: number;
	dataLength: number;
}

/**
 * `ReadMetaData` reads twenty bytes and takes everything from them without validating the payload: the key is
 * the exclusive or of two header bytes, the width and height are declared, and the data length is signed.
 */
async function readLayout(source: ByteSource): Promise<KslLayout | undefined> {
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
			key: (header[KEY_OFFSET] ?? 0) ^ (header[KEY_OFFSET + 1] ?? 0),
			dataLength: header.readInt32LE(DATA_LENGTH_OFFSET),
		};
	} catch {
		return undefined;
	}
}

export const kslImageDescriptor: FormatDescriptor = {
	id: "kscript-ksl-image",
	name: "KScript grayscale image format",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/KScript/ImageKSL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kslImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kslImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript KSL image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// The pixels are unmasked, and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				encrypted: true,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript KSL image");
		if (layout.dataLength < 0)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid KScript KSL data length",
			);
		// `ReadBytes` throws when the stream cannot supply the count, so a short payload fails here rather
		// than being padded, which is one of the few places this repository does not clamp.
		if (source.size < BigInt(PIXEL_OFFSET) + BigInt(layout.dataLength))
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KScript KSL payload");
		const stored = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), layout.dataLength),
		);
		const needed = layout.width * layout.height;
		// The reference hands the decoded buffer to `ImageData.Create` with the image's own stride, so a
		// payload shorter than the image cannot describe it and is rejected here.
		if (stored.length < needed)
			throw new GarbroError("INVALID_ARCHIVE", "Short KScript KSL payload");
		const pixels = Buffer.alloc(needed);
		for (let i = 0; i < needed; i += 1)
			pixels[i] = (stored[i] ?? 0) ^ layout.key;
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
