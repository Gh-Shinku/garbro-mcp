// Format reference: GARbro "Legacy/PlanTech/ImagePAC.cs", class `PacFormat` (the bitmap decoder for the
// package the archive opener lists). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpMetaData,
	RGB565_MASKS,
	writeBmp16,
	writeHeader,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const BMP_TAG = Buffer.from("BM", "ascii");
/** The zeros the reference tests with `file.Signature != 0`. */
const SIGNATURE = Buffer.from([0x00, 0x00, 0x00, 0x00]);
const BMP_OFFSET = 8;
const HEADER_SIZE = 14;
const BMP_HEADER_SIZE = 54;
const IMAGE_OFFSET_OFFSET = 10;

interface PacLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Relative to the embedded bitmap, which starts at offset eight. */
	imageOffset: number;
}

/**
 * The fourteen byte header is a bitmap that does not begin at the start of the file: it begins at offset
 * eight, after a four byte zero signature and a size field that appears again at offset ten. `ReadMetaData`
 * parses the rest with the ordinary bitmap reader over a region starting there, so every bitmap offset —
 * including the pixel data offset — is relative to that point.
 */
async function readLayout(source: ByteSource): Promise<PacLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.readInt32LE(0) !== 0) return undefined;
		if (!header.subarray(BMP_OFFSET, BMP_OFFSET + 2).equals(BMP_TAG))
			return undefined;
		if (header.readUInt32LE(4) !== header.readUInt32LE(10)) return undefined;
		// The bitmap reader keeps its own sanity check, which needs the region as it really is: everything
		// after the wrapper header.
		const region = Buffer.from(
			await source.readAt(BigInt(BMP_OFFSET), Number(source.size) - BMP_OFFSET),
		);
		const bmp = readBmpMetaData(region);
		if (!bmp) return undefined;
		return {
			width: bmp.width,
			height: bmp.height,
			bitsPerPixel: bmp.bitsPerPixel,
			imageOffset: region.readUInt32LE(IMAGE_OFFSET_OFFSET),
		};
	} catch {
		return undefined;
	}
}

/** The reference computes the row stride itself and passes it to `ImageData.Create`. */
function strideOf(width: number, bitsPerPixel: number): number {
	return (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
}

const GREY_PALETTE_SIZE = 256 * 4;

/** The ramp `writeBmp8` writes, since the stored palette is ignored. */
function greyPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(GREY_PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = i;
		palette[i * 4 + 2] = i;
	}
	return palette;
}

/**
 * The stride the reference asks for is the bitmap stride itself, which is how a bitmap lays its rows out.
 * The stored bytes are therefore already in the layout a bitmap of this size has, and they are carried
 * through verbatim — including whatever the writer of the original file left in the row padding. Only the
 * sixteen bit case needs a different header, because its words are 565 and a plain DIB header would describe
 * them as 555.
 */
function bitmapOf(layout: PacLayout, stored: Buffer, stride: number): Buffer {
	const { width, height, bitsPerPixel } = layout;
	if (bitsPerPixel === 16) {
		// Build the `BI_BITFIELDS` header through the shared writer, then correct the two size fields, which
		// were computed for the placeholder pixels.
		const header = writeBmp16(
			width,
			height,
			Buffer.alloc(stride * height),
			false,
			RGB565_MASKS,
		).subarray(0, BMP_HEADER_SIZE + 12);
		header.writeUInt32LE(header.length + stored.length, 2);
		header.writeUInt32LE(stored.length, 34);
		return Buffer.concat([header, stored]);
	}
	const paletteSize = bitsPerPixel === 8 ? GREY_PALETTE_SIZE : 0;
	const dataOffset = BMP_HEADER_SIZE + paletteSize;
	const header = writeHeader(
		width,
		height,
		bitsPerPixel,
		dataOffset,
		stored.length,
		paletteSize / 4,
		false,
	);
	if (paletteSize === 0) return Buffer.concat([header, stored]);
	return Buffer.concat([header, greyPalette(), stored]);
}

export const plantechPacImageDescriptor: FormatDescriptor = {
	id: "plantech-pac-image",
	name: "PLANTECH engine bitmap",
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
			source: "Legacy/PlanTech/ImagePAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const plantechPacImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: plantechPacImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PLANTECH PAC bitmap");
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
					imageOffset: layout.imageOffset,
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
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PLANTECH PAC bitmap");
		const { width, height, bitsPerPixel } = layout;
		const stride = strideOf(width, bitsPerPixel);
		// `ReadBytes` throws when the stream cannot supply the count.
		const start = BMP_OFFSET + layout.imageOffset;
		const needed = stride * height;
		if (Number(source.size) < start + needed)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated PLANTECH PAC bitmap");
		const pixels = Buffer.from(await source.readAt(BigInt(start), needed));
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height, and it
		// reports the stride it was given. Only these four depths are accepted, as in the reference; an
		// unsupported one still lists, because the reference throws while reading and not while probing.
		if (
			bitsPerPixel !== 8 &&
			bitsPerPixel !== 16 &&
			bitsPerPixel !== 24 &&
			bitsPerPixel !== 32
		)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Unsupported PLANTECH PAC bitmap depth ${bitsPerPixel}`,
			);
		return Readable.from([bitmapOf(layout, pixels, stride)]);
	},
});
