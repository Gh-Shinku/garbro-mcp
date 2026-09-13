// Format reference: GARbro "Legacy/hmp/ImageCBF.cs", class `CbfFormat` (an uncompressed 16 bit 555 bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `MA-C`, the first four characters of the header text. */
const SIGNATURE = Buffer.from([0x4d, 0x41, 0x2d, 0x43]);
const HEADER_SIZE = 0x1c;
const MAGIC = Buffer.from("MA-CBF", "ascii");
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
/** The pixel data starts eight bytes past the header that `ReadMetaData` reads. */
const PIXEL_OFFSET = 0x24;
const BYTES_PER_PIXEL = 2;

interface CbfLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads the header, compares the `MA-CBF` text and takes the dimensions. It does not look at
 * the pixel data, so a file whose pixels are short still lists.
 */
async function readLayout(source: ByteSource): Promise<CbfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would accept a zero sized image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const cbfImageDescriptor: FormatDescriptor = {
	id: "hmp-cbf-image",
	name: "h.m.p image format",
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
			source: "Legacy/hmp/ImageCBF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cbfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cbfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid h.m.p CBF image");
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
					// The source pixels are fifteen bit, which a bitmap records as sixteen.
					bitsPerPixel: 15,
				} as Record<string, unknown>,
			}),
			// The pixels are copied from a fixed offset and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid h.m.p CBF image");
		const needed = layout.width * BYTES_PER_PIXEL * layout.height;
		const available = Math.max(0, Number(source.size) - PIXEL_OFFSET);
		// `Read` ignores the count it gets back, so an exhausted file yields the zero filled buffer it
		// allocated rather than an error. `readAt` throws on a short read, hence the explicit clamp.
		const take = Math.min(needed, available);
		const stored =
			take > 0
				? await source.readAt(BigInt(PIXEL_OFFSET), take)
				: Buffer.alloc(0);
		const pixels = Buffer.alloc(needed);
		Buffer.from(stored).copy(pixels, 0, 0, take);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, true),
		]);
	},
});
