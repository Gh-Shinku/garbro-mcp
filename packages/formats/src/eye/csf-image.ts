// Format reference: GARbro "Legacy/Eye/ImageCSF.cs", class `CsfFormat` (an eleven byte prefix and then
// an LZSS stream holding a Windows bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

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

/** The reference reads eleven bytes and checks the first three as ASCII. */
const PREFIX_SIZE = 0xb;
const SIGNATURE = Buffer.from("CSF", "ascii");
/** GARbro seeks past the whole prefix before handing the stream to `LzssStream`. */
const PAYLOAD_OFFSET = PREFIX_SIZE;
/** The decompressed payload is a bitmap, so the metadata comes from its own header. */
const BMP_TYPE_OFFSET = 0;
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

interface CsfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	payloadOffset: number;
	payloadSize: number;
}

/** Decompresses everything after the prefix; the default GARbro LZSS settings are the codec's. */
async function decompress(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size <= BigInt(PREFIX_SIZE)) return undefined;
	try {
		const compressed = Buffer.from(
			await source.readAt(
				BigInt(PAYLOAD_OFFSET),
				Number(source.size) - PREFIX_SIZE,
			),
		);
		return Buffer.from(
			inflateLzssAll(compressed, { maxOutputLength: MAX_OUTPUT }),
		);
	} catch {
		return undefined;
	}
}

/**
 * GARbro checks the `CSF` prefix, wraps the stream at 0xB in `LzssStream` and lets `Bmp.ReadMetaData`
 * parse what comes out, so the dimensions and the bit depth are the bitmap's own.
 */
async function readLayout(source: ByteSource): Promise<CsfLayout | undefined> {
	try {
		const prefix = Buffer.from(await source.readAt(0n, PREFIX_SIZE));
		if (!prefix.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const unpacked = await decompress(source);
		if (!unpacked || unpacked.length < BMP_HEADER_SIZE) return undefined;
		if (
			unpacked
				.subarray(BMP_TYPE_OFFSET, BMP_TYPE_OFFSET + 2)
				.toString("latin1") !== "BM"
		)
			return undefined;
		// The bitmap states its own length; trailing bytes of the stream are ignored.
		const bmpSize = unpacked.readUInt32LE(BMP_SIZE_OFFSET);
		if (bmpSize < BMP_HEADER_SIZE || bmpSize > unpacked.length)
			return undefined;
		if (unpacked.readUInt32LE(BMP_INFO_SIZE_OFFSET) < BITMAPINFOHEADER_SIZE)
			return undefined;
		const width = unpacked.readInt32LE(BMP_WIDTH_OFFSET);
		const height = unpacked.readInt32LE(BMP_HEIGHT_OFFSET);
		if (width <= 0 || height === 0) return undefined;
		const bitsPerPixel = unpacked.readUInt16LE(BMP_BPP_OFFSET);
		if (bitsPerPixel === 0) return undefined;
		return {
			width,
			height: Math.abs(height),
			bitsPerPixel,
			payloadOffset: PAYLOAD_OFFSET,
			payloadSize: Number(source.size) - PAYLOAD_OFFSET,
		};
	} catch {
		return undefined;
	}
}

/** Decompresses the payload and trims it to the bitmap's own length. */
async function readBitmap(source: ByteSource): Promise<Buffer | undefined> {
	const unpacked = await decompress(source);
	if (!unpacked || unpacked.length < BMP_HEADER_SIZE) return undefined;
	const bmpSize = unpacked.readUInt32LE(BMP_SIZE_OFFSET);
	if (bmpSize < BMP_HEADER_SIZE || bmpSize > unpacked.length) return undefined;
	return Buffer.from(unpacked.subarray(0, bmpSize));
}

export const csfImageDescriptor: FormatDescriptor = {
	id: "eye-csf-image",
	name: "Compressed bitmap format",
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
			source: "Legacy/Eye/ImageCSF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const csfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: csfImageDescriptor,
	// The reference declares no signature; the `CSF` prefix is checked in `detect`.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eye CSF bitmap");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eye CSF bitmap");
		return Readable.from([bitmap]);
	},
});
