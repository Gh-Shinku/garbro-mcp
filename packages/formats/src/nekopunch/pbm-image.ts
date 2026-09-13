// Format reference: GARbro "ArcFormats/Nekopunch/ImagePBM.cs", class `PbmFormat` (an LZSS compressed bitmap
// whose header fields are themselves part of the compressed stream). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
/** The compressed stream starts here, so the byte at this offset is its first control byte. */
const STREAM_OFFSET = 4;
/** The low three bits of that control byte must all be set. */
const CONTROL_MASK = 7;
const CONTROL_VALUE = 7;
const BM_OFFSET = 5;
/** A bound on the declared unpacked size, which the reference trusts without checking. */
const MAX_UNPACKED = 0x10000000;

interface PbmLayout {
	unpackedSize: number;
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * Reads the declared unpacked size and the two marker fields, then decompresses the stream that follows and
 * measures it against that size. The marker is not a magic number of its own: the byte at offset four is the
 * stream's first control byte and the `BM` at five and six are the first two bytes it produces, so a file
 * that passes the marker checks is one whose stream really does begin with a bitmap.
 */
async function readLayout(source: ByteSource): Promise<PbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const unpackedSize = header.readUInt32LE(0);
		if (unpackedSize === 0 || unpackedSize > MAX_UNPACKED) return undefined;
		if ((header[STREAM_OFFSET] ?? 0) & CONTROL_MASK) {
			// The requirement is that all three bits are set, so a zero here fails it.
			if (((header[STREAM_OFFSET] ?? 0) & CONTROL_MASK) !== CONTROL_VALUE)
				return undefined;
		} else {
			return undefined;
		}
		if (header.subarray(BM_OFFSET, BM_OFFSET + 2).toString("latin1") !== "BM")
			return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const decoded = Buffer.from(
			inflateLzssAll(stored, { maxOutputLength: unpackedSize }),
		);
		// `LimitStream` fills to the declared size, so a short stream is zero padded rather than rejected.
		const padded = Buffer.alloc(unpackedSize);
		decoded.copy(padded, 0, 0, Math.min(decoded.length, padded.length));
		const meta = readBmpMetaData(padded);
		if (!meta) return undefined;
		return {
			unpackedSize,
			bmp: padded.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const pbmImageDescriptor: FormatDescriptor = {
	id: "nekopunch-pbm-image",
	name: "Studio Nekopunch compressed bitmap",
	extensions: ["pbm"],
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
			source: "ArcFormats/Nekopunch/ImagePBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pbmImageDescriptor,
	// The reference declares no signature; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "pbm") return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Nekopunch PBM image");
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
			// The stored stream is compressed and a bitmap header is part of the decompressed payload.
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
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Nekopunch PBM image");
		return Readable.from([layout.bmp]);
	},
});
