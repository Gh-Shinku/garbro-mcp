// Format reference: GARBro "ArcFormats/ImageMNG.cs", class `MngFormat` (the picture half of the file; the
// archive half, `MngOpener`, is ported beside this in `mng.ts`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { readPngImage } from "../shared/png-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word the engine opens with, and the four bytes that follow it. */
const SIGNATURE = Buffer.from([0x8a, 0x4d, 0x4e, 0x47]);
const DATA_MARKER = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);
/** What a picture of this kind carries in front of the pictures it holds. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** The first chunk has to be this one, and it names the canvas the pictures are drawn on. */
const HEADER_CHUNK = "MHDR";
const MHDR_MIN_SIZE = 8;
/** The chunk a picture begins with, and the one it ends with. */
const IMAGE_CHUNK = "IHDR";
const IMAGE_END = "IEND";
/** The chunk that ends the whole file. */
const FILE_END = "MEND";
/** A chunk is a length and a name in front of its own bytes, and a check word behind them. */
const CHUNK_HEADER_SIZE = 8;
const CHUNK_OVERHEAD = 12;
/** Guard the walk of the reference, which has no bound of its own, against a malformed file. */
const MAX_CHUNKS = 0x10000;

export interface MngImageLayout {
	width: number;
	height: number;
	/** Where the first picture's own chunk stands, which is where the picture's bytes begin. */
	pngOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

interface MngChunk {
	offset: number;
	size: number;
	type: string;
	/** Where the chunk behind it begins. */
	next: number;
}

function readChunkAt(data: Buffer, offset: number): MngChunk | undefined {
	if (offset < 0 || offset + CHUNK_HEADER_SIZE > data.length) return undefined;
	const size = data.readInt32BE(offset);
	if (size < 0) return undefined;
	return {
		offset,
		size,
		type: data.toString("latin1", offset + 4, offset + CHUNK_HEADER_SIZE),
		// The walk of the reference counts the head and the check word beside the chunk's own bytes.
		next: offset + size + CHUNK_OVERHEAD,
	};
}

/**
 * `MngFormat.ReadMetaData`: the file opens with the engine's word and the marker a PNG carries, and its
 * first chunk names the canvas. The chunks behind it are then walked until the first picture's own chunk
 * is found - which is where the picture's bytes begin - or until the file ends.
 */
export function readMngImageLayout(data: Buffer): MngImageLayout | undefined {
	if (data.length < SIGNATURE.length + DATA_MARKER.length) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!data.subarray(4, 8).equals(DATA_MARKER)) return undefined;
	const header = readChunkAt(data, SIGNATURE.length + DATA_MARKER.length);
	if (!header || header.type !== HEADER_CHUNK) return undefined;
	if (header.size < MHDR_MIN_SIZE) return undefined;
	const width = data.readUInt32BE(header.offset + CHUNK_HEADER_SIZE);
	const height = data.readUInt32BE(header.offset + CHUNK_HEADER_SIZE + 4);
	if (0 === width || 0 === height) return undefined;
	let offset = header.next;
	for (let step = 0; step < MAX_CHUNKS; step += 1) {
		const chunk = readChunkAt(data, offset);
		if (!chunk) return undefined;
		if (chunk.type === FILE_END || chunk.type === IMAGE_END) return undefined;
		if (chunk.type === IMAGE_CHUNK) {
			return { width, height, pngOffset: chunk.offset };
		}
		if (chunk.next <= offset) return undefined;
		offset = chunk.next;
	}
	return undefined;
}

/**
 * The bytes `MngFormat.Read` hands over: the marker a PNG carries, and then the chunks of the first picture
 * - from its own chunk up to and including the one that ends it. The reference wraps the file from that
 * chunk all the way to its end instead, which carries the chunks that end the file as well; a decoder stops
 * at the first end chunk, and the archive half beside this one cuts its frames at the same place.
 */
export function readMngPicture(data: Buffer, layout: MngImageLayout): Buffer {
	let offset = layout.pngOffset;
	const first = readChunkAt(data, offset);
	if (!first || first.type !== IMAGE_CHUNK) {
		throw invalidImage("The picture does not begin with its own chunk");
	}
	for (let step = 0; step < MAX_CHUNKS; step += 1) {
		const chunk = readChunkAt(data, offset);
		if (!chunk)
			throw invalidImage("The picture ends before its own chunk does");
		if (chunk.type === IMAGE_END) {
			// `next` already stands behind the chunk's check word, which is what the reference counts to.
			const end = Math.min(chunk.next, data.length);
			return Buffer.concat([
				PNG_SIGNATURE,
				data.subarray(layout.pngOffset, end),
			]);
		}
		if (chunk.next <= offset) {
			throw invalidImage("A chunk of the picture does not advance");
		}
		offset = chunk.next;
	}
	throw invalidImage("The picture does not end");
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mngImageDescriptor: FormatDescriptor = {
	id: "mng-image",
	name: "Multiple-image Network Graphics picture",
	extensions: [".mng"],
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
			source: "ArcFormats/ImageMNG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mngImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mngImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 12n) return false;
		return readMngImageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readMngImageLayout(stored);
		if (!layout)
			throw invalidImage("Not a Multiple-image Network Graphics file");
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
				},
			}),
			// The picture is unfolded out of the PNG the file holds, which is not the length of the file.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				// The engine never opens a picture of this kind at any other depth.
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readMngImageLayout(stored);
		if (!layout)
			throw invalidImage("Not a Multiple-image Network Graphics file");
		// `MngFormat.Read` wraps the bytes behind the first chunk of the picture in the header a PNG carries
		// and hands the whole of it to the decoder of the platform; this port unwraps them the same way and
		// reads the picture with its own reader of that format, handing out a bitmap in its place.
		const picture = await readPngImage(readMngPicture(stored, layout));
		if (!picture) {
			throw invalidImage(
				"The picture behind the head stands of no picture of its own",
			);
		}
		return Readable.from([
			32 === picture.bitsPerPixel
				? writeBmp32(picture.width, picture.height, picture.pixels)
				: writeBmp24(picture.width, picture.height, picture.pixels),
		]);
	},
});
