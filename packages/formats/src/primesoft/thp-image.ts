// Format reference: GARbro "Legacy/PrimeSoft/ImageTHP.cs", class `ThpFormat` (Prime Soft indexed image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeHeader } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** Two dimension words. */
const HEADER_SIZE = 4;
/** A plain forty byte bitmap header. */
const BMP_HEADER_SIZE = 54;
/** `Signature` is zero, so the extension is the only tag and the port checks it in the layout reader. */
const REQUIRED_EXTENSION = "thp";
const PALETTE_COLORS = 0x100;
const PALETTE_SIZE = PALETTE_COLORS * 3;
const PIXEL_OFFSET = HEADER_SIZE + PALETTE_SIZE;
const MAX_DIMENSION = 0x4000;

interface ThpLayout {
	width: number;
	height: number;
	/** `(width + 3) & ~3`, the only stride the reference ever computes. */
	stride: number;
}

/**
 * `ReadMetaData` reads four bytes and takes the dimensions from the first **word twice**: the second
 * `ToUInt16` call also passes zero, so the height is whatever the width is and the word at offset two is never
 * looked at. That is a bug in the reference, and it decides how many pixels the decoder reads, so the port
 * reproduces it rather than fixing it. The validation then checks the same value four times.
 */
async function readFields(source: ByteSource): Promise<ThpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = head.readUInt16LE(0);
		const height = head.readUInt16LE(0);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		return { width, height, stride: (width + 3) & ~3 };
	} catch {
		return undefined;
	}
}

/** The extension gate belongs to detection, so the field reader stays free of it. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<ThpLayout | undefined> {
	if (sourceExtension(sourcePath) !== REQUIRED_EXTENSION) return undefined;
	return readFields(source);
}

/**
 * The reference's loop, byte for byte: read a pixel, peek at the next byte without consuming it, and if they are
 * equal consume it and read a count byte whose value plus one says how many times to write the pixel. The write
 * is unchecked, so it throws when it passes the end of the buffer.
 */
function unpackPixels(
	stored: Buffer,
	length: number,
	capacity: number,
): Buffer {
	const pixels: Buffer = Buffer.alloc(capacity, 0x00);
	let position = 0;
	let dst = 0;
	while (dst < length) {
		if (position >= stored.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Prime Soft image");
		const px = stored[position++] ?? 0;
		// `PeekByte` reports the end of the stream as minus one, which never equals a pixel value.
		const next = position < stored.length ? (stored[position] ?? -1) : -1;
		if (px === next) {
			position += 1;
			if (position >= stored.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Prime Soft image");
			const count = (stored[position++] ?? 0) + 1;
			for (let i = 0; i < count; i += 1) {
				if (dst >= capacity)
					throw new GarbroError("INVALID_ARCHIVE", "Prime Soft image overrun");
				pixels[dst++] = px;
			}
		} else {
			if (dst >= capacity)
				throw new GarbroError("INVALID_ARCHIVE", "Prime Soft image overrun");
			pixels[dst++] = px;
		}
	}
	return pixels;
}

export const thpImageDescriptor: FormatDescriptor = {
	id: "primesoft-thp-image",
	name: "Prime Soft image",
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
			source: "Legacy/PrimeSoft/ImageTHP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const thpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: thpImageDescriptor,
	// No signature, so the format is a candidate for every file and the extension check keeps it cheap.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Prime Soft image");
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
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// The extraction is decompressed, so its length is not the stored length.
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
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Prime Soft image");
		if (source.size < BigInt(PIXEL_OFFSET))
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Prime Soft image");
		const palette = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), PALETTE_SIZE),
		);
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		const capacity = layout.height * layout.stride;
		const pixels = unpackPixels(stored, layout.height * layout.width, capacity);
		// The reference declares the palette `Bgr`, so the stored triples are already in the order a bitmap
		// wants; the bytes are carried through as they stand, unlike WBM and LGF where `Rgb`/`RgbX` forced a
		// red-blue swap. `ImageData.CreateFlipped` is bottom up, which a bitmap records as a positive height.
		const imageSize = capacity;
		const bitmapPalette: Buffer = Buffer.alloc(PALETTE_COLORS * 4, 0x00);
		for (let i = 0; i < PALETTE_COLORS; i += 1) {
			palette.copy(bitmapPalette, i * 4, i * 3, i * 3 + 3);
		}
		// The decoder fills its buffer contiguously and never skips the padding, so the buffer it hands to the
		// bitmap is carried through verbatim rather than repacked: for a width that is not a multiple of four
		// the rows drift into the padding, exactly as they do in the reference.
		return Readable.from([
			Buffer.concat([
				writeHeader(
					layout.width,
					layout.height,
					8,
					BMP_HEADER_SIZE + bitmapPalette.length,
					imageSize,
					PALETTE_COLORS,
					true,
				),
				bitmapPalette,
				pixels,
			]),
		]);
	},
});
