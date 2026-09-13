// Format reference: GARbro "Legacy/WestGate/ImageNBMP.cs", class `NbmpFormat` (an uncompressed bitmap with its
// own header and, for eight bit images, a palette). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32, writeHeader } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `NBMP`. */
const SIGNATURE = Buffer.from([0x4e, 0x42, 0x4d, 0x50]);
const HEADER_SIZE = 0x2c;
const BMP_HEADER_SIZE = 54;
/** The reference requires this value at offset four, which is its header size minus the signature. */
const HEADER_MARKER = 0x28;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const BPP_OFFSET = 0x12;
const PIXEL_OFFSET = 0x2c;
/** `ReadPalette` defaults to a full BGRX table. */
const PALETTE_ENTRIES = 0x100;
const PALETTE_SIZE = PALETTE_ENTRIES * 4;
const SUPPORTED_BPP = [8, 24, 32];

interface NbmpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
}

/**
 * `ReadMetaData` checks the signature, a fixed header word and the bit depth, and reads the dimensions. It
 * validates nothing about the payload, so a file whose pixels are missing still lists and fails on extraction.
 */
async function readLayout(source: ByteSource): Promise<NbmpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (header.readInt32LE(4) !== HEADER_MARKER) return undefined;
		const bitsPerPixel = header.readInt16LE(BPP_OFFSET);
		if (!SUPPORTED_BPP.includes(bitsPerPixel)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			stride: (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0,
		};
	} catch {
		return undefined;
	}
}

export const nbmpImageDescriptor: FormatDescriptor = {
	id: "westgate-nbmp-image",
	name: "West Gate bitmap format",
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
			source: "Legacy/WestGate/ImageNBMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nbmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nbmpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid West Gate NBMP image");
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// A bitmap header, and for eight bit images a palette, is written around the copied pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				stride: layout.stride,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid West Gate NBMP image");
		const paletteSize = layout.bitsPerPixel === 8 ? PALETTE_SIZE : 0;
		const needed = layout.stride * layout.height;
		// `ReadBytes` throws when the stream cannot supply the count, so a short file fails here rather than
		// being padded or zero filled.
		if (source.size < BigInt(PIXEL_OFFSET + paletteSize + needed))
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated West Gate NBMP image",
			);
		const stored = Buffer.from(
			await source.readAt(BigInt(PIXEL_OFFSET), paletteSize + needed),
		);
		const pixels = stored.subarray(paletteSize);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		//
		// The stored rows are `stride` bytes wide, and `stride` is by construction the width a bitmap uses at
		// the same depth, so the rows are already in the output layout. The bytes past the last pixel of a row
		// are part of the stored image in the reference — it reads `stride * height` bytes and hands them to
		// `ImageData` — so they are carried through instead of being repacked into zero padding.
		if (layout.bitsPerPixel === 32) {
			// A 32 bit image is stored as BGRX and a bitmap takes the fourth byte as it stands, so nothing is
			// rewritten and a test keeps a marker in that byte to prove it.
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, true),
			]);
		}
		const palette =
			paletteSize === 0 ? Buffer.alloc(0) : stored.subarray(0, PALETTE_SIZE);
		return Readable.from([
			Buffer.concat([
				writeHeader(
					layout.width,
					layout.height,
					layout.bitsPerPixel,
					BMP_HEADER_SIZE + paletteSize,
					pixels.length,
					paletteSize === 0 ? 0 : PALETTE_ENTRIES,
					true,
				),
				palette,
				pixels,
			]),
		]);
	},
});
