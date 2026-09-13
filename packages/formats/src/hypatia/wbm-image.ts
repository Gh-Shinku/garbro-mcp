// Format reference: GARbro "ArcFormats/Hypatia/ImageWBM.cs", class `WbmFormat` (an eight bit image whose
// palette, when there is one, lives in a `data.act` file beside it). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `!WBM`. */
const SIGNATURE = Buffer.from([0x21, 0x57, 0x42, 0x4d]);
const HEADER_SIZE = 12;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 6;
const PIXEL_OFFSET = 12;
/** The companion palette file, read by the reference from the same virtual directory as the image. */
const PALETTE_FILE = "data.act";
/** `ReadPalette` with the default entry count and `PaletteFormat.Rgb`: three bytes an entry. */
const PALETTE_ENTRIES = 0x100;
const PALETTE_SOURCE_SIZE = PALETTE_ENTRIES * 3;
const PALETTE_SIZE = PALETTE_ENTRIES * 4;

interface WbmLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads twelve bytes and takes the dimensions from them without checking anything else: the
 * depth is always eight and the four bytes at offset eight are never read. The palette is resolved later, so
 * detection does not depend on the companion file existing.
 */
async function readLayout(source: ByteSource): Promise<WbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt16LE(WIDTH_OFFSET);
		const height = header.readUInt16LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

/**
 * The companion palette holds RGB triples, while a bitmap palette holds BGRX entries, so the channels are
 * swapped here — the same conversion the System98 `writeBmp4` path needs and for the same reason. A companion
 * that exists but is too short to hold 256 entries is treated as an error, which is where the reference throws.
 */
async function readPalette(
	sourcePath: string,
): Promise<Buffer | undefined | null> {
	const stored = await readCompanionFile(sourcePath, PALETTE_FILE);
	if (stored === undefined) return undefined;
	if (stored.length < PALETTE_SOURCE_SIZE) return null;
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < PALETTE_ENTRIES; i += 1) {
		palette[i * 4] = stored[i * 3 + 2] ?? 0;
		palette[i * 4 + 1] = stored[i * 3 + 1] ?? 0;
		palette[i * 4 + 2] = stored[i * 3] ?? 0;
		palette[i * 4 + 3] = 0;
	}
	return palette;
}

export const wbmImageDescriptor: FormatDescriptor = {
	id: "hypatia-wbm-image",
	name: "Hypatia bitmap format",
	extensions: ["wbm", "dat"],
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
			source: "ArcFormats/Hypatia/ImageWBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wbmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hypatia WBM image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const palette = await readPalette(sourcePath);
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
					bitsPerPixel: 8,
					palette: palette === undefined ? "grey" : PALETTE_FILE,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the copied pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				palette: palette === undefined ? "grey" : PALETTE_FILE,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hypatia WBM image");
		const needed = layout.width * layout.height;
		// `ReadBytes` throws when the stream cannot supply the count, so a short file fails here rather than
		// being padded.
		if (source.size < BigInt(PIXEL_OFFSET + needed))
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Hypatia WBM image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), needed),
		);
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height. The stored
		// rows are packed at the image width.
		const palette = await readPalette(sourcePath);
		if (palette === null)
			throw new GarbroError("INVALID_ARCHIVE", "Short Hypatia WBM palette");
		if (palette === undefined)
			return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette),
		]);
	},
});
