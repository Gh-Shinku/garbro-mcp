// Format reference: GARbro "ArcFormats/FC01/ImageCLM.cs", class `ClmFormat` (F&C Co. image format).
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
import { unpackMrgLzss } from "./mrg.js";

/** `CLM `, the reference's word 0x204D4C43. */
const MARKER: Buffer = Buffer.from("CLM ", "latin1");
/** The only version the reference accepts, a four byte string at offset four. */
const VERSION: Buffer = Buffer.from("1.00", "latin1");
const VERSION_OFFSET = 4;
const HEADER_SIZE = 0x40;
const DATA_OFFSET_FIELD = 0x10;
const WIDTH_FIELD = 0x1c;
const HEIGHT_FIELD = 0x20;
const DEPTH_FIELD = 0x24;
const UNPACKED_SIZE_FIELD = 0x28;
/**
 * An eight bit image carries its palette in front of the body: the library's default palette reader takes 256
 * entries of four bytes in blue, green, red, unused order, and throws when the stream ends inside them.
 */
const PALETTE_ENTRIES = 0x100;
const PALETTE_SIZE = PALETTE_ENTRIES * 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface ClmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
	dataOffset: number;
}

async function readLayout(source: ByteSource): Promise<ClmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		if (
			!header
				.subarray(VERSION_OFFSET, VERSION_OFFSET + VERSION.length)
				.equals(VERSION)
		) {
			return undefined;
		}
		const dataOffset = header.readUInt32LE(DATA_OFFSET_FIELD);
		if (dataOffset < HEADER_SIZE) return undefined;
		if (dataOffset > source.size) return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		const bitsPerPixel = header.readInt32LE(DEPTH_FIELD);
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
		if (width === 0 || height === 0) return undefined;
		// The reference checks neither size nor depth here; a depth it cannot build fails when the image is
		// read, so detection keeps accepting it. The port only needs a length it can decode into.
		if (unpackedSize <= 0) return undefined;
		const pixelSize =
			bitsPerPixel === 8
				? 1
				: bitsPerPixel === 24
					? 3
					: bitsPerPixel === 32
						? 4
						: 0;
		if (pixelSize !== 0 && width * height * pixelSize > MAX_IMAGE_BYTES)
			return undefined;
		return { width, height, bitsPerPixel, unpackedSize, dataOffset };
	} catch {
		return undefined;
	}
}

export const fc01ClmImageDescriptor: FormatDescriptor = {
	id: "fc01-clm-image",
	name: "F&C Co. image",
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
			source: "ArcFormats/FC01/ImageCLM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fc01ClmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01ClmImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C Co. image");
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "mrg-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C Co. image");
		const { width, height, bitsPerPixel, unpackedSize } = layout;
		const pixelSize =
			bitsPerPixel === 8
				? 1
				: bitsPerPixel === 24
					? 3
					: bitsPerPixel === 32
						? 4
						: 0;
		if (pixelSize === 0) {
			// The reference raises `NotSupportedException` for any other depth.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Not supported CLM color depth: ${bitsPerPixel}`,
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		let at = layout.dataOffset;
		let palette: Buffer = Buffer.alloc(0);
		if (bitsPerPixel === 8) {
			// The library's reader throws `EndOfStreamException` when the palette does not fit.
			if (at + PALETTE_SIZE > file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"F&C Co. palette is truncated",
				);
			}
			palette = file.subarray(at, at + PALETTE_SIZE);
			at += PALETTE_SIZE;
		}
		// The body runs from there to the end of the file, which is the packed size the reference computes.
		const decoded = unpackMrgLzss(file.subarray(at), unpackedSize);
		const needed = width * height * pixelSize;
		if (decoded.length < needed) {
			// The reference hands the buffer to its image layer, which cannot build a bitmap from it.
			throw new GarbroError("INVALID_ARCHIVE", "F&C Co. image is too short");
		}
		const pixels = decoded.subarray(0, needed);
		// No stride and no flip in the reference, so the bitmap is top down with tight rows.
		const bitmap =
			bitsPerPixel === 8
				? writeBmp8Palette(width, height, pixels, palette, false)
				: bitsPerPixel === 24
					? writeBmp24(width, height, pixels, false)
					: writeBmp32(width, height, pixels, false);
		return Readable.from([bitmap]);
	},
});
