// Format reference: GARbro "ArcFormats/Lilim/ImageABM.cs" (class `AbmFormat`) and "ArcFormats/Lilim/ArcABM.cs"
// (class `AbmReader`, the decoder). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The metadata is read from this many bytes: a bitmap header plus the format's own fields. */
const HEADER_SIZE = 0x46;
/** Where the palette of an eight bit image sits — immediately behind the bitmap header. */
const PALETTE_OFFSET = 0x36;
const PALETTE_BYTES = 0x100 * 4;
/** Modes 1 and 2 store a frame count here; more than 255 frames is not this format. */
const FRAME_COUNT_POSITION = 0x3a;
/** The frame offset of a compressed entry, and of an uncompressed one. */
const COMPRESSED_FRAME_POSITION = 0x42;
const RAW_FRAME_POSITION = 0x0a;
/** The modes the format accepts, as the signed word at 0x1C. The bitmap's bit depth lives there too. */
const MODE_V1 = 1;
const MODE_V2 = 2;
const MODE_BPP8 = 8;
const MODE_BPP8_ALPHA = -8;
const MODE_BPP24 = 24;
const MODE_BPP32 = 32;
/** The port's own ceiling on a decoded frame. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface AbmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The signed word the reader switches on. */
	mode: number;
	/** Where the pixel or frame data begins. */
	baseOffset: number;
}

/**
 * The file starts like a bitmap, and the word at 0x1C — the bitmap's bit depth field — carries the mode the
 * reader switches on, read as **signed**, which is why −8 is one of the accepted values. Modes 1 and 2 are the
 * compound ones and carry a frame count; the others carry the uncompressed size, and a file whose size word is
 * zero or equal to its own length is declined as an ordinary bitmap.
 */
async function readFields(source: ByteSource): Promise<AbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header[0] !== 0x42 || header[1] !== 0x4d) return undefined;
		const mode = header.readInt16LE(0x1c);
		let bitsPerPixel = 24;
		let baseOffset: number;
		if (mode === MODE_V1 || mode === MODE_V2) {
			const count = header.readUInt16LE(FRAME_COUNT_POSITION);
			if (count > 0xff) return undefined;
			baseOffset = header.readUInt32LE(COMPRESSED_FRAME_POSITION);
		} else if (
			mode === MODE_BPP32 ||
			mode === MODE_BPP24 ||
			mode === MODE_BPP8 ||
			mode === MODE_BPP8_ALPHA
		) {
			const unpackedSize = header.readUInt32LE(2);
			if (unpackedSize === 0 || BigInt(unpackedSize) === source.size) {
				return undefined;
			}
			baseOffset = header.readUInt32LE(RAW_FRAME_POSITION);
			if (mode === MODE_BPP8) bitsPerPixel = 8;
		} else {
			return undefined;
		}
		if (BigInt(baseOffset) >= source.size) return undefined;
		return {
			width: header.readUInt32LE(0x12),
			height: header.readUInt32LE(0x16),
			bitsPerPixel,
			mode,
			baseOffset,
		};
	} catch {
		return undefined;
	}
}

/**
 * The twenty four bit run decoder. A zero marker skips the count that follows, a 0xFF marker copies that many
 * literals, and **any other value** is a marker for a single literal whose own value is discarded — the byte
 * after it is what gets stored. A marker whose count is zero consumes its two bytes and does nothing. Skips are
 * not clamped, so one can carry the position past the end of the image, which simply ends the loop.
 */
