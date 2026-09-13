// Format reference: GARbro "Legacy/ProjectMyu/ImageKGR.cs", class `KgrFormat` (a bitmap whose meaningful
// header fields sit at their usual offsets but whose size fields are ignored). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { RGB565_MASKS, writeBmp16, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The bitmap marker, which the format keeps in place. */
const SIGNATURE = Buffer.from([0x42, 0x4d]);
const HEADER_SIZE = 0x36;
const WIDTH_OFFSET = 0x12;
const HEIGHT_OFFSET = 0x16;
const BPP_OFFSET = 0x1c;
const SUPPORTED_BPP = [16, 24];
/** A bound on the pixel buffer, which the reference does not impose. */
const MAX_PIXELS = 0x10000000;

interface KgrLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	bytesPerRow: number;
}

/**
 * `ReadMetaData` gates on the extension, checks the bitmap marker and reads the depth from the position a
 * sixteen or twenty four bit bitmap would keep it, then reads the dimensions from the positions a bitmap
 * keeps those. It never looks at the *size* fields at offsets two and ten, and the pixels are taken from
 * offset `0x36` regardless of the offset field, so those two words are inert here — a test writes nonsense
 * into both and expects the image to decode anyway.
 */
async function readLayout(source: ByteSource): Promise<KgrLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 2).equals(SIGNATURE)) return undefined;
		const bitsPerPixel = header.readUInt16LE(BPP_OFFSET);
		if (!SUPPORTED_BPP.includes(bitsPerPixel)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		const bytesPerRow = (width * bitsPerPixel) / 8;
		const needed = bytesPerRow * height;
		if (needed > MAX_PIXELS) return undefined;
		return { width, height, bitsPerPixel, bytesPerRow };
	} catch {
		return undefined;
	}
}

export const kgrImageDescriptor: FormatDescriptor = {
	id: "project-myu-kgr-image",
	name: "Project-Myu obfuscated bitmap",
	extensions: ["kgr"],
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
			source: "Legacy/ProjectMyu/ImageKGR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kgrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kgrImageDescriptor,
	// The reference declares no signature and gates on the `.kgr` extension.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "kgr") return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Project-Myu KGR image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the copied pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				bytesPerRow: layout.bytesPerRow,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Project-Myu KGR image");
		const needed = layout.bytesPerRow * layout.height;
		// `ReadBytes` throws when the stream cannot supply the count, so a short file fails here rather than
		// being zero filled.
		if (source.size < BigInt(HEADER_SIZE + needed))
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated Project-Myu KGR image",
			);
		const pixels = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), needed),
		);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		// The stored rows are packed, with no row alignment.
		if (layout.bitsPerPixel === 16) {
			// `PixelFormats.Bgr565` is six green bits, not the five the other sixteen bit ports use.
			return Readable.from([
				writeBmp16(layout.width, layout.height, pixels, true, RGB565_MASKS),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
