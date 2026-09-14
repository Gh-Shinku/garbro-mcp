// Format reference: GARbro "ArcFormats/Interheart/ImageBMP.cs", class `BmpRleFormat` (Candy Soft RLE bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference registers the word `0x32504D42` — `BMP2` — and then compares eight characters, `BMP24RLE`.
 * The comment in the reference hopes the eight and sixteen bit flavours share the algorithm, but only this one
 * can be reached: a `BMP08RLE` file does not begin with a registered word.
 */
const SIGNATURE: Buffer = Buffer.from("BMP2", "latin1");
const MARKER: Buffer = Buffer.from("BMP24RLE", "latin1");
const HEADER_SIZE = 0x26;
const MARKER_SIZE = 8;
const UNPACKED_SIZE_FIELD = 0x0a;
const BITMAP_HEADER_FIELD = 0x12;
const WIDTH_FIELD = 0x1a;
const HEIGHT_FIELD = 0x1e;
const DEPTH_FIELD = 0x24;
const PIXEL_SIZE = 3;
const MAX_BITMAP_BYTES = 256 * 1024 * 1024;

interface BmpRleLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Bytes of the bitmap that the file carries outright, a whole BMP header. */
	bitmapHeaderSize: number;
	/** The size of the bitmap the run length data expands to, header included. */
	unpackedSize: number;
}

async function readLayout(
	source: ByteSource,
): Promise<BmpRleLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, MARKER_SIZE).equals(MARKER)) return undefined;
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
		const bitmapHeaderSize = header.readInt32LE(BITMAP_HEADER_FIELD);
		// The reference copies the header straight into a buffer of the unpacked size, so both ends of that
		// copy have to be sound before the file means anything.
		if (unpackedSize <= 0 || unpackedSize > MAX_BITMAP_BYTES) return undefined;
		if (bitmapHeaderSize < 0 || bitmapHeaderSize > unpackedSize)
			return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		const bitsPerPixel = header.readUInt16LE(DEPTH_FIELD);
		return { width, height, bitsPerPixel, bitmapHeaderSize, unpackedSize };
	} catch {
		return undefined;
	}
}

export const interheartBmpRleImageDescriptor: FormatDescriptor = {
	id: "interheart-bmp-rle-image",
	name: "Candy Soft RLE bitmap",
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
			source: "ArcFormats/Interheart/ImageBMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const interheartBmpRleImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: interheartBmpRleImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Candy Soft bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: BigInt(layout.unpackedSize),
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
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Candy Soft bitmap");
		const { bitmapHeaderSize, unpackedSize } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The bitmap that comes out of this is a whole BMP file: its header is carried in the source behind the
		// marker and is copied straight over, and the runs describe the pixels that follow it.
		const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
		file.copy(
			output,
			0,
			MARKER_SIZE,
			Math.min(file.length, MARKER_SIZE + bitmapHeaderSize),
		);
		let position = MARKER_SIZE + bitmapHeaderSize;
		const readTriple = (): Buffer => {
			// A short read leaves the rest of the triple as it is in the reference, which is a buffer it reuses;
			// the port fills what is missing with zeroes.
			const triple: Buffer = Buffer.alloc(PIXEL_SIZE, 0x00);
			const available = Math.max(
				0,
				Math.min(PIXEL_SIZE, file.length - position),
			);
			if (available > 0) file.copy(triple, 0, position, position + available);
			position += PIXEL_SIZE;
			return triple;
		};
		const readCount = (): number => {
			const pair: Buffer = Buffer.alloc(2, 0x00);
			const available = Math.max(0, Math.min(2, file.length - position));
			if (available > 0) file.copy(pair, 0, position, position + available);
			position += 2;
			return pair.readUInt16LE(0);
		};
		let triple = readTriple();
		let destination = bitmapHeaderSize;
		while (destination + PIXEL_SIZE <= output.length) {
			const [r, g, b] = [triple[0] ?? 0, triple[1] ?? 0, triple[2] ?? 0];
			output[destination] = b;
			output[destination + 1] = g;
			output[destination + 2] = r;
			destination += PIXEL_SIZE;
			triple = readTriple();
			if (r === triple[0] && g === triple[1] && b === triple[2]) {
				// Two identical pixels introduce a run: one more copy of the same pixel, then a count of further
				// ones. The reference writes the count without looking at the buffer, so a run that does not fit
				// fails there; the port says so instead.
				if (destination + PIXEL_SIZE > output.length) break;
				output[destination] = b;
				output[destination + 1] = g;
				output[destination + 2] = r;
				destination += PIXEL_SIZE;
				const count = readCount();
				for (let index = 0; index < count; index += 1) {
					if (destination + PIXEL_SIZE > output.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Candy Soft bitmap run overflows the bitmap",
						);
					}
					output[destination] = b;
					output[destination + 1] = g;
					output[destination + 2] = r;
					destination += PIXEL_SIZE;
				}
				triple = readTriple();
			}
		}
		return Readable.from([output]);
	},
});
