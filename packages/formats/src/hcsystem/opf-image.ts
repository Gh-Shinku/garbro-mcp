// Format reference: GARbro "ArcFormats/HCSystem/ImageOPF.cs", class `OpfFormat` (hcsystem engine image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeHeader } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'OPF '`. */
const SIGNATURE = Buffer.from([0x4f, 0x50, 0x46, 0x20]);
const HEADER_SIZE = 0x20;
const BMP_HEADER_SIZE = 54;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface OpfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
	dataOffset: number;
	dataLength: number;
}

/**
 * `ReadMetaData` takes six words from a thirty two byte header and checks exactly two things: the depth is at
 * most thirty two and the data starts no earlier than the end of the header. Everything else is the decoder's
 * problem, so the port keeps the same two checks and nothing more — a negative depth or a data length past the
 * end of the file lists successfully and fails when the pixels are asked for, which is where the reference
 * fails too.
 */
async function readFields(source: ByteSource): Promise<OpfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const width = head.readUInt32LE(4);
		const height = head.readUInt32LE(8);
		const bitsPerPixel = head.readInt32LE(0xc);
		const stride = head.readInt32LE(0x10);
		const dataOffset = head.readInt32LE(0x14);
		const dataLength = head.readInt32LE(0x18);
		if (bitsPerPixel > 32) return undefined;
		if (dataOffset < HEADER_SIZE) return undefined;
		if (dataLength > MAX_PIXEL_BYTES) return undefined;
		return { width, height, bitsPerPixel, stride, dataOffset, dataLength };
	} catch {
		return undefined;
	}
}

/** The stride a bitmap of this depth would use, which the stored stride may or may not match. */
function bitmapStride(width: number, bitsPerPixel: number): number {
	return ((width * bitsPerPixel) / 8 + 3) & ~3;
}

export const opfImageDescriptor: FormatDescriptor = {
	id: "hcsystem-opf-image",
	name: "hcsystem engine image",
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
			source: "ArcFormats/HCSystem/ImageOPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const opfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: opfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid hcsystem OPF image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(Math.max(layout.dataLength, 0)),
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					stride: layout.stride,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
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
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid hcsystem OPF image");
		// The reference names only two depths and throws for the rest, after the metadata read has already
		// accepted them, so the failure lands here rather than at listing time.
		if (layout.bitsPerPixel !== 24 && layout.bitsPerPixel !== 32)
			throw new GarbroError("INVALID_ARCHIVE", "Unsupported OPF colour depth");
		if (layout.dataLength < 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid OPF data length");
		if (BigInt(layout.dataOffset) + BigInt(layout.dataLength) > source.size)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated hcsystem OPF image");
		const rowBytes = (layout.width * layout.bitsPerPixel) / 8;
		if (layout.stride < rowBytes)
			throw new GarbroError("INVALID_ARCHIVE", "OPF stride is too small");
		if (layout.stride * layout.height > layout.dataLength)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated hcsystem OPF image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataLength),
		);
		const targetStride = bitmapStride(layout.width, layout.bitsPerPixel);
		if (layout.stride === targetStride) {
			// The stored rows are spaced exactly as the bitmap wants, so they are carried through verbatim
			// rather than repacked, which keeps whatever the producer left in the padding.
			const imageSize = layout.stride * layout.height;
			return Readable.from([
				Buffer.concat([
					writeHeader(
						layout.width,
						layout.height,
						layout.bitsPerPixel,
						BMP_HEADER_SIZE,
						imageSize,
						0,
						false,
					),
					pixels.subarray(0, imageSize),
				]),
			]);
		}
		// A different spacing means the rows have to be copied out, which is what a bitmap source does when it
		// is told a stride: `rowBytes` from each row, and the padding the writer adds is its own.
		const packed: Buffer = Buffer.alloc(rowBytes * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			pixels.copy(
				packed,
				row * rowBytes,
				row * layout.stride,
				row * layout.stride + rowBytes,
			);
		}
		const bitmap =
			layout.bitsPerPixel === 24
				? writeBmp24(layout.width, layout.height, packed, false)
				: writeBmp32(layout.width, layout.height, packed, false);
		return Readable.from([bitmap]);
	},
});
