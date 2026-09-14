// Format reference: GARbro "ArcFormats/Silky/ImageIGF.cs", class `IgfFormat` (Silky's image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference's word `0x5355455A`: `ZEUS`. */
const SIGNATURE: Buffer = Buffer.from("ZEUS", "latin1");
const EXTENSIONS: string[] = [];
const HEADER_SIZE = 0x14;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const UNPACKED_SIZE_FIELD = 0x0c;
const FLAGS_FIELD = 0x10;
/** The depth is the low byte of the flags, and a zero there means thirty two bits. */
const DEPTH_MASK = 0xff;
const DEFAULT_DEPTH = 32;
/** The high bit says the pixels behind the header are packed. */
const PACKED_BIT = 0x80000000;
/** The reference's `LzssReader` is given this frame fill rather than the library's zero. */
const FRAME_FILL = 0x20;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface IgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
	packed: boolean;
}

/** The stride the reference takes: the width in pixels times the depth in bytes. */
function strideOf(layout: IgfLayout): number {
	return (layout.width * layout.bitsPerPixel) / 8;
}

async function readLayout(source: ByteSource): Promise<IgfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
		const flags = header.readInt32LE(FLAGS_FIELD);
		const packed = (flags & PACKED_BIT) !== 0;
		let bitsPerPixel = flags & DEPTH_MASK;
		if (bitsPerPixel === 0) bitsPerPixel = DEFAULT_DEPTH;
		const layout: IgfLayout = {
			width,
			height,
			bitsPerPixel,
			unpackedSize,
			packed,
		};
		if (strideOf(layout) * height > MAX_IMAGE_BYTES) return undefined;
		if (packed && unpackedSize <= 0) return undefined;
		return layout;
	} catch {
		return undefined;
	}
}

export const silkyIgfImageDescriptor: FormatDescriptor = {
	id: "silky-igf-image",
	name: "Silky's image",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/Silky/ImageIGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const silkyIgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyIgfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const metadata: Record<string, unknown> = {
			type: "image",
			width: layout.width,
			height: layout.height,
			bitsPerPixel: layout.bitsPerPixel,
			packed: layout.packed,
		};
		if (layout.packed) metadata.unpackedSize = layout.unpackedSize;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: layout.packed,
				metadata,
			}),
			sizeKnown: !layout.packed,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.packed ? "lzss" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's image");
		const { width, height, bitsPerPixel } = layout;
		const stride = strideOf(layout);
		const needed = stride * height;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		let pixels: Buffer;
		if (layout.packed) {
			// The reference's `LzssReader` differs from the library's stream only in the byte its frame starts
			// with, which is why the codec takes it as a setting.
			pixels = await inflateLzss(file.subarray(HEADER_SIZE), {
				outputLength: layout.unpackedSize,
				frameFill: FRAME_FILL,
			});
			if (pixels.length !== needed) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Silky's image does not unpack to its own size",
				);
			}
		} else {
			const body = file.subarray(HEADER_SIZE);
			if (body.length < needed) {
				throw new GarbroError("INVALID_ARCHIVE", "Silky's image is truncated");
			}
			pixels = Buffer.from(body.subarray(0, needed));
		}
		// `ImageData.CreateFlipped`: the stored rows are bottom up, so the bitmap keeps a positive height.
		let bitmap: Buffer;
		if (bitsPerPixel === 24) {
			bitmap = writeBmp24(width, height, pixels, true);
		} else if (bitsPerPixel === 32) {
			bitmap = writeBmp32(width, height, pixels, true);
		} else if (bitsPerPixel === 8) {
			// Anything that is neither twenty four nor thirty two bits is handed to a grey bitmap, which only
			// fits when the depth really is eight bits: any other one leaves a buffer the bitmap cannot take.
			bitmap = writeBmp8(width, height, pixels, true);
		} else {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Not supported Silky's image depth: ${bitsPerPixel}`,
			);
		}
		return Readable.from([bitmap]);
	},
});
