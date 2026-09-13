// Format reference: GARbro "Legacy/Herb/ImageGRP.cs", class `GrpFormat`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp16, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x28;
/** The palette sits directly behind the header and the pixel data behind the palette, always. */
const PALETTE_OFFSET = 0x28;
const PALETTE_BYTES = 0x100 * 4;
const DATA_OFFSET = 0x428;
/** The first byte is the bit depth, and it is also the signature: only these three depths exist. */
const DEPTH_8 = 0x08;
const DEPTH_16 = 0x18;
const DEPTH_24 = 0x20;
const DEPTHS = [DEPTH_8, DEPTH_16, DEPTH_24] as const;
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GrpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The stride the stored rows use, which is the file's own and may be wider than a bitmap's. */
	stride: number;
}

async function readLayout(source: ByteSource): Promise<GrpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const depth = header[0];
		if (depth !== DEPTH_8 && depth !== DEPTH_16 && depth !== DEPTH_24) {
			return undefined;
		}
		if (header.readInt32LE(4) !== 0 || header.readInt32LE(8) !== 1) {
			return undefined;
		}
		return {
			width: header.readUInt32LE(0x20),
			height: header.readUInt32LE(0x24),
			bitsPerPixel: depth === DEPTH_8 ? 8 : depth === DEPTH_16 ? 16 : 24,
			stride: header.readInt32LE(0x0c),
		};
	} catch {
		return undefined;
	}
}

/**
 * Copies the stored rows into the tight layout the shared bitmap writers take: rows of `width * depth / 8`
 * bytes one after another, which they pad to a bitmap's own stride. The stored stride is the file's, so a row
 * that is wider than the pixels it holds is trimmed, and one that is narrower than a row cannot describe a row
 * at all.
 */
function repack(
	pixels: Buffer,
	stride: number,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const rowBytes = (width * bitsPerPixel) / 8;
	if (stride < rowBytes) {
		throw new GarbroError("INVALID_ARCHIVE", "Herb image rows are too short");
	}
	const output: Buffer = Buffer.alloc(rowBytes * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(output, row * rowBytes, row * stride, row * stride + rowBytes);
	}
	return output;
}

export const grpImageDescriptor: FormatDescriptor = {
	id: "herb-grp-image",
	name: "Herb Soft image",
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
			source: "Legacy/Herb/ImageGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const grpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: grpImageDescriptor,
	detection: {
		signatures: DEPTHS.map((depth) => ({ bytes: Buffer.from([depth]) })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Herb image");
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
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Herb image");
		const { width, height, bitsPerPixel, stride } = layout;
		const stored = BigInt(stride) * BigInt(height);
		if (stride <= 0 || stored > BigInt(MAX_IMAGE_BYTES)) {
			throw new GarbroError("INVALID_ARCHIVE", "Herb image is too large");
		}
		let palette: Buffer | undefined;
		if (bitsPerPixel === 8) {
			const raw = Buffer.from(
				await source.readAt(BigInt(PALETTE_OFFSET), PALETTE_BYTES),
			);
			// The file stores red, green, blue and a spare byte; a bitmap wants blue first.
			palette = Buffer.alloc(PALETTE_BYTES, 0x00);
			for (let index = 0; index < 0x100; index += 1) {
				palette[index * 4] = raw[index * 4 + 2] ?? 0;
				palette[index * 4 + 1] = raw[index * 4 + 1] ?? 0;
				palette[index * 4 + 2] = raw[index * 4] ?? 0;
				palette[index * 4 + 3] = raw[index * 4 + 3] ?? 0;
			}
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const size = Number(stored);
		// The reference reads once and ignores how much arrived, so a stream that holds less leaves zeros.
		const decoded = await inflateZlibBufferCapped(
			file.subarray(DATA_OFFSET),
			size,
		);
		const pixels: Buffer = Buffer.alloc(size, 0x00);
		decoded.copy(pixels, 0, 0, Math.min(size, decoded.length));
		const packed = repack(pixels, stride, width, height, bitsPerPixel);
		if (bitsPerPixel === 8) {
			return Readable.from([
				writeBmp8Palette(
					width,
					height,
					packed,
					palette ?? Buffer.alloc(PALETTE_BYTES, 0),
					false,
				),
			]);
		}
		return Readable.from([
			bitsPerPixel === 16
				? writeBmp16(width, height, packed, false)
				: writeBmp24(width, height, packed, false),
		]);
	},
});
