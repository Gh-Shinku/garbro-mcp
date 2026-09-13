// Format reference: GARbro "Legacy/Desire/ImageDES.cs", class `DesFormat` (a 4 bit indexed bitmap using the
// shared bit-packed decoder from Legacy/System98/ImageG.cs). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { GraBaseReader, horizontalGeometry } from "../system98/gra-reader.js";

const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 2;
const PALETTE_OFFSET = 4;
const COLORS = 16;
const PALETTE_BYTES = COLORS * 3;
const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_BYTES;
const MAX_WIDTH = 640;
const MAX_HEIGHT = 400;

interface DesLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads the dimensions before anything else and applies the same screen bounds and multiple
 * of eight rule as the System98 reader. It does not look at the palette or the stream, so a file with a
 * valid header and nothing else still lists.
 */
async function readLayout(source: ByteSource): Promise<DesLayout | undefined> {
	if (source.size < BigInt(PALETTE_OFFSET)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, PALETTE_OFFSET));
		const width = header.readUInt16BE(WIDTH_OFFSET);
		const height = header.readUInt16BE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		if ((width & 7) !== 0) return undefined;
		if (width > MAX_WIDTH || height > MAX_HEIGHT) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const desImageDescriptor: FormatDescriptor = {
	id: "desire-des-image",
	name: "Des98 engine image format",
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
			source: "Legacy/Desire/ImageDES.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const desImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: desImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Desire DES image");
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
					bitsPerPixel: 4,
				} as Record<string, unknown>,
			}),
			// The stored pixels are packed four bits to a byte and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
				colors: COLORS,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Desire DES image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// Unlike the System98 format there is no minimum length here, so a file with only a header lists and
		// then fails on the missing colours, exactly where the reference's `ReadPalette` throws.
		if (stored.length < PIXEL_OFFSET)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Desire DES palette");
		const palette = stored.subarray(PALETTE_OFFSET, PIXEL_OFFSET);
		const reader = new GraBaseReader(
			stored,
			PIXEL_OFFSET,
			horizontalGeometry(layout.width, layout.height),
		);
		const pixels = Buffer.from(reader.unpackBits());
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
