// Format reference: GARbro "ArcFormats/Ucom/ImageGPC.cs", class `GpcFormat` (For/Ucom image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `GP(` and a null, which is how the reference's little endian signature reads back. */
const MARKER: Buffer = Buffer.from([0x47, 0x50, 0x28, 0x00]);
const HEADER_SIZE = 0x26;
/** The pixels begin four bytes behind the header, whatever the header's own length word says. */
const DATA_OFFSET = 0x2a;
const DEPTHS = [8, 24, 32];
/** Palette entries are four bytes, blue first. */
const PALETTE_ENTRY_SIZE = 4;
/** An eight bit header that names no colours gets a full page of them. */
const DEFAULT_COLORS = 0x100;
/** Rows are aligned to four bytes and the alignment bytes are part of the stream. */
const ROW_ALIGN = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GpcLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Palette entries, which the header may leave for the reader to assume. */
	colors: number;
}

async function readLayout(source: ByteSource): Promise<GpcLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		const bitsPerPixel = header.readUInt16LE(0x10);
		// The reference refuses a depth outside its three here, so the probe is stricter than it looks.
		if (!DEPTHS.includes(bitsPerPixel)) return undefined;
		let colors = 0;
		if (bitsPerPixel === 8) {
			// Unlike the other reader with a colour count, this one does assume a full palette for a zero.
			colors = header.readInt32LE(0x22) || DEFAULT_COLORS;
		}
		return {
			width: header.readUInt32LE(6),
			height: header.readUInt32LE(0x0a),
			bitsPerPixel,
			colors,
		};
	} catch {
		return undefined;
	}
}

export const ucomGpcImageDescriptor: FormatDescriptor = {
	id: "ucom-gpc-image",
	name: "For/Ucom image",
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
			source: "ArcFormats/Ucom/ImageGPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ucomGpcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ucomGpcImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid For/Ucom image");
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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid For/Ucom image");
		const { width, height, bitsPerPixel, colors } = layout;
		if (width === 0 || height === 0 || colors < 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid For/Ucom image size");
		}
		const pixelSize = bitsPerPixel / 8;
		const stride = (width * pixelSize + ROW_ALIGN - 1) & ~(ROW_ALIGN - 1);
		const total = stride * height;
		if (
			total > MAX_IMAGE_BYTES ||
			colors * PALETTE_ENTRY_SIZE > MAX_IMAGE_BYTES
		) {
			throw new GarbroError("INVALID_ARCHIVE", "For/Ucom image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		let at = DATA_OFFSET;
		let palette: Buffer = Buffer.alloc(0);
		if (bitsPerPixel === 8) {
			const paletteSize = colors * PALETTE_ENTRY_SIZE;
			palette = Buffer.alloc(paletteSize, 0x00);
			if (at + paletteSize > file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated For/Ucom image");
			}
			file.copy(palette, 0, at, at + paletteSize);
			at += paletteSize;
		}
		// The reference fills its buffer from the last row up, so the buffer already reads top to bottom.
		const output: Buffer = Buffer.alloc(total, 0x00);
		const gap = stride - width * pixelSize;
		for (let row = total - stride; row >= 0; row -= stride) {
			let dst = row;
			let x = 0;
			while (x < width) {
				if (at >= file.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated For/Ucom image");
				}
				const control = file[at] ?? 0;
				at += 1;
				// One control byte names a whole token: its high seven bits are the pixel count less one.
				const count = (control >> 1) + 1;
				const run = pixelSize * count;
				if (dst + run > output.length || at + pixelSize > file.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"For/Ucom image data overruns the image",
					);
				}
				if ((control & 1) === 0) {
					if (at + run > file.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Truncated For/Ucom image",
						);
					}
					file.copy(output, dst, at, at + run);
					at += run;
				} else {
					// A set bit means one pixel follows and the rest of the run repeats it.
					for (let index = 0; index < pixelSize; index += 1) {
						output[dst + index] = file[at + index] ?? 0;
					}
					at += pixelSize;
					for (let index = pixelSize; index < run; index += 1) {
						output[dst + index] = output[dst + (index % pixelSize)] ?? 0;
					}
				}
				dst += run;
				x += count;
			}
			// The alignment bytes behind a row are stored, whatever they hold.
			if (at + gap > file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated For/Ucom image");
			}
			at += gap;
		}
		// The buffer's rows carry alignment bytes the reference keeps; a bitmap's own rows are tight here and
		// the shared writer pads them itself.
		const tight: Buffer = Buffer.alloc(width * pixelSize * height, 0x00);
		for (let row = 0; row < height; row += 1) {
			output.copy(
				tight,
				row * width * pixelSize,
				row * stride,
				row * stride + width * pixelSize,
			);
		}
		// The reference hands this image over as its buffer reads, so the bitmap is top down.
		if (bitsPerPixel === 8) {
			return Readable.from([
				writeBmp8Palette(width, height, tight, palette, false),
			]);
		}
		if (bitsPerPixel === 24) {
			return Readable.from([writeBmp24(width, height, tight, false)]);
		}
		return Readable.from([writeBmp32(width, height, tight, false)]);
	},
});
