// Format reference: GARbro "ArcFormats/RealLive/ImageG00Jpeg.cs", class `G00JpegFormat` (Siglus engine
// encrypted JPEG image). The byte pad is copied from that file's `DefaultKey`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The first byte labels the payload: only three, the encrypted JPEG, is this format's. */
const TYPE_JPEG = 3;
/** One type byte and two sixteen bit dimensions. */
const HEADER_SIZE = 5;
const MAX_DIMENSION = 0x8000;
const KEY_LENGTH = 256;

/** The reference's `DefaultKey`, used as a repeating exclusive or pad rather than as a substitution. */
export const G00_JPEG_KEY = Buffer.from([
	0x45, 0x0c, 0x85, 0xc0, 0x75, 0x14, 0xe5, 0x5d, 0x8b, 0x55, 0xec, 0xc0, 0x5b,
	0x8b, 0xc3, 0x8b, 0x81, 0xff, 0x00, 0x00, 0x04, 0x00, 0x85, 0xff, 0x6a, 0x00,
	0x76, 0xb0, 0x43, 0x00, 0x76, 0x49, 0x00, 0x8b, 0x7d, 0xe8, 0x8b, 0x75, 0xa1,
	0xe0, 0x0c, 0x85, 0xc0, 0xc0, 0x75, 0x78, 0x30, 0x44, 0x00, 0x85, 0xff, 0x76,
	0x37, 0x81, 0x1d, 0xd0, 0xff, 0x00, 0x00, 0x75, 0x44, 0x8b, 0xb0, 0x43, 0x45,
	0xf8, 0x8d, 0x55, 0xfc, 0x52, 0x00, 0x76, 0x68, 0x00, 0x00, 0x04, 0x00, 0x6a,
	0x43, 0x8b, 0xb1, 0x43, 0x00, 0x6a, 0x05, 0xff, 0x50, 0xff, 0xd3, 0xa1, 0xe0,
	0x04, 0x00, 0x56, 0x15, 0x2c, 0x44, 0x00, 0x85, 0xc0, 0x74, 0x09, 0xc3, 0xa1,
	0x5f, 0x5e, 0x33, 0x8b, 0xe5, 0x5d, 0xe0, 0x30, 0x04, 0x00, 0x81, 0xc6, 0x00,
	0x00, 0x81, 0xef, 0x04, 0x00, 0x85, 0x30, 0x44, 0x00, 0x00, 0x00, 0x5d, 0xc3,
	0x8b, 0x55, 0xf8, 0x8d, 0x5e, 0x5b, 0x4d, 0xfc, 0x51, 0xc4, 0x04, 0x5f, 0x8b,
	0xe5, 0x43, 0x00, 0xeb, 0xd8, 0x8b, 0x45, 0xff, 0x15, 0xe8, 0x83, 0xc0, 0x57,
	0x56, 0x52, 0x2c, 0xb1, 0x01, 0x00, 0x8b, 0x7d, 0xe8, 0x89, 0x00, 0xe8, 0x45,
	0xf4, 0x8b, 0x20, 0x50, 0x6a, 0x47, 0x28, 0x00, 0x50, 0x53, 0xff, 0x15, 0x34,
	0xe4, 0x6a, 0xb1, 0x43, 0x00, 0x0c, 0x8b, 0x45, 0x00, 0x6a, 0x8b, 0x4d, 0xec,
	0x89, 0x08, 0x8a, 0x85, 0xc0, 0x45, 0xf0, 0x84, 0x8b, 0x45, 0x10, 0x74, 0x05,
	0xf5, 0x28, 0x01, 0x00, 0x83, 0xc4, 0x52, 0x6a, 0x08, 0x89, 0x45, 0x83, 0xc2,
	0x20, 0x00, 0xe8, 0xe8, 0xf4, 0xfb, 0xff, 0xff, 0x8b, 0x8b, 0x5d, 0x45, 0x0c,
	0x83, 0xc0, 0x74, 0xc5, 0xf8, 0x53, 0xc4, 0x08, 0x85, 0xc0, 0x75, 0x56, 0x30,
	0x44, 0x8b, 0x1d, 0xd0, 0xf0, 0xa1, 0xe0, 0x00, 0x83,
]);

interface G00JpegLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * The payload is exclusive ored with the key as a repeating pad, starting at its first byte. GARbro's
 * `ByteStringEncryptedStream` indexes the key by the position in the stream it wraps — and that stream is the
 * region from offset five — so the first payload byte uses the first key byte.
 */
function decrypt(payload: Buffer): Buffer {
	const out: Buffer = Buffer.alloc(payload.length);
	for (let index = 0; index < payload.length; index += 1) {
		out[index] =
			(payload[index] ?? 0) ^ (G00_JPEG_KEY[index % KEY_LENGTH] ?? 0);
	}
	return out;
}

/**
 * The reference's `Jpeg.ReadMetaData`: a start of image marker, then markers until a frame header appears. The
 * length of each segment includes its own two bytes, so that is what is skipped, and the frame header is any
 * marker in the C0 row **except** C4, which is the huffman table. Nothing skips repeated 0xFF fill bytes, so a
 * file that uses them takes the same path the reference would.
 */
function readJpegFields(data: Buffer): G00JpegLayout | undefined {
	if (data.length < 2) return undefined;
	if ((data[0] ?? 0) !== 0xff || (data[1] ?? 0) !== 0xd8) return undefined;
	let position = 2;
	while (position < data.length) {
		if (position + 4 > data.length) return undefined;
		const marker = data.readUInt16BE(position);
		position += 2;
		if ((marker & 0xff00) !== 0xff00) return undefined;
		const length = data.readUInt16BE(position);
		position += 2;
		if ((marker & 0x00f0) === 0xc0 && marker !== 0xffc4) {
			if (length < 8 || position + 6 > data.length) return undefined;
			const precision = data[position] ?? 0;
			const height = data.readUInt16BE(position + 1);
			const width = data.readUInt16BE(position + 3);
			const components = data[position + 5] ?? 0;
			return { width, height, bitsPerPixel: precision * components };
		}
		// The reference seeks this far, which also means a segment shorter than its own header would move it
		// backwards; here such a length simply ends the search, since a hang is not worth reproducing.
		if (length < 2) return undefined;
		position += length - 2;
	}
	return undefined;
}

/**
 * The five byte header carries a version byte and the image's dimensions, and both dimensions are validated —
 * but they are **not** what the metadata reports: the reference returns whatever the JPEG header says, so a file
 * whose two pairs disagree is reported by the inner one. The marker that identifies the format is the decrypted
 * start of image, which is why this is a content probe rather than a signature.
 */
async function readFields(
	source: ByteSource,
): Promise<G00JpegLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if ((stored[0] ?? 0) !== TYPE_JPEG) return undefined;
		const width = stored.readUInt16LE(1);
		const height = stored.readUInt16LE(3);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		return readJpegFields(decrypt(stored.subarray(HEADER_SIZE)));
	} catch {
		return undefined;
	}
}

export const g00JpegImageDescriptor: FormatDescriptor = {
	id: "reallive-g00-jpeg-image",
	name: "Siglus engine encrypted JPEG image",
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
			source: "ArcFormats/RealLive/ImageG00Jpeg.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const g00JpegImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: g00JpegImageDescriptor,
	// No signature: the payload only becomes a JPEG once the key has been applied.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Siglus JPEG image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "jpg"),
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
			// The output drops the five byte header.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "jpg",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Siglus JPEG image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The payload is a JPEG once decrypted, so it is carried over rather than decoded.
		return Readable.from([decrypt(stored.subarray(HEADER_SIZE))]);
	},
});
