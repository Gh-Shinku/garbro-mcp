// Format reference: GARbro "ArcFormats/StudioEgo/ImageANT.cs", class `AntFormat` (Studio e.go! bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'ANTI'`. */
const SIGNATURE = Buffer.from([0x41, 0x4e, 0x54, 0x49]);
const HEADER_SIZE = 0x18;
const PIXEL_OFFSET = HEADER_SIZE;
/** The depth is not stored; this format is always four bytes a pixel. */
const BYTES_PER_PIXEL = 4;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface AntLayout {
	width: number;
	height: number;
}

/** `ReadMetaData` reads three fields and validates none of them, not even the dimensions. */
async function readFields(source: ByteSource): Promise<AntLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const width = head.readUInt32LE(0xc);
		const height = head.readUInt32LE(0x10);
		if (width * height > MAX_PIXEL_BYTES / BYTES_PER_PIXEL) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

/**
 * The reference's loop, with its row structure intact. The outer loop runs once a row and the inner loop fills
 * the whole buffer, so the `00 00` pair that ends a row is the only thing that separates rows — and the write
 * position is **not** reset, so the rows are nominal: a stream with fewer markers than rows simply continues
 * into the next row, and one that stops early leaves the rest of the buffer zeroed, which reads as transparency.
 *
 * Two ways of leaving the buffer are asymmetric, and the port keeps both. A **skip** run adds four bytes a pixel
 * to the position without touching the buffer, so a skip past the end is harmless — the loop simply ends. A
 * **literal** writes three bytes and then an alpha byte four places from the position, so a literal starting in
 * the last three bytes of the buffer indexes out of range and throws, which is what the reference does.
 */
function unpackPixels(stored: Buffer, length: number, rows: number): Buffer {
	const pixels: Buffer = Buffer.alloc(length, 0x00);
	let position = 0;
	let dst = 0;
	for (let row = 0; row < rows; row += 1) {
		while (dst < length) {
			if (position >= stored.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated ANT image");
			const alpha = stored[position++] ?? 0;
			if (alpha === 0) {
				if (position >= stored.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated ANT image");
				const count = stored[position++] ?? 0;
				if (count === 0) break;
				dst += count * BYTES_PER_PIXEL;
			} else {
				if (dst + 3 >= length)
					throw new GarbroError("INVALID_ARCHIVE", "ANT pixel overrun");
				if (position + 3 > stored.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated ANT image");
				pixels[dst] = stored[position] ?? 0;
				pixels[dst + 1] = stored[position + 1] ?? 0;
				pixels[dst + 2] = stored[position + 2] ?? 0;
				pixels[dst + 3] = alpha;
				position += 3;
				dst += BYTES_PER_PIXEL;
			}
		}
	}
	return pixels;
}

export const antImageDescriptor: FormatDescriptor = {
	id: "studio-ego-ant-image",
	name: "Studio e.go! bitmap",
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
			source: "ArcFormats/StudioEgo/ImageANT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const antImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: antImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio e.go! bitmap");
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
					bitsPerPixel: 32,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio e.go! bitmap");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		const pixels = unpackPixels(
			stored,
			layout.width * layout.height * BYTES_PER_PIXEL,
			layout.height,
		);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
