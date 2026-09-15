// Format reference: GARbro "ArcFormats/RealLive/ImagePDT.cs", classes `PdtFormat`, `PdtMetaData` and
// `PdtReader` (AVG32 engine image format). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `PDT1`, the word the reference registers the format under, and the header that follows it. */
const SIGNATURE: Buffer = Buffer.from("PDT1", "latin1");
const HEADER_SIZE = 0x20;
const PIXELS_OFFSET = 0x20;
/** The digit behind the word names the version, and only two of them are pictures this format reads. */
const VERSION_FIELD = 4;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x10;
const ALPHA_FIELD = 0x1c;
/** The two versions: the plain one and the one with a colour map and a run length stream. */
const PLAIN_VERSION = 0;
const PALETTE_VERSION = 1;
/** A version one picture carries a colour map of two hundred and fifty six entries of four bytes. */
const PALETTE_SIZE = 0x100 * 4;
/** And a table of sixteen places its runs are counted back from. */
const OFFSET_COUNT = 16;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface PdtLayout {
	width: number;
	height: number;
	/** Zero for the plain picture, one for the one with a colour map. */
	version: number;
	/** The place the transparency of the picture is stored, or zero when it has none. */
	alphaOffset: number;
}

/** The reference's `PdtFormat.ReadMetaData`, which declines a word whose digit is not a version it knows. */
export async function readPdtLayout(
	source: ByteSource,
): Promise<PdtLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = (header[VERSION_FIELD] ?? 0) - 0x30;
	if (version < PLAIN_VERSION || version > PALETTE_VERSION) return undefined;
	return {
		width: header.readUInt32LE(WIDTH_FIELD),
		height: header.readUInt32LE(HEIGHT_FIELD),
		version,
		alphaOffset: header.readUInt32LE(ALPHA_FIELD),
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The stream the unpackers read, with every read checked against the length of the file. */
class PdtStream {
	at: number;

	constructor(
		readonly data: Buffer,
		at = PIXELS_OFFSET,
	) {
		this.at = at;
	}

	byte(): number {
		this.#need(1);
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	word(): number {
		this.#need(2);
		const value = this.data.readUInt16LE(this.at);
		this.at += 2;
		return value;
	}

	long(): number {
		this.#need(4);
		const value = this.data.readInt32LE(this.at);
		this.at += 4;
		return value;
	}

	/** The three bytes of a pixel of the plain picture, which the stream carries as they are. */
	literal(target: Buffer, at: number): void {
		this.#need(3);
		this.data.copy(target, at, this.at, this.at + 3);
		this.at += 3;
	}

	#need(count: number): void {
		if (this.at + count > this.data.length) {
			throw invalidPicture("Unexpected end of AVG32 picture");
		}
	}
}

/**
 * The reference's `PdtReader.Unpack24`: a stream of pixels, either three bytes the stream carries or a run
 * repeating what the picture already holds. Every pixel takes four bytes, the fourth of them left at zero.
 */
function unpackPixels(stream: PdtStream, output: Buffer): void {
	let at = 0;
	let bits = 0;
	let mask = 0;
	while (at < output.length) {
		mask >>= 1;
		if (0 === mask) {
			bits = stream.byte();
			mask = 0x80;
		}
		if (0 !== (bits & mask)) {
			stream.literal(output, at);
			at += 4;
		} else {
			const packed = stream.word();
			const count = (1 + (packed & 0x0f)) * 4;
			const back = (1 + (packed >> 4)) * 4;
			if (!copyOverlapped(output, at - back, at, count)) {
				throw invalidPicture("AVG32 run reaches outside its picture");
			}
			at += count;
		}
	}
}

/**
 * The reference's `PdtReader.Unpack8`: the transparency of a picture, a byte to a pixel in a stream of its
 * own. A run whose place reaches back before the picture is refused here, where the reference would fail.
 */
function unpackBytes(stream: PdtStream, output: Buffer): void {
	let at = 0;
	let bits = 0;
	let mask = 0;
	while (at < output.length) {
		mask >>= 1;
		if (0 === mask) {
			bits = stream.byte();
			mask = 0x80;
		}
		if (0 !== (bits & mask)) {
			output[at] = stream.byte();
			at += 1;
		} else {
			const count = 2 + stream.byte();
			const back = 1 + stream.byte();
			if (!copyOverlapped(output, at - back, at, count)) {
				throw invalidPicture("AVG32 run reaches outside its picture");
			}
			at += count;
		}
	}
}

/**
 * The reference's `PdtReader.LzUnpack`: the stream a version one picture stores its pixels in. The places
 * its runs count back from are not distances but places of their own, out of the table in the header, and a
 * run that names a place the picture has not reached yet leaves the bytes between them at zero.
 */
function unpackLz(stream: PdtStream, output: Buffer, offsets: number[]): void {
	let at = 0;
	let bits = 0;
	let mask = 0;
	while (at < output.length) {
		mask >>= 1;
		if (0 === mask) {
			bits = stream.byte();
			mask = 0x80;
		}
		if (0 !== (bits & mask)) {
			output[at] = stream.byte();
			at += 1;
		} else {
			const packed = stream.byte();
			let count = Math.min(2 + (packed >> 4), output.length - at);
			const back = offsets[packed & 0x0f] ?? 0;
			if (at < back) {
				const gap = Math.min(back - at, count);
				at += gap;
				count -= gap;
			}
			if (count > 0) {
				if (!copyOverlapped(output, at - back, at, count)) {
					throw invalidPicture("AVG32 run reaches outside its picture");
				}
				at += count;
			}
		}
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/**
 * The depth and the pixels of a picture: the plain version hands out four bytes to a pixel, and the version
 * with a colour map one byte to a pixel, unless it carries transparency as well.
 */
function pictureShape(layout: PdtLayout): {
	bytesPerPixel: number;
	hasPalette: boolean;
} {
	if (0 !== layout.alphaOffset) return { bytesPerPixel: 4, hasPalette: false };
	if (PALETTE_VERSION === layout.version) {
		return { bytesPerPixel: 1, hasPalette: true };
	}
	return { bytesPerPixel: 4, hasPalette: false };
}

export const reallivePdtImageDescriptor: FormatDescriptor = {
	id: "reallive-pdt-image",
	name: "AVG32 engine image",
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
			source: "ArcFormats/RealLive/ImagePDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const reallivePdtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: reallivePdtImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPdtLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readPdtLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an AVG32 picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported AVG32 picture size ${layout.width}x${layout.height}`,
			);
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
							bitsPerPixel: 32,
							version: layout.version,
							alphaOffset: layout.alphaOffset,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: 0 === layout.version ? "avg32-pixels" : "avg32-lz",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const layout = await readPdtLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an AVG32 picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported AVG32 picture size ${layout.width}x${layout.height}`,
			);
		}
		const { bytesPerPixel, hasPalette } = pictureShape(layout);
		const pictureBytes = layout.width * layout.height * bytesPerPixel;
		if (
			!Number.isSafeInteger(pictureBytes) ||
			pictureBytes > MAXIMUM_PICTURE_BYTES
		) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`AVG32 picture of ${pictureBytes} bytes is too large`,
			);
		}
		const stored = await readStored(source);
		const stream = new PdtStream(stored);
		const pixels: Buffer = Buffer.alloc(pictureBytes, 0x00);
		let palette: Buffer | undefined;
		if (PLAIN_VERSION === layout.version) {
			unpackPixels(stream, pixels);
			if (0 !== layout.alphaOffset) {
				stream.at = layout.alphaOffset;
				const alpha: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
				unpackBytes(stream, alpha);
				for (let i = 3; i < pixels.length; i += 4) {
					pixels[i] = alpha[(i - 3) / 4] ?? 0;
				}
			}
		} else {
			// A version one picture carries its colour map whether it is used or not.
			stream.at = PIXELS_OFFSET;
			palette = stored.subarray(
				stream.at,
				Math.min(stream.at + PALETTE_SIZE, stored.length),
			);
			if (palette.length !== PALETTE_SIZE) {
				throw invalidPicture("AVG32 picture carries no colour map");
			}
			stream.at += PALETTE_SIZE;
			const offsets: number[] = [];
			for (let i = 0; i < OFFSET_COUNT; i += 1) offsets.push(stream.long());
			unpackLz(stream, pixels, offsets);
			if (0 !== layout.alphaOffset) {
				// The reference reads the transparency of this version as well and then drops it, because the
				// stream it has already unpacked carries it.
				stream.at = layout.alphaOffset;
				unpackBytes(stream, Buffer.alloc(layout.width * layout.height, 0x00));
			}
		}
		const image = hasPalette
			? writeBmp8Palette(
					layout.width,
					layout.height,
					pixels,
					palette ?? Buffer.alloc(PALETTE_SIZE),
				)
			: writeBmp32(layout.width, layout.height, pixels);
		return Readable.from([image]);
	},
});
