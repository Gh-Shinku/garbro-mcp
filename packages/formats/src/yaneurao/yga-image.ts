// Format reference: GARbro "Legacy/Yaneurao/ImageYGA.cs", class `YgaFormat` (Yaneurao image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The format answers to two three byte markers, `yga` and `epf`. */
const YGA_SIGNATURE = Buffer.from([0x79, 0x67, 0x61]);
const EPF_SIGNATURE = Buffer.from([0x65, 0x70, 0x66]);
const HEADER_SIZE = 0x18;
const COMPRESSION_POSITION = 0x0c;
const UNPACKED_SIZE_POSITION = 0x10;
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
/** The port's own ceiling, since the declared size allocates a buffer the file itself need not justify. */
const MAX_UNPACKED_SIZE = 0x4000000;

interface YgaLayout {
	width: number;
	height: number;
	unpackedSize: number;
	compressed: boolean;
}

/**
 * The one field the reference validates is the compression word, and it reads it as **signed**: only values
 * above one are refused, so a negative word passes and is then treated as compressed, because the
 * compression test is `!= 0` rather than a comparison with one.
 */
async function readFields(source: ByteSource): Promise<YgaLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const marker = header.subarray(0, 3);
		if (!marker.equals(YGA_SIGNATURE) && !marker.equals(EPF_SIGNATURE))
			return undefined;
		const compression = header.readInt32LE(COMPRESSION_POSITION);
		if (compression > 1) return undefined;
		const width = header.readUInt32LE(4);
		const height = header.readUInt32LE(8);
		return {
			width,
			height,
			unpackedSize: header.readInt32LE(UNPACKED_SIZE_POSITION),
			compressed: compression !== 0,
		};
	} catch {
		return undefined;
	}
}

export const ygaImageDescriptor: FormatDescriptor = {
	id: "yaneurao-yga-image",
	name: "Yaneurao image format",
	extensions: ["yga", "epf"],
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
			source: "Legacy/Yaneurao/ImageYGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ygaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ygaImageDescriptor,
	detection: {
		signatures: [{ bytes: YGA_SIGNATURE }, { bytes: EPF_SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yaneurao image");
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
				unpackedSize: layout.unpackedSize,
				compressed: layout.compressed,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yaneurao image");
		// The reference allocates the declared size, and a negative word would not allocate at all.
		if (layout.unpackedSize < 0 || layout.unpackedSize > MAX_UNPACKED_SIZE) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yaneurao image size");
		}
		const pixels: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
		if (layout.compressed) {
			const stored = Buffer.from(
				await source.readAt(
					BigInt(HEADER_SIZE),
					Number(source.size) - HEADER_SIZE,
				),
			);
			// The reference ignores what its reader returns, so a stream that stops early simply leaves the
			// rest of the buffer as it was allocated: zeroes.
			const decoded = inflateLzss(stored, {
				outputLength: layout.unpackedSize,
			});
			decoded.copy(pixels, 0, 0, Math.min(decoded.length, pixels.length));
		} else {
			const available = Math.min(
				layout.unpackedSize,
				Number(source.size) - HEADER_SIZE,
			);
			if (available > 0) {
				Buffer.from(await source.readAt(BigInt(HEADER_SIZE), available)).copy(
					pixels,
					0,
					0,
					available,
				);
			}
		}
		// The bitmap the reference builds has no stride of its own, so every row is a whole number of pixels;
		// a declared size that cannot supply them fails in its bitmap writer, and so it fails here.
		if (layout.unpackedSize < layout.width * layout.height * BYTES_PER_PIXEL) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Yaneurao image data is shorter than its bitmap",
			);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
