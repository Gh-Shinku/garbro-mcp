// Format reference: GARbro "ArcFormats/Nags/ImageNGP.cs", class `NgpFormat` (NAGS engine image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `NGP `, the reference's little endian word 0x2050474E. */
const MARKER: Buffer = Buffer.from("NGP ", "latin1");
/** Sizes, dimensions and a depth in bytes per pixel. */
const SIZES_OFFSET = 0x12;
/** The unpacked length sits well behind them, and the stream begins right after it. */
const UNPACKED_SIZE_OFFSET = 0x100;
const DATA_OFFSET = 0x104;
const DEPTHS = [8, 24, 32];
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface NgpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	packedSize: number;
	unpackedSize: number;
}

async function readLayout(source: ByteSource): Promise<NgpLayout | undefined> {
	if (source.size < BigInt(DATA_OFFSET)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, DATA_OFFSET));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		const packedSize = header.readInt32LE(SIZES_OFFSET);
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_OFFSET);
		// The reference refuses either size being zero or negative, and nothing else here.
		if (packedSize <= 0 || unpackedSize <= 0) return undefined;
		return {
			width: header.readUInt32LE(SIZES_OFFSET + 4),
			height: header.readUInt32LE(SIZES_OFFSET + 8),
			bitsPerPixel: header.readUInt16LE(SIZES_OFFSET + 12) * 8,
			packedSize,
			unpackedSize,
		};
	} catch {
		return undefined;
	}
}

export const nagsNgpImageDescriptor: FormatDescriptor = {
	id: "nags-ngp-image",
	name: "NAGS engine image",
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
			source: "ArcFormats/Nags/ImageNGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nagsNgpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nagsNgpImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid NAGS image");
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
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid NAGS image");
		const { width, height, bitsPerPixel, packedSize, unpackedSize } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NAGS image size");
		}
		// The reference checks the depth after decompressing; the port checks it first, which is the same
		// answer for less work.
		if (!DEPTHS.includes(bitsPerPixel)) {
			throw new GarbroError("INVALID_ARCHIVE", "Unsupported NAGS image depth");
		}
		if (unpackedSize > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "NAGS image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const packed = file.subarray(DATA_OFFSET, DATA_OFFSET + packedSize);
		const pixels = await inflateZlibBufferCapped(packed, unpackedSize);
		// The reference insists on the whole image coming out of the stream.
		if (pixels.length !== unpackedSize) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated NAGS image");
		}
		// The reference hands this image over as its stream reads, so the bitmap is top down.
		if (bitsPerPixel === 8) {
			return Readable.from([writeBmp8(width, height, pixels, false)]);
		}
		if (bitsPerPixel === 24) {
			return Readable.from([writeBmp24(width, height, pixels, false)]);
		}
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
