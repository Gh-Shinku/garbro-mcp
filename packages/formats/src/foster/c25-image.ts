// Format reference: GARbro "ArcFormats/Foster/ImageC25.cs", classes `C25Format` and `C25Decoder`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readC24ImageLayout, readC24RowOffsets } from "./c24-image.js";

const C25_SIGNATURE: Buffer = Buffer.from([0x43, 0x32, 0x35, 0x00]);
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
/** A count byte above this asks for pixels written as they stand. */
const LITERAL_MARK = 0x7f;
/** What a literal count is counted from, and the second mark that says a pixel has four bytes. */
const THREE_BYTE_MARK = 0x80;
const FOUR_BYTE_MARK = 0x70;
/** The byte a pixel written from three bytes is given for an alpha channel. */
const OPAQUE = 0xff;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/**
 * The reference's decoder for its thirty two bit images. A row is a series of runs, each one a single byte that
 * says what kind it is and how many pixels it covers:
 *
 * * **above `0x7F`** the pixels are taken from the file as they stand, three bytes a pixel with an alpha byte of
 *   `0xFF` written behind each one, or four bytes a pixel when the count was that much higher again;
 * * **at or below `0x7F`** the pixels are **skipped**: nothing is written and nothing is read, so they stay at
 *   the nothing the buffer was given;
 * * in either kind a count of nothing after the mark is taken off means the real count is the word behind it.
 *
 * The cursor runs on across rows exactly as it does for the twenty four bit images, and a **skipped** run walks
 * it past the end of the image without writing anything — which is not an error unless a pixel is written there
 * afterwards.
 */
export function unpackC25Rows(
	file: Buffer,
	rows: number[],
	width: number,
	output: Buffer,
): void {
	let dst = 0;
	for (const rowOffset of rows) {
		let at = rowOffset;
		for (let x = 0; x < width; ) {
			if (at >= file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated BeF image row");
			}
			let count = file[at] ?? 0;
			at += 1;
			if (count > LITERAL_MARK) {
				let bytesPerPixel = 3;
				count -= THREE_BYTE_MARK;
				if (count >= FOUR_BYTE_MARK) {
					bytesPerPixel = BYTES_PER_PIXEL;
					count -= FOUR_BYTE_MARK;
				}
				if (count === 0) {
					if (at + 2 > file.length) {
						throw new GarbroError("INVALID_ARCHIVE", "Truncated BeF image run");
					}
					count = (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
					at += 2;
				}
				for (let pixel = 0; pixel < count; pixel += 1) {
					if (dst + bytesPerPixel > output.length) {
						throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF image run");
					}
					const available = Math.min(
						bytesPerPixel,
						Math.max(0, file.length - at),
					);
					if (available > 0) file.copy(output, dst, at, at + available);
					at += available;
					dst += bytesPerPixel;
					if (bytesPerPixel === 3) {
						if (dst >= output.length) {
							throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF image run");
						}
						output[dst] = OPAQUE;
						dst += 1;
					}
				}
			} else {
				if (count === 0) {
					if (at + 2 > file.length) {
						throw new GarbroError("INVALID_ARCHIVE", "Truncated BeF image run");
					}
					count = (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
					at += 2;
				}
				// A run of pixels that is skipped writes nothing at all, so the cursor may walk past the end.
				dst += count * BYTES_PER_PIXEL;
			}
			x += count;
		}
	}
}

export const fosterC25ImageDescriptor: FormatDescriptor = {
	id: "foster-c25-image",
	name: "BeF game engine image",
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
			source: "ArcFormats/Foster/ImageC25.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fosterC25ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fosterC25ImageDescriptor,
	detection: { signatures: [{ bytes: C25_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (
			(await readC24ImageLayout(source, BITS_PER_PIXEL, C25_SIGNATURE)) !==
			undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readC24ImageLayout(
			source,
			BITS_PER_PIXEL,
			C25_SIGNATURE,
		);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					dataOffset: layout.dataOffset,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "run-length",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readC24ImageLayout(
			source,
			BITS_PER_PIXEL,
			C25_SIGNATURE,
		);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF image");
		const { width, height, dataOffset } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const rows = readC24RowOffsets(file, dataOffset, height);
		const pixels: Buffer = Buffer.alloc(width * height * BYTES_PER_PIXEL, 0x00);
		unpackC25Rows(file, rows, width, pixels);
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
