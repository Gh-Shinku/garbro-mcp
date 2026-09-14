// Format reference: GARbro "Legacy/Mermaid/ImageMG1.cs", class `MgFormat`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARKER: Buffer = Buffer.from("BM", "latin1");
const EXTENSIONS = ["mg1", "mg2"];
/** The extension whose images are cut into thirty two pixel wide columns rather than five of them. */
const TILED_EXTENSION = "mg2";
const HEADER_SIZE = 0x36;
const IMAGE_OFFSET_FIELD = 0x0a;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const BITS_FIELD = 0x1c;
/** The first kind of image is always in five pieces. */
const MG1_TILES = 5;
/** The second kind is in one piece for every thirty two pixels of its width. */
const TILE_SPAN = 32;
const BITS_24 = 24;
const BITS_32 = 32;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/** The extension of a file, lowercased, or nothing at all when it has none. */
function extensionOf(sourcePath: string): string | undefined {
	const leaf = leafName(sourcePath).toLowerCase();
	const dot = leaf.lastIndexOf(".");
	return dot < 0 ? undefined : leaf.slice(dot + 1);
}

interface Mg1Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	imageOffset: number;
	tileCount: number;
}

/**
 * The reference asks for one of two extensions and then for a bitmap header behind them. The pieces an image is
 * cut into depend on which extension it came under: the first is always in five, the second in one for every
 * thirty two pixels of its width. The depth is only **checked** when the image is read, so a header naming
 * another one is found and then fails.
 */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<Mg1Layout | undefined> {
	const extension = extensionOf(sourcePath);
	if (extension === undefined || !EXTENSIONS.includes(extension))
		return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, MARKER.length).equals(MARKER)) return undefined;
		const width = header.readInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width <= 0 || height === 0) return undefined;
		if (width * height * 4 > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			bitsPerPixel: header.readInt16LE(BITS_FIELD),
			imageOffset: header.readUInt32LE(IMAGE_OFFSET_FIELD),
			tileCount:
				extension === TILED_EXTENSION
					? Math.trunc(width / TILE_SPAN)
					: MG1_TILES,
		};
	} catch {
		return undefined;
	}
}

export const mermaidMg1ImageDescriptor: FormatDescriptor = {
	id: "mermaid-mg1-image",
	name: "Mermaid obfuscated bitmap",
	extensions: EXTENSIONS,
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
			source: "Legacy/Mermaid/ImageMG1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mermaidMg1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mermaidMg1ImageDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		// A word of nothing is no word at all, so the reference finds these files by their names alone.
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mermaid bitmap");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					imageOffset: layout.imageOffset,
					tileCount: layout.tileCount,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "tile-shuffled",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				tileCount: layout.tileCount,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mermaid bitmap");
		const { width, height, bitsPerPixel, imageOffset, tileCount } = layout;
		if (bitsPerPixel !== BITS_24 && bitsPerPixel !== BITS_32) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Not supported Mermaid bitmap depth: ${bitsPerPixel}`,
			);
		}
		// The reference works out the width of a piece from its measurements with a division that cuts the
		// remainder off, and would divide by nothing at all for an image whose second kind of name is shorter
		// than thirty two pixels; a piece of no width is a loop the reference would never leave.
		if (tileCount <= 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Mermaid bitmap piece count",
			);
		}
		const bytesPerPixel = (bitsPerPixel + 7) >> 3;
		const stride = width * bytesPerPixel;
		const tileWidth = Math.trunc(stride / tileCount);
		if (tileWidth <= 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Mermaid bitmap piece width",
			);
		}
		const tileHeight = Math.trunc((height + tileCount - 1) / tileCount);
		const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
		const rowSize = tileHeight * stride;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		let at = imageOffset;
		// The pieces are stored by column and read back into the rows they belong to, from the last piece of
		// the last row up to the first. A piece whose place in the image would run past the image is skipped
		// over in the file, whichever bytes it holds.
		for (let dst = rowSize - stride; dst >= 0; dst -= stride) {
			for (let tile = tileCount - 1; tile >= 0; tile -= 1) {
				let tileDst = dst + tile * tileWidth;
				for (let x = 0; x < stride; x += tileWidth) {
					if (tileDst + tileWidth > pixels.length) {
						at += tileWidth;
					} else {
						const available = Math.min(
							tileWidth,
							Math.max(0, file.length - at),
						);
						if (available > 0) {
							file.copy(pixels, tileDst, at, at + available);
						}
						at += available;
					}
					tileDst += rowSize;
				}
			}
		}
		if (bitsPerPixel === BITS_32) {
			return Readable.from([writeBmp32(width, height, pixels, false)]);
		}
		return Readable.from([writeBmp24(width, height, pixels, false)]);
	},
});
