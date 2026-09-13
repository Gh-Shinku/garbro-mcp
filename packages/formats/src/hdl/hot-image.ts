// Format reference: GARbro "Legacy/Hdl/ImageHOT.cs", class `HotFormat` (a fifteen bit image with a run length
// step). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { RGB555_MASKS, writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `HOT`, which the archive of the same name shares. */
const SIGNATURE = Buffer.from([0x48, 0x4f, 0x54]);
const HEADER_SIZE = 0x20;
const WIDTH_OFFSET = 0x0c;
const HEIGHT_OFFSET = 0x0e;
const FLAG_OFFSET = 7;
/** `(header[7] & 0x21) == 0x21`. */
const FLAG_MASK = 0x21;
const PIXEL_OFFSET = 0x20;
const REPEAT_MASK = 0x7fff;

interface HotLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads thirty two bytes and accepts the file when bits 0 and 5 of byte seven are both set.
 * The depth is always fifteen, which is the notable part of this format: the words are stored as 555 with no
 * sixth green bit, so the bitmap the port writes is a sixteen bit bitmap whose masks say 555.
 */
async function readLayout(source: ByteSource): Promise<HotLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 3).equals(SIGNATURE)) return undefined;
		if (((header[FLAG_OFFSET] ?? 0) & FLAG_MASK) !== FLAG_MASK)
			return undefined;
		const width = header.readUInt16LE(WIDTH_OFFSET);
		const height = header.readUInt16LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

/**
 * The stream is a sequence of sixteen bit words. A word whose top bit is clear is one pixel; a word whose top
 * bit is set carries a colour in its low fifteen bits and is followed by a byte saying how many pixels of that
 * colour to write.
 *
 * Three of the reference's edges are preserved: the outer loop stops at the end of the image **or** at the end
 * of the stream, so a truncated file simply leaves the remaining pixels zero; the inner repeat loop has no such
 * check, so a run that would pass the end of the image throws, as indexing the pixel array does in the
 * reference; and the loop only asks whether one byte remains before reading a word, so an odd trailing byte
 * throws as well.
 *
 * `stored` is the file from the pixel offset onward, so the walk starts at its first byte.
 */
function unpackHot(stored: Buffer, count: number): Buffer {
	const pixels: Buffer = Buffer.alloc(count * 2);
	let position = 0;
	let dst = 0;
	while (dst < count && position < stored.length) {
		if (position + 2 > stored.length)
			throw new Error("Unexpected end of HDL HOT image");
		const word = stored.readInt16LE(position);
		position += 2;
		if (word >= 0) {
			pixels.writeUInt16LE(word, dst * 2);
			dst += 1;
			continue;
		}
		const colour = word & REPEAT_MASK;
		if (position >= stored.length)
			throw new Error("Unexpected end of HDL HOT image");
		const run = stored[position++] ?? 0;
		for (let i = 0; i < run; i += 1) {
			if (dst >= count)
				throw new Error("HDL HOT run passes the end of the image");
			pixels.writeUInt16LE(colour, dst * 2);
			dst += 1;
		}
	}
	return pixels;
}

export const hotImageDescriptor: FormatDescriptor = {
	id: "hdl-hot-image",
	name: "HDL engine image",
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
			source: "Legacy/Hdl/ImageHOT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hotImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hotImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HDL HOT image");
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
					bitsPerPixel: 15,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "hot-rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 15,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HDL HOT image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		let pixels: Buffer;
		try {
			pixels = unpackHot(stored, layout.width * layout.height);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated HDL HOT image");
		}
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, false, RGB555_MASKS),
		]);
	},
});