function unpackStream24(input: Buffer, output: Buffer): void {
	let position = 0;
	let dst = 0;
	const readU8 = (): number => {
		if (position >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM stream");
		return input[position++] ?? 0;
	};
	while (dst < output.length) {
		const value = readU8();
		if (value === 0) {
			const count = readU8();
			if (count === 0) continue;
			dst += count;
		} else if (value === 0xff) {
			const count = readU8();
			if (count === 0) continue;
			const available = Math.min(count, output.length - dst);
			for (let index = 0; index < available; index += 1) {
				output[dst + index] = readU8();
			}
			dst += available;
		} else {
			output[dst] = readU8();
			dst += 1;
		}
	}
}

/**
 * The same run decoder for thirty two bit output, with the alpha byte woven in: a literal takes one byte from
 * the stream and, every third one, the marker's own value is stored as the alpha; a 0xFF run stores opaque
 * alpha; a skip steps the position but keeps the component counter, so it also steps past an alpha slot when it
 * lands on one.
 */
function unpackStream32(input: Buffer, output: Buffer): void {
	let position = 0;
	let dst = 0;
	let component = 0;
	const readU8 = (): number => {
		if (position >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM stream");
		return input[position++] ?? 0;
	};
	while (dst < output.length) {
		const value = readU8();
		if (value === 0) {
			const count = readU8();
			if (count === 0) continue;
			for (let index = 0; index < count; index += 1) {
				dst += 1;
				component += 1;
				if (component === 3) {
					dst += 1;
					component = 0;
				}
			}
		} else if (value === 0xff) {
			const count = readU8();
			if (count === 0) continue;
			for (let index = 0; index < count && dst < output.length; index += 1) {
				output[dst] = readU8();
				dst += 1;
				component += 1;
				if (component === 3) {
					output[dst] = 0xff;
					dst += 1;
					component = 0;
				}
			}
		} else {
			output[dst] = readU8();
			dst += 1;
			component += 1;
			if (component === 3) {
				output[dst] = value;
				dst += 1;
				component = 0;
			}
		}
	}
}

/**
 * The eight bit decoder with alpha: the marker byte is itself the alpha of a single literal, 0xFF means a run of
 * opaque pixels and zero means a skip. Nothing here is clamped in the reference — a run that does not fit would
 * run past the array — so the port fails instead.
 */
function unpackStream8(input: Buffer, output: Buffer, alpha: Buffer): void {
	let position = 0;
	let dst = 0;
	let alphaDst = 0;
	const readU8 = (): number => {
		if (position >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM stream");
		return input[position++] ?? 0;
	};
	while (dst < output.length) {
		const rle = readU8();
		if (rle === 0) {
			const skip = readU8();
			dst += skip;
			alphaDst += skip;
		} else if (rle !== 0xff) {
			if (dst >= output.length || alphaDst >= alpha.length)
				throw new GarbroError("INVALID_ARCHIVE", "LiLiM stream overrun");
			output[dst] = readU8();
			dst += 1;
			alpha[alphaDst] = rle;
			alphaDst += 1;
		} else {
			const count = readU8();
			if (dst + count > output.length || alphaDst + count > alpha.length) {
				throw new GarbroError("INVALID_ARCHIVE", "LiLiM stream overrun");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = readU8();
			}
			dst += count;
			for (let index = 0; index < count; index += 1) {
				alpha[alphaDst + index] = 0xff;
			}
			alphaDst += count;
		}
	}
}

/** The mode 2 frame: four signed dimensions, one position byte, then the thirty two bit stream. */
function unpackV2(input: Buffer): Buffer {
	if (input.length < 17) {
		throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM frame");
	}
	const frameX = input.readInt32LE(0);
	const frameY = input.readInt32LE(4);
	const frameWidth = input.readInt32LE(8);
	const frameHeight = input.readInt32LE(12);
	if (frameX < 0 || frameY < 0 || frameWidth <= 0 || frameHeight <= 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid LiLiM frame");
	}
	const total = frameWidth * frameHeight * 4;
	if (total > MAX_IMAGE_BYTES) {
		throw new GarbroError("INVALID_ARCHIVE", "LiLiM frame is too large");
	}
	const output: Buffer = Buffer.alloc(total, 0x00);
	unpackStream32(input.subarray(17), output);
	return output;
}

export const abmImageDescriptor: FormatDescriptor = {
	id: "lilim-abm-image",
	name: "LiLiM/Le.Chocolat compressed bitmap",
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
			source: "ArcFormats/Lilim/ImageABM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abmImageDescriptor,
	// No signature: the file looks like a bitmap, and the mode word is what makes it this format.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LiLiM bitmap");
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// Every mode produces a bitmap, which has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				mode: layout.mode,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LiLiM bitmap");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const data = stored.subarray(layout.baseOffset);
		const { width, height, mode } = layout;
		// The palette is read verbatim; the reference's reader takes blue, green, red and a spare byte, which is
		// the order a bitmap's own palette uses.
		if (mode === MODE_BPP8 || mode === MODE_BPP8_ALPHA) {
			const palette = Buffer.from(
				await source.readAt(BigInt(PALETTE_OFFSET), PALETTE_BYTES),
			);
			const pixels = Buffer.alloc(width * height, 0x00);
			if (mode === MODE_BPP8) {
				// A plain eight bit image: the stored bytes are the indices, and a short read is an error.
				if (data.length < pixels.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM image");
				}
				data.copy(pixels, 0, 0, pixels.length);
				return Readable.from([
					writeBmp8Palette(width, height, pixels, palette, false),
				]);
			}
			const alpha: Buffer = Buffer.alloc(pixels.length, 0x00);
			unpackStream8(data, pixels, alpha);
			const rgba: Buffer = Buffer.alloc(pixels.length * 4, 0x00);
			for (let index = 0; index < pixels.length; index += 1) {
				const entry = (pixels[index] ?? 0) * 4;
				// Blue, green and red come from the palette and the alpha from the stream.
				rgba[index * 4] = palette[entry] ?? 0;
				rgba[index * 4 + 1] = palette[entry + 1] ?? 0;
				rgba[index * 4 + 2] = palette[entry + 2] ?? 0;
				rgba[index * 4 + 3] = alpha[index] ?? 0;
			}
			return Readable.from([writeBmp32(width, height, rgba, false)]);
		}
		if (mode === MODE_V2) {
			// The frame carries its own dimensions, and the reference stores its pixels under the size the
			// header declared — this port writes the frame's own size instead, which is what those pixels are.
			const frame = unpackV2(data);
			const frameWidth = data.readInt32LE(8);
			const frameHeight = data.readInt32LE(12);
			return Readable.from([writeBmp32(frameWidth, frameHeight, frame, false)]);
		}
		const bitsPerPixel = mode === MODE_V1 ? 24 : mode;
		const total = (width * height * bitsPerPixel) / 8;
		if (total > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "LiLiM image is too large");
		}
		const pixels: Buffer = Buffer.alloc(total, 0x00);
		if (mode === MODE_V1) {
			if (data.length < total) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated LiLiM image");
			}
			data.copy(pixels, 0, 0, total);
		} else if (bitsPerPixel === 24) {
			unpackStream24(data, pixels);
		} else {
			unpackStream32(data, pixels);
		}
		return Readable.from([
			bitsPerPixel === 24
				? writeBmp24(width, height, pixels, false)
				: writeBmp32(width, height, pixels, false),
		]);
	},
});
