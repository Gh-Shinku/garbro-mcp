// Format reference: GARbro "ArcFormats/Valkyria/ImageMAL.cs", class `MalFormat` (an eight bit mask with a
// packet stream of raw runs and repeated bytes). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `MICO`. */
const SIGNATURE = Buffer.from("MICO", "ascii");
/** `MSK00` at offset four. */
const MARKER = Buffer.from("MSK00", "ascii");
const MARKER_OFFSET = 4;
const HEADER_SIZE = 0xe;
const WIDTH_OFFSET = 0xa;
const HEIGHT_OFFSET = 0xc;
const PIXEL_OFFSET = 0xe;
/** A count above this copies raw bytes; the low fifteen bits are the count either way. */
const RAW_FLAG = 0x7fff;
/**
 * The reference allocates fifteen bytes more than the image needs, so a run that reaches a little past the end
 * writes into that slack instead of throwing. A run that reaches further than fifteen bytes still throws.
 */
const SLACK = 15;

interface MalLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads fourteen bytes, requires `MSK00` at offset four, and takes the dimensions from the last
 * four; the depth is always eight.
 */
async function readLayout(source: ByteSource): Promise<MalLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (
			!header
				.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length)
				.equals(MARKER)
		)
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
 * The stream is a sequence of sixteen bit counts. A count above 0x7FFF carries raw bytes in its low fifteen
 * bits; any other count is followed by one byte to repeat that many times. The walk stops when the image is
 * full, and the three tolerances the reference has are kept:
 *
 * * a raw run that runs out of stream copies what there is — the reference does not check the count `Read`
 *   returns — and still moves the write position by the count it asked for, leaving the rest zero;
 * * a repeat may write up to fifteen bytes past the end, into the slack the reference allocates;
 * * a repeat that reaches further than that throws, as writing past the end of the array does in the
 *   reference. Note that a count of zero is harmless: it consumes a byte and writes nothing.
 */
function unpackMal(stored: Buffer, total: number): Buffer {
	const pixels: Buffer = Buffer.alloc(total + SLACK);
	let position = 0;
	let dst = 0;
	while (dst < total) {
		if (position + 2 > stored.length)
			throw new Error("Unexpected end of Valkyria MAL mask");
		const count = stored.readUInt16LE(position);
		position += 2;
		if (count > RAW_FLAG) {
			const run = count & RAW_FLAG;
			const available = Math.max(0, Math.min(run, stored.length - position));
			if (available > 0) {
				stored.copy(pixels, dst, position, position + available);
				position += available;
			}
			dst += run;
			continue;
		}
		if (position >= stored.length)
			throw new Error("Unexpected end of Valkyria MAL mask");
		const value = stored[position++] ?? 0;
		for (let i = 0; i < count; i += 1) {
			if (dst >= pixels.length)
				throw new Error("Valkyria MAL run passes the end of the slack");
			pixels[dst++] = value;
		}
	}
	// The slack is never part of the image, whatever a run wrote there.
	return pixels.subarray(0, total);
}

export const malImageDescriptor: FormatDescriptor = {
	id: "valkyria-mal-image",
	name: "Valkyria mask image",
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
			source: "ArcFormats/Valkyria/ImageMAL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const malImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: malImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Valkyria MAL mask");
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
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "mal-rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Valkyria MAL mask");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				Number(source.size) - PIXEL_OFFSET,
			),
		);
		let pixels: Buffer;
		try {
			pixels = unpackMal(stored, layout.width * layout.height);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Valkyria MAL mask");
		}
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
