// Format reference: GARbro "ArcFormats/Rits/ImageHBM.cs", class `HbmFormat` (Rit's image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { RGB555_MASKS, writeHeader } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `HBM`, three bytes. */
const SIGNATURE = Buffer.from([0x48, 0x42, 0x4d]);
const HEADER_SIZE = 0x10;
/** The two flag bits of the byte at twelve; every other bit is ignored. */
const COMPRESSED_BIT = 0x10;
const FLIPPED_BIT = 0x20;
/** A compressed payload starts four bytes further in; those four are never read. */
const COMPRESSED_OFFSET = 0x14;
const BITS_PER_PIXEL = 16;
const BMP_HEADER_SIZE = 54;
/** The colour masks a sixteen bit bitmap declares: five bits each, red highest. */
const MASK_BYTES = 12;

interface HbmLayout {
	width: number;
	height: number;
	compressed: boolean;
	flipped: boolean;
}

/** `(2 * width + 3) & ~3`, which is also the stride a sixteen bit bitmap uses. */
function strideOf(width: number): number {
	return (width * 2 + 3) & ~3;
}

async function readFields(source: ByteSource): Promise<HbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 3).equals(SIGNATURE)) return undefined;
		const flags = header[12] ?? 0;
		return {
			width: header.readUInt32LE(4),
			height: header.readUInt32LE(8),
			compressed: (flags & COMPRESSED_BIT) !== 0,
			flipped: (flags & FLIPPED_BIT) !== 0,
		};
	} catch {
		return undefined;
	}
}

export const hbmImageDescriptor: FormatDescriptor = {
	id: "rits-hbm-image",
	name: "Rit's image format",
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
			source: "ArcFormats/Rits/ImageHBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hbmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Rit's image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: layout.compressed,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			// The output is a bitmap, so its length is not the stored one.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
				compressed: layout.compressed,
				flipped: layout.flipped,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Rit's image");
		const stride = strideOf(layout.width);
		const length = stride * layout.height;
		let stored: Buffer;
		if (layout.compressed) {
			const payload = Buffer.from(
				await source.readAt(
					BigInt(COMPRESSED_OFFSET),
					Number(source.size) - COMPRESSED_OFFSET,
				),
			);
			stored = await inflateZlibBufferCapped(payload, length);
		} else {
			const available = Math.min(length, Number(source.size) - HEADER_SIZE);
			stored =
				available > 0
					? Buffer.from(await source.readAt(BigInt(HEADER_SIZE), available))
					: Buffer.alloc(0);
		}
		// The buffer the reference fills is allocated empty and each read may return less than a whole row, so
		// whatever the stream does not supply stays zero.
		const pixels: Buffer = Buffer.alloc(length, 0x00);
		let cursor = 0;
		if (layout.flipped) {
			// The stream is read from its start but written from the buffer's end: the first row in the file is
			// the last row of the image. Each read is one row wide and the stream keeps its own position.
			for (let dst = length - stride; dst >= 0; dst -= stride) {
				const count = Math.min(stride, stored.length - cursor);
				if (count <= 0) break;
				stored.copy(pixels, dst, cursor, cursor + count);
				cursor += count;
			}
		} else {
			stored.copy(pixels, 0, 0, Math.min(length, stored.length));
		}
		// `ImageData.Create` is top down and has no stride of its own, but the stride it was given is already a
		// bitmap's, so the rows are carried across whole — padding included.
		const header = writeHeader(
			layout.width,
			layout.height,
			BITS_PER_PIXEL,
			BMP_HEADER_SIZE + MASK_BYTES,
			length,
			0,
			false,
		);
		// `BI_BITFIELDS` tells readers to look for the colour masks that follow the header.
		header.writeUInt32LE(3, 30);
		const masks: Buffer = Buffer.alloc(MASK_BYTES);
		masks.writeUInt32LE(RGB555_MASKS.red, 0);
		masks.writeUInt32LE(RGB555_MASKS.green, 4);
		masks.writeUInt32LE(RGB555_MASKS.blue, 8);
		return Readable.from([Buffer.concat([header, masks, pixels])]);
	},
});
