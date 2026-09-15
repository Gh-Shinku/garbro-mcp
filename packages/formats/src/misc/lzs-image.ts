// Format reference: GARBro "ArcFormats/ImageLZS.cs", classes `LzsFormat` and `LzsMetaData`, which stands in
// the `GameRes.Formats.Misc` namespace. The picture is a bitmap that may stand in the file as it is or behind
// a stream of the classic LZSS kind.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from("LZSS", "latin1");
const HEADER_SIZE = 0x10;
const UNPACKED_SIZE_FIELD = 8;
/** The lowest bits of this byte say whether the picture stands behind a stream at all. */
const COMPRESSED_FIELD = 0x0c;
const COMPRESSED_MASK = 0x07;
/** How much of the picture the reference unfolds to find the header of the bitmap with. */
const FIELDS_SIZE = 0x42;
/** The stream begins behind the header, and the bitmap it unfolds to begins a dozen bytes into it. */
const STREAM_OFFSET = 0x10;
const UNPACKED_BITMAP_OFFSET = 12;
/** A picture that stands in the file as it is begins behind these bytes. */
const PLAIN_BITMAP_OFFSET = 0x1c;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface LzsLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Whether the picture stands behind a stream, and how much it unfolds to if it does. */
	compressed: boolean;
	unpackedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `LzsFormat.ReadMetaData`: the four bytes `LZSS`, how much the picture unfolds to, and a byte of which the
 * lowest three bits say whether it stands behind a stream at all. The measurements come from the bitmap
 * behind them: a picture that stands in the file as it is keeps it behind these sixteen bytes, and one that
 * stands behind a stream keeps it a dozen bytes into what the stream unfolds to.
 */
export function readLzsLayout(data: Buffer): LzsLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const compressed = 0 !== ((data[COMPRESSED_FIELD] ?? 0) & COMPRESSED_MASK);
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (compressed) {
		if (unpackedSize < FIELDS_SIZE) return undefined;
		const prefix = decompressLzs(data.subarray(STREAM_OFFSET), FIELDS_SIZE);
		const fields = readBmpHeaderFields(prefix.subarray(UNPACKED_BITMAP_OFFSET));
		if (!fields) return undefined;
		return { ...fields, compressed, unpackedSize };
	}
	const fields = readBmpHeaderFields(data.subarray(PLAIN_BITMAP_OFFSET));
	if (!fields) return undefined;
	return { ...fields, compressed, unpackedSize };
}

/**
 * `LzsFormat.Decompress`: the control bits are read from the highest downwards, a byte at a time, and a bit
 * that stands at one stands for a byte of the picture that stands in the stream itself. A bit that stands at
 * nothing stands for two bytes of the stream: the highest twelve bits of the word they make are a place behind
 * the picture and the lowest four a count. A place of nothing stands for a run of bytes that stand in the
 * stream themselves, of sixteen to thirty and a byte more; any other place stands for a run copied from behind,
 * of three to eighteen and a byte more, which may reach into what the run has just written. Both kinds of run
 * are held to what the picture still holds room for.
 */
export function decompressLzs(input: Buffer, outputLength: number): Buffer {
	const output: Buffer = Buffer.alloc(outputLength, 0x00);
	let at = 0;
	let dst = 0;
	let mask = 0;
	let control = 0;
	const readByte = (): number => {
		if (at >= input.length) {
			throw invalidPicture("LZSS picture is cut short of its stream");
		}
		return input[at++] ?? 0;
	};
	while (dst < output.length) {
		mask >>= 1;
		if (0 === mask) {
			control = readByte();
			mask = 0x80;
		}
		if (0 !== (mask & control)) {
			output[dst] = readByte();
			dst += 1;
			continue;
		}
		const next = readByte() | (readByte() << 8);
		const offset = next >> 4;
		let count = next & 0x0f;
		if (0 === offset) {
			count = 0x0f === count ? readByte() + 0x1f : count + 0x10;
			count = Math.min(count, output.length - dst);
			const room = Math.max(0, Math.min(count, input.length - at));
			input.copy(output, dst, at, at + room);
			at += room;
		} else {
			count = 0x0f === count ? readByte() + 0x12 : count + 3;
			count = Math.min(count, output.length - dst);
			if (dst - offset < 0) {
				throw invalidPicture("LZSS picture copies from before its start");
			}
			if (!copyOverlapped(output, dst - offset, dst, count)) {
				throw invalidPicture("LZSS picture writes past its own end");
			}
		}
		dst += count;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const miscLzsImageDescriptor: FormatDescriptor = {
	id: "misc-lzs-image",
	name: "LZSS-compressed bitmap",
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
			source: "ArcFormats/ImageLZS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const miscLzsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: miscLzsImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readLzsLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLzsLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not an LZSS picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: layout.compressed,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: layout.compressed ? "lzss" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readLzsLayout(stored);
		if (!layout) {
			throw invalidPicture("Not an LZSS picture");
		}
		let bitmap: Buffer;
		if (layout.compressed) {
			if (layout.unpackedSize > LIMIT) {
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					`LZSS picture of ${layout.unpackedSize} bytes is too large`,
				);
			}
			bitmap = decompressLzs(
				stored.subarray(STREAM_OFFSET),
				layout.unpackedSize,
			).subarray(UNPACKED_BITMAP_OFFSET);
		} else {
			bitmap = stored.subarray(PLAIN_BITMAP_OFFSET);
		}
		// `Bmp.Read`: the reference takes the bitmap apart and hands the picture out, which the port mirrors.
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("Not an LZSS picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
