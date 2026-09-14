// Format reference: GARbro "ArcFormats/DigitalWorks/ImageTX.cs", class `TxFormat` (Digital Works texture).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * `TX`, the two characters the reference compares, and the two whole words it registers: `TX\3\0` (0x00035854)
 * and `TX\2\0` (0x00025854). Its signature list ends in a zero, which is the sentinel for being reachable by
 * extension as well, so a file named `*.tx` or `*.tmx` whose marker and depth are sound is taken even when its
 * third byte is neither of those two.
 */
const MARKER: Buffer = Buffer.from("TX", "latin1");
const MARKERS: Buffer[] = [
	Buffer.from([0x54, 0x58, 0x03, 0x00]),
	Buffer.from([0x54, 0x58, 0x02, 0x00]),
];
const EXTENSIONS = ["tmx", "tx"];
const HEADER_SIZE = 0x10;
const BLOCK_SIZE = 256;
const WIDTH_BLOCKS_FIELD = 2;
const HEIGHT_BLOCKS_FIELD = 4;
const DEPTH_FIELD = 6;
/** The depth is stored in bytes a pixel, one to four. */
const MIN_DEPTH_BYTES = 1;
const MAX_DEPTH_BYTES = 4;
const PALETTE_ENTRIES = 0x100;
/** The library's palette reader takes four bytes an entry in blue, green, red, alpha order here. */
const PALETTE_ENTRY_SIZE = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface TxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
}

async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<TxLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, MARKER.length).equals(MARKER)) return undefined;
		// A whole registered word, or a name the format declares an extension for.
		const signed = MARKERS.some((candidate) =>
			header.subarray(0, 4).equals(candidate),
		);
		const lower = sourcePath.toLowerCase();
		const named = EXTENSIONS.some((extension) =>
			lower.endsWith(`.${extension}`),
		);
		if (!signed && !named) return undefined;
		const depthBytes = header[DEPTH_FIELD] ?? 0;
		if (depthBytes < MIN_DEPTH_BYTES || depthBytes > MAX_DEPTH_BYTES)
			return undefined;
		const widthBlocks = header.readUInt16LE(WIDTH_BLOCKS_FIELD);
		const heightBlocks = header.readUInt16LE(HEIGHT_BLOCKS_FIELD);
		// Both dimensions are whole blocks, so a count of zero is not an image.
		if (widthBlocks === 0 || heightBlocks === 0) return undefined;
		const width = widthBlocks * BLOCK_SIZE;
		const height = heightBlocks * BLOCK_SIZE;
		const bitsPerPixel = depthBytes * 8;
		if ((width * height * bitsPerPixel) / 8 > MAX_IMAGE_BYTES) return undefined;
		return { width, height, bitsPerPixel, dataOffset: HEADER_SIZE };
	} catch {
		return undefined;
	}
}

export const digitalWorksTxImageDescriptor: FormatDescriptor = {
	id: "digital-works-tx-image",
	name: "Digital Works texture",
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
			source: "ArcFormats/DigitalWorks/ImageTX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const digitalWorksTxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: digitalWorksTxImageDescriptor,
	detection: { signatures: MARKERS.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Digital Works texture");
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
				compression: "block-interleaved",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source, "x.tx");
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Digital Works texture");
		const { width, height, bitsPerPixel } = layout;
		const pixelSize = bitsPerPixel / 8;
		if (bitsPerPixel !== 8 && bitsPerPixel !== 24 && bitsPerPixel !== 32) {
			// The reference builds a thirty two bit image for any depth that is neither eight nor twenty four,
			// which a sixteen bit buffer cannot fill, so such a file fails when it is read.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Not supported Digital Works texture depth: ${bitsPerPixel}`,
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const blockStride = BLOCK_SIZE * pixelSize;
		const stride = width * pixelSize;
		const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
		let position = layout.dataOffset;
		const columnBlocks = Math.trunc(width / BLOCK_SIZE);
		const rowBlocks = Math.trunc(height / BLOCK_SIZE);
		// Every 256 by 256 block is stored a row at a time, and the blocks walk left to right and top to bottom.
		let blockRow = 0;
		for (let row = 0; row < rowBlocks; row += 1) {
			let blockColumn = blockRow;
			for (let column = 0; column < columnBlocks; column += 1) {
				let destination = blockColumn;
				for (let line = 0; line < BLOCK_SIZE; line += 1) {
					const available = Math.min(
						blockStride,
						Math.max(0, file.length - position),
					);
					if (available > 0 && destination + available <= pixels.length) {
						file.copy(pixels, destination, position, position + available);
					}
					position += blockStride;
					destination += stride;
				}
				blockColumn += blockStride;
			}
			blockRow += stride * BLOCK_SIZE;
		}
		let palette: Buffer = Buffer.alloc(0);
		if (bitsPerPixel === 8) {
			// The palette follows the pixels rather than leading them, and the library's reader throws when it
			// does not fit. Its order is blue, green, red and alpha, of which a bitmap palette keeps three.
			const paletteSize = PALETTE_ENTRIES * PALETTE_ENTRY_SIZE;
			if (position + paletteSize > file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Digital Works palette is truncated",
				);
			}
			palette = Buffer.from(file.subarray(position, position + paletteSize));
			for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
				palette[index * PALETTE_ENTRY_SIZE + 3] = 0x00;
			}
		}
		// `ImageData.Create` with the depth's stride and no flip: the bitmap is top down with tight rows.
		const bitmap =
			bitsPerPixel === 8
				? writeBmp8Palette(width, height, pixels, palette, false)
				: bitsPerPixel === 24
					? writeBmp24(width, height, pixels, false)
					: writeBmp32(width, height, pixels, false);
		return Readable.from([bitmap]);
	},
});
