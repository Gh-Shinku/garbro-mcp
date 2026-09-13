// Format reference: GARbro "ArcFormats/Silky/ImageGRD.cs", class `GrdFormat` (a compressed bitmap:
// eight bytes after the `CMP_` tag, then an LZSS stream holding a Windows bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'CMP_' as stored; `0x5F504D43` as a little endian word. */
const SIGNATURE = Buffer.from("CMP_", "ascii");
/** GARbro seeks this far in before handing the stream to `LzssStream`. */
const PREFIX_SIZE = 12;
/**
 * The reference sets `FrameFill` to a space, so back references into the untouched part of the ring
 * buffer yield spaces rather than zeros. Everything else is the LZSS default.
 */
const FRAME_FILL = 0x20;
/** The decompressed payload is a bitmap, so the metadata comes from its own header. */
const BMP_SIZE_OFFSET = 2;
const BMP_INFO_SIZE_OFFSET = 14;
const BMP_WIDTH_OFFSET = 18;
const BMP_HEIGHT_OFFSET = 22;
const BMP_BPP_OFFSET = 28;
/** A `BITMAPFILEHEADER` plus a `BITMAPINFOHEADER`; OS/2 core headers are not accepted. */
const BMP_HEADER_SIZE = 54;
const BITMAPINFOHEADER_SIZE = 40;
/** Guards against a hostile header asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface GrdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	payloadOffset: number;
	payloadSize: number;
}

/** Decompresses the payload with the space filled ring buffer and trims it to the bitmap's length. */
async function readBitmap(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size <= BigInt(PREFIX_SIZE)) return undefined;
	try {
		const compressed = Buffer.from(
			await source.readAt(
				BigInt(PREFIX_SIZE),
				Number(source.size) - PREFIX_SIZE,
			),
		);
		const unpacked = inflateLzssAll(compressed, {
			frameFill: FRAME_FILL,
			maxOutputLength: MAX_OUTPUT,
		});
		if (unpacked.length < BMP_HEADER_SIZE) return undefined;
		if (unpacked.subarray(0, 2).toString("latin1") !== "BM") return undefined;
		if (unpacked.readUInt32LE(BMP_INFO_SIZE_OFFSET) < BITMAPINFOHEADER_SIZE)
			return undefined;
		// The bitmap states its own length; trailing bytes of the stream are ignored.
		const bmpSize = unpacked.readUInt32LE(BMP_SIZE_OFFSET);
		if (bmpSize < BMP_HEADER_SIZE || bmpSize > unpacked.length)
			return undefined;
		return Buffer.from(unpacked.subarray(0, bmpSize));
	} catch {
		return undefined;
	}
}

/**
 * GARbro `GrdFormat.ReadMetaData` decompresses the stream and lets `Bmp.ReadMetaData` parse the result,
 * so the dimensions and the bit depth are the bitmap's own.
 */
async function readLayout(source: ByteSource): Promise<GrdLayout | undefined> {
	if (source.size <= BigInt(PREFIX_SIZE)) return undefined;
	try {
		// ReadMetaData checks nothing itself: GARbro reaches it only through the registry gate. Re-checking
		// the tag here is a deliberate deviation that keeps detect from claiming unrelated files.
		const prefix = Buffer.from(await source.readAt(0n, SIGNATURE.length));
		if (!prefix.equals(SIGNATURE)) return undefined;
	} catch {
		return undefined;
	}
	const bitmap = await readBitmap(source);
	if (!bitmap) return undefined;
	const width = bitmap.readInt32LE(BMP_WIDTH_OFFSET);
	const height = bitmap.readInt32LE(BMP_HEIGHT_OFFSET);
	if (width <= 0 || height === 0) return undefined;
	const bitsPerPixel = bitmap.readUInt16LE(BMP_BPP_OFFSET);
	if (bitsPerPixel === 0) return undefined;
	return {
		width,
		height: Math.abs(height),
		bitsPerPixel,
		payloadOffset: PREFIX_SIZE,
		payloadSize: Number(source.size) - PREFIX_SIZE,
	};
}

export const grdImageDescriptor: FormatDescriptor = {
	id: "silky-grd-image",
	name: "Silky's compressed bitmap format",
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
			source: "ArcFormats/Silky/ImageGRD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const grdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: grdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky GRD bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.payloadOffset),
				size: BigInt(layout.payloadSize),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The payload is LZSS data for a bitmap of a different length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const bitmap = await readBitmap(source);
		if (!bitmap)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky GRD bitmap");
		return Readable.from([bitmap]);
	},
});
