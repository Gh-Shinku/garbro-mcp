// Format reference: GARbro "ArcFormats/Marble/ImageYP.cs", classes `YpFormat` and `YpMetaData` (the
// DarkNiteSystem image format, the predecessor of the Marble YB pictures). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The two letters the header begins with, which is all the reference checks. */
const SIGNATURE = Buffer.from("YP", "latin1");
const HEADER_SIZE = 8;
const UNPACKED_SIZE_FIELD = 2;
const PACKED_SIZE_FIELD = 5;
/** The first pass of the reference unfolds just enough of the picture for a bitmap header. */
const HEADER_PASS_SIZE = 0x36;
/** The frame of the stream is sixteen kilobytes. */
const FRAME_SIZE = 0x4000;
const FRAME_MASK = 0x3fff;
/** The control bits of a byte are read from the highest down, a set bit meaning a run. */
const FIRST_BIT = 0x80;
/** GARbro `YpFormat.CountTable`: what the low nibble of a run's second byte stands for. */
const COUNT_TABLE: readonly number[] = [
	3, 4, 5, 6, 7, 8, 9, 0xa, 0xb, 0xc, 0xe, 0x10, 0x18, 0x20, 0x40, 0x80,
];

export interface YpLayout {
	/** How much the stream unfolds to, which is also the length of the bitmap behind it. */
	unpackedSize: number;
	/** The packed length of the stream, which the reference reads and never looks at again. */
	packedSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The three byte lengths of the header, little endian. */
function readUInt24(data: Buffer, offset: number): number {
	return (
		(data[offset] ?? 0) |
		((data[offset + 1] ?? 0) << 8) |
		((data[offset + 2] ?? 0) << 16)
	);
}

/**
 * `YpFormat.LzUnpack`: a stream of twelve bit LZSS with a frame of sixteen kilobytes, whose control bits are
 * read from the **highest down** and where a **set** bit is a run and a clear one a literal byte. A run holds
 * its place in the frame — the low nibble of the second byte holds the top of it — and its count in the low
 * nibble of the first byte, through the reference's own count table; it is copied **backwards** from behind the
 * place the frame stands at, writing into the frame as it goes, and it is held to what is left of the picture.
 * A stream that stops where a control byte is wanted gives up and hands back what it unfolded; one that stops
 * in the middle of a literal or a run is refused, because the .NET reader the reference uses throws there.
 */
export function unpackYp(input: Buffer, unpackedSize: number): Buffer {
	const output: Buffer = Buffer.alloc(Math.max(0, unpackedSize), 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	let dst = 0;
	let position = 0;
	let framePosition = 0;
	let control = 0;
	let mask = 0;
	while (dst < output.length) {
		if (0 === mask) {
			if (position >= input.length) break;
			control = input[position] ?? 0;
			position += 1;
			mask = FIRST_BIT;
		}
		if (0 !== (control & mask)) {
			if (position + 2 > input.length) {
				throw invalidPicture(
					"DarkNiteSystem picture is cut short of its stream",
				);
			}
			const low = input[position] ?? 0;
			const high = input[position + 1] ?? 0;
			position += 2;
			let count = Math.min(COUNT_TABLE[low & 0x0f] ?? 0, output.length - dst);
			let source = framePosition - ((high << 4) | (low >> 4));
			while (count > 0) {
				const value = frame[source++ & FRAME_MASK] ?? 0;
				output[dst] = value;
				dst += 1;
				frame[framePosition++ & FRAME_MASK] = value;
				count -= 1;
			}
		} else {
			if (position >= input.length) {
				throw invalidPicture(
					"DarkNiteSystem picture is cut short of its stream",
				);
			}
			const value = input[position] ?? 0;
			position += 1;
			output[dst] = value;
			dst += 1;
			frame[framePosition++ & FRAME_MASK] = value;
		}
		mask >>= 1;
	}
	return output;
}

/**
 * `YpFormat.ReadMetaData`: the file begins with `'YP'`, two three byte lengths — of what the stream unfolds to
 * and of the stream itself, which the reference reads and never looks at again — and then the stream, at the
 * end of the header. Enough of it is unfolded for a bitmap header, which is where the measurements come from.
 */
export function readYpLayout(data: Buffer): YpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const unpackedSize = readUInt24(data, UNPACKED_SIZE_FIELD);
	const packedSize = readUInt24(data, PACKED_SIZE_FIELD);
	let head: Buffer;
	try {
		head = unpackYp(data.subarray(HEADER_SIZE), HEADER_PASS_SIZE);
	} catch {
		return undefined;
	}
	const fields = readBmpHeaderFields(head);
	if (!fields) return undefined;
	return {
		unpackedSize,
		packedSize,
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const marbleYpImageDescriptor: FormatDescriptor = {
	id: "marble-yp-image",
	name: "DarkNiteSystem image format",
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
			source: "ArcFormats/Marble/ImageYP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const marbleYpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: marbleYpImageDescriptor,
	// The reference registers the word of nothing, so the format is a candidate for every file that begins
	// with its two letters.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readYpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readYpLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a DarkNiteSystem picture");
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
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							unpackedSize: layout.unpackedSize,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readYpLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a DarkNiteSystem picture");
		}
		// The whole picture is unfolded by its own length and then read as the bitmap it is, which the port
		// writes out again at the depth it was stored in.
		const bitmap = unpackYp(stored.subarray(HEADER_SIZE), layout.unpackedSize);
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("Not a DarkNiteSystem picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
