// Format reference: GARbro "ArcFormats/Tactics/ImageTGF.cs", classes `TgfFormat`, `TgfMetaData` and
// `Reader` (Tactics graphics file). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** A word saying how long the bitmap is, and one saying how long a chunk of it is. */
const HEADER_SIZE = 8;
const BITMAP_SIZE_FIELD = 0;
const CHUNK_SIZE_FIELD = 4;
/** The largest bitmap the reference accepts, which is the word its own length field allows. */
const MAXIMUM_BITMAP_SIZE = 0xffffff;
/** The reference reads the measurements out of a buffer no smaller than this, and a little past the chunk. */
const METADATA_SIZE = 0x20;

export interface TgfLayout {
	bitmapSize: number;
	chunkSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * The reference's `TgfFormat.Reader.Unpack`: a stream of chunks steered by a byte, which either copies a run
 * of bytes, copies a count of chunks, or copies one chunk and repeats it.
 *
 * The three codes:
 *
 * * zero reads a length and as many bytes behind it;
 * * one reads a count and as many **chunks** behind it, so the run is that count times the chunk;
 * * anything else is a chunk copied once and then repeated until the code is used up.
 *
 * A run that would reach past the bitmap is cut short, and a chunk that would is where the stream stops.
 */
export function unpackTgf(
	stored: Buffer,
	start: number,
	bitmapSize: number,
	chunkSize: number,
): Buffer {
	const output: Buffer = Buffer.alloc(bitmapSize, 0x00);
	let cursor = start;
	let destination = 0;
	const byte = (): number => {
		if (cursor >= stored.length) return -1;
		const value = stored[cursor] ?? 0;
		cursor += 1;
		return value;
	};
	while (destination < output.length) {
		const code = byte();
		if (code < 0) break;
		if (0 === code || 1 === code) {
			const length = byte();
			if (length < 0) break;
			let count = 0 === code ? length : length * chunkSize;
			count = Math.min(count, output.length - destination);
			const available = Math.min(count, stored.length - cursor);
			stored.copy(output, destination, cursor, cursor + available);
			cursor += available;
			destination += count;
			continue;
		}
		if (destination + chunkSize > output.length) break;
		const available = Math.min(chunkSize, stored.length - cursor);
		stored.copy(output, destination, cursor, cursor + available);
		cursor += available;
		const source = destination;
		destination += chunkSize;
		for (let i = 1; i < code; i += 1) {
			if (destination + chunkSize > output.length) return output;
			output.copy(output, destination, source, source + chunkSize);
			destination += chunkSize;
		}
	}
	return output;
}

/**
 * The reference's `TgfFormat.ReadMetaData`: the length of the bitmap and the length of a chunk, then a buffer
 * just long enough for the header of the bitmap, which is unpacked out of the stream.
 */
export async function readTgfLayout(
	source: ByteSource,
): Promise<TgfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	const bitmapSize = header.readUInt32LE(BITMAP_SIZE_FIELD);
	const chunkSize = header.readInt32LE(CHUNK_SIZE_FIELD);
	if (
		bitmapSize > MAXIMUM_BITMAP_SIZE ||
		chunkSize <= 0 ||
		bitmapSize < chunkSize
	) {
		return undefined;
	}
	const prefix = unpackTgf(
		Buffer.from(await source.readAt(0n, Number(source.size))),
		HEADER_SIZE,
		Math.max(METADATA_SIZE, chunkSize + 2),
		chunkSize,
	);
	const fields = readBmpHeaderFields(prefix);
	if (!fields) return undefined;
	return { bitmapSize, chunkSize, ...fields };
}

export const tacticsTgfImageDescriptor: FormatDescriptor = {
	id: "tactics-tgf-image",
	name: "Tactics graphics file",
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
			source: "ArcFormats/Tactics/ImageTGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tacticsTgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tacticsTgfImageDescriptor,
	// The reference registers no signature: every file that reaches it is tried against the header walk.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readTgfLayout(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readTgfLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tactics picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(HEADER_SIZE),
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							bitmapSize: layout.bitmapSize,
							chunkSize: layout.chunkSize,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "tactics-chunks",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const layout = await readTgfLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tactics picture");
		}
		const unpacked = unpackTgf(
			Buffer.from(await source.readAt(0n, Number(source.size))),
			HEADER_SIZE,
			layout.bitmapSize,
			layout.chunkSize,
		);
		const image = readBmpImage(unpacked);
		if (!image) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Tactics picture holds no bitmap",
			);
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
