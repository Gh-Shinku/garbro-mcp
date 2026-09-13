// Format reference: GARbro "ArcFormats/Crowd/ImageZBM.cs", class `ZbmFormat` (Crowd LZ-compressed bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `SZDD`, the same four bytes two other formats here use. */
const SIGNATURE = Buffer.from([0x53, 0x5a, 0x44, 0x44]);
/** Everything before the codec stream; only the size at ten is ever read. */
const STREAM_OFFSET = 0x0e;
const SIZE_POSITION = 0x0a;
/** The settings the compressed bitmap shares with the `SZDD` texture format and with `BM_`. */
const LZSS_SETTINGS = {
	frameSize: 0x1000,
	frameFill: 0x20,
	frameInitPosition: 0x1000 - 0x10,
};
/** The header the probe decompresses, and the bytes the reference inverts to read it. */
const BMP_HEADER_SIZE = 54;
const HEADER_XOR_SIZE = BMP_HEADER_SIZE;
/** The extraction inverts more than the header: the first hundred bytes of the image. */
const PIXEL_XOR_SIZE = 100;
const MAX_UNPACKED_SIZE = 256 * 1024 * 1024;

interface ZbmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The size the codec should produce, from the stored word. */
	dataLength: number;
}

/** `Bmp.ReadMetaData` over a decompressed header, without the file size check a whole file would need. */
function readBitmapFields(header: Buffer): ZbmLayout | undefined {
	if (header.length < BMP_HEADER_SIZE) return undefined;
	if ((header[0] ?? 0) !== 0x42 || (header[1] ?? 0) !== 0x4d) return undefined;
	const dibSize = header.readUInt32LE(14);
	if (dibSize < 40) return undefined;
	const width = header.readUInt32LE(18);
	const height = Math.abs(header.readInt32LE(22));
	const bitsPerPixel = header.readUInt16LE(28);
	if (width === 0 || height === 0) return undefined;
	return { width, height, bitsPerPixel, dataLength: 0 };
}

/**
 * The probe decompresses exactly the fifty four bytes of a bitmap header — whatever the stored size word says —
 * and then **inverts** them, because the header is stored obfuscated. The size word at ten is only read during
 * extraction, where it becomes the length of the whole decompressed image.
 *
 * The signature is shared with two other formats here, but the inversion keeps them apart: they look for `BM`
 * as stored, and this one only after every byte has been flipped, so no file can satisfy both probes.
 */
async function readFields(source: ByteSource): Promise<ZbmLayout | undefined> {
	if (source.size < BigInt(STREAM_OFFSET)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, STREAM_OFFSET));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const decoded = inflateLzss(stored, {
			...LZSS_SETTINGS,
			outputLength: BMP_HEADER_SIZE,
		});
		if (decoded.length < BMP_HEADER_SIZE) return undefined;
		const header = Buffer.from(decoded.subarray(0, BMP_HEADER_SIZE));
		for (let index = 0; index < HEADER_XOR_SIZE; index += 1) {
			header[index] = (header[index] ?? 0) ^ 0xff;
		}
		const bitmap = readBitmapFields(header);
		if (!bitmap) return undefined;
		const dataLength = head.readInt32LE(SIZE_POSITION);
		// The reference does not bound this from below, so a tiny size word is followed rather than refused;
		// only the cap above is the port's own.
		if (dataLength < 0 || dataLength > MAX_UNPACKED_SIZE) return undefined;
		return { ...bitmap, dataLength };
	} catch {
		return undefined;
	}
}

export const crowdZbmImageDescriptor: FormatDescriptor = {
	id: "crowd-zbm-image",
	name: "Crowd LZ-compressed bitmap",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Crowd/ImageZBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crowdZbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdZbmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd ZBM image");
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
			// The extraction decompresses, so its length is the stored size word rather than the file's.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				unpackedSize: layout.dataLength,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd ZBM image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const decoded = inflateLzss(stored, {
			...LZSS_SETTINGS,
			outputLength: layout.dataLength,
		});
		// The reference allocates the full size and unpacks into it, so a stream that stops early leaves zeroes.
		const data: Buffer = Buffer.alloc(layout.dataLength, 0x00);
		decoded.copy(data, 0, 0, Math.min(decoded.length, layout.dataLength));
		// Extraction inverts the first hundred bytes, not the fifty four the metadata read flips: the header and
		// the first forty six bytes of the image come back together.
		const inverted = Math.min(PIXEL_XOR_SIZE, data.length);
		for (let index = 0; index < inverted; index += 1) {
			data[index] = (data[index] ?? 0) ^ 0xff;
		}
		// The payload is a bitmap, so it is passed through rather than decoded.
		return Readable.from([data]);
	},
});
