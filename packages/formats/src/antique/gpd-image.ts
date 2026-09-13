// Format reference: GARbro "ArcFormats/Antique/ImageGPD.cs", class `GpdFormat` (An*tique image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x18;
const MARKER = "GPD ";
const DATA_OFFSET = 0x18;
/** A packed size of minus one means the pixels follow as they are rather than through the compressor. */
const RAW = -1;
/** Palette entries are four bytes, blue first, as the reference's own colour map reads them. */
const PALETTE_ENTRY_SIZE = 4;
const DEPTHS = [8, 24, 32];
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GpdLayout {
	width: number;
	height: number;
	/** Palette entries the header claims, which is only meaningful for eight bit images. */
	colors: number;
	bitsPerPixel: number;
}

/**
 * The reference reads the header and hands the fields back without checking a single one of them, so the probe
 * accepts a file whose depth it will later refuse. The port keeps that: the refusal happens where the reference
 * refuses, which is when the pixels are read.
 */
async function readLayout(source: ByteSource): Promise<GpdLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		return {
			width: header.readUInt32LE(8),
			height: header.readUInt32LE(0x0c),
			colors: header.readInt32LE(0x10),
			bitsPerPixel: header.readInt32LE(0x14),
		};
	} catch {
		return undefined;
	}
}

export const gpdImageDescriptor: FormatDescriptor = {
	id: "antique-gpd-image",
	name: "An*tique image",
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
			source: "ArcFormats/Antique/ImageGPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gpdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gpdImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid An*tique image");
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
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid An*tique image");
		const { width, height, colors, bitsPerPixel } = layout;
		if (!DEPTHS.includes(bitsPerPixel)) {
			// The reference checks the depth here, after the metadata has already been handed out.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Unsupported An*tique image depth",
			);
		}
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid An*tique image size");
		}
		// The reference multiplies before it divides, so a twenty four bit row is three bytes a pixel exactly.
		const stride = Math.trunc((width * bitsPerPixel) / 8);
		const unpacked = stride * height;
		if (
			unpacked > MAX_IMAGE_BYTES ||
			colors * PALETTE_ENTRY_SIZE > MAX_IMAGE_BYTES
		) {
			throw new GarbroError("INVALID_ARCHIVE", "An*tique image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		let at = DATA_OFFSET;
		let palette: Buffer = Buffer.alloc(0);
		if (bitsPerPixel === 8) {
			// The entry count is taken as it stands: a zero here is an empty palette, not a default of 256.
			const paletteSize = Math.max(0, colors) * PALETTE_ENTRY_SIZE;
			palette = Buffer.alloc(paletteSize, 0x00);
			file.copy(palette, 0, at, Math.min(file.length, at + paletteSize));
			at += paletteSize;
		}
		if (at + 4 > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated An*tique image");
		}
		const packedSize = file.readInt32LE(at);
		at += 4;
		let pixels: Buffer;
		if (packedSize === RAW) {
			// The reference reads what it asks for and leaves the rest blank, so a short file pads.
			pixels = Buffer.alloc(unpacked, 0x00);
			file.copy(pixels, 0, at, Math.min(file.length, at + unpacked));
		} else {
			pixels = inflateLzss(file.subarray(at), { outputLength: unpacked });
		}
		if (bitsPerPixel === 8) {
			// The reference hands this image over flipped, so the bitmap's height is positive.
			return Readable.from([
				writeBmp8Palette(width, height, pixels, palette, true),
			]);
		}
		if (bitsPerPixel === 24) {
			return Readable.from([writeBmp24(width, height, pixels, true)]);
		}
		return Readable.from([writeBmp32(width, height, pixels, true)]);
	},
});
