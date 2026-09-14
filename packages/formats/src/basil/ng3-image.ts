// Format reference: GARbro "ArcFormats/Basil/ImageNG3.cs", class `Ng3Format` (BasiL image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `NG3` and a null: the reference compares a whole little endian word, so the fourth byte counts. */
const MARKER: Buffer = Buffer.from([0x4e, 0x47, 0x33, 0x00]);
const HEADER_SIZE = 0x0c;
/** A run of colour triples behind the header, which the pixel stream then refers to. */
const PALETTE_ENTRIES = 0x100;
const PALETTE_ENTRY_SIZE = 3;
const PALETTE_BYTES = PALETTE_ENTRIES * PALETTE_ENTRY_SIZE;
/** One pixel is three bytes wherever it comes from. */
const BYTES_PER_PIXEL = 3;
/** The control bytes that introduce one colour or a run of them. */
const SINGLE_PIXEL = 1;
const RUN_PIXEL = 2;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface Ng3Layout {
	width: number;
	height: number;
}

async function readLayout(source: ByteSource): Promise<Ng3Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		return {
			width: header.readUInt32LE(4),
			height: header.readUInt32LE(8),
		};
	} catch {
		return undefined;
	}
}

export const basilNg3ImageDescriptor: FormatDescriptor = {
	id: "basil-ng3-image",
	name: "BasiL image",
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
			source: "ArcFormats/Basil/ImageNG3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const basilNg3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: basilNg3ImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BasiL image");
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
					bitsPerPixel: 24,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BasiL image");
		const { width, height } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BasiL image size");
		}
		const stride = width * BYTES_PER_PIXEL;
		const size = stride * height;
		if (size > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "BasiL image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (file.length < HEADER_SIZE + PALETTE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated BasiL image palette");
		}
		const palette = file.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_BYTES);
		// The reference fills a fresh buffer, so anything the stream never reaches stays black.
		const pixels: Buffer = Buffer.alloc(size, 0x00);
		let at = HEADER_SIZE + PALETTE_BYTES;
		let dst = 0;
		const putPixel = (index: number): void => {
			pixels[dst] = palette[index * PALETTE_ENTRY_SIZE] ?? 0;
			pixels[dst + 1] = palette[index * PALETTE_ENTRY_SIZE + 1] ?? 0;
			pixels[dst + 2] = palette[index * PALETTE_ENTRY_SIZE + 2] ?? 0;
			dst += BYTES_PER_PIXEL;
		};
		while (dst < pixels.length) {
			// The reference peeks, so a stream that ends here simply stops the image.
			if (at >= file.length) break;
			const control = file[at] ?? 0;
			if (control === SINGLE_PIXEL) {
				at += 1;
				putPixel(file[at++] ?? 0);
			} else if (control === RUN_PIXEL) {
				at += 1;
				const index = file[at++] ?? 0;
				const count = file[at++] ?? 0;
				if (dst + count * BYTES_PER_PIXEL > pixels.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"BasiL image run overruns the image",
					);
				}
				for (let index2 = 0; index2 < count; index2 += 1) putPixel(index);
			} else {
				// A raw triple. The reference does not check the read, so a short one leaves zeros.
				const available = Math.min(BYTES_PER_PIXEL, file.length - at);
				file.copy(pixels, dst, at, at + available);
				at += available;
				dst += BYTES_PER_PIXEL;
			}
		}
		// The reference hands this image over flipped, so the bitmap's height is positive.
		return Readable.from([writeBmp24(width, height, pixels, true)]);
	},
});
