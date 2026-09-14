// Format reference: GARbro "Legacy/ApplePie/ImageGT.cs", class `GtFormat`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference registers four words — `0x0B105447`, `0x06105447`, `0x01105447` and nothing at all — which are
 * the same three bytes `GT` and `0x10` with the fourth byte carrying the image's own flags, so the port asks
 * for those three bytes and reads the flags out of the file itself. The reference's zero makes it try every
 * file as well; the marker is what its reader then asks for.
 */
const MARKER: Buffer = Buffer.from([0x47, 0x54, 0x10]);
const HEADER_SIZE = 0x10;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const DATA_OFFSET_FIELD = 8;
/** A flag byte with this bit set is an image with an alpha channel, packed run length. */
const ALPHA_FLAG = 0x08;
/** The two low bits describe a greyscale image when they come to one. */
const DEPTH_MASK = 0x03;
const DEPTH_GRAYSCALE = 0x01;
const GRAYSCALE_BITS = 8;
const ALPHA_BITS = 32;
const COLOR_BITS = 24;
const BYTES_PER_ALPHA_PIXEL = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface GtLayout {
	width: number;
	height: number;
	flags: number;
	dataOffset: number;
	bitsPerPixel: number;
}

/**
 * The reference reads sixteen bytes and describes the image from the flags, the measurements, the offset the
 * pixels start at and the flag byte itself. It describes an image whose two low bits are one as eight bit even
 * when the alpha bit is set as well, while it **reads** such a file as a thirty two bit one.
 */
async function readLayout(source: ByteSource): Promise<GtLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, MARKER.length).equals(MARKER)) return undefined;
		const flags = header[3] ?? 0;
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * BYTES_PER_ALPHA_PIXEL > MAX_IMAGE_BYTES)
			return undefined;
		const grayscale = (flags & DEPTH_MASK) === DEPTH_GRAYSCALE;
		const hasAlpha = (flags & ALPHA_FLAG) !== 0;
		return {
			width,
			height,
			flags,
			dataOffset: header.readUInt32LE(DATA_OFFSET_FIELD),
			bitsPerPixel: grayscale
				? GRAYSCALE_BITS
				: hasAlpha
					? ALPHA_BITS
					: COLOR_BITS,
		};
	} catch {
		return undefined;
	}
}

/**
 * The reference's run length reader for the images with an alpha channel. A fragment is two words: the first
 * many pixels are **skipped** rather than written, so whatever was in the buffer stays there, and the second
 * many are written from the bytes behind them. The loop counts the pixels of a whole image and stops once they
 * are spent, so a fragment that overshoots goes on writing behind the image and past the end of its buffer.
 */
function unpackRle(file: Buffer, position: number, count: number): Buffer {
	const output: Buffer = Buffer.alloc(count * BYTES_PER_ALPHA_PIXEL, 0x00);
	let at = position;
	let remaining = count;
	let dst = 0;
	while (remaining > 0) {
		if (at + 4 > file.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Apple Pie image fragment",
			);
		}
		const skipped = file.readInt32LE(at);
		at += 4;
		remaining -= skipped;
		dst += skipped * BYTES_PER_ALPHA_PIXEL;
		if (at + 4 > file.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Apple Pie image fragment",
			);
		}
		const length = file.readInt32LE(at);
		at += 4;
		remaining -= length;
		const size = length * BYTES_PER_ALPHA_PIXEL;
		// The framework the reference writes through refuses a count that would pass the end of the buffer,
		// and would refuse a negative one as well.
		if (dst < 0 || size < 0 || dst + size > output.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Apple Pie image fragment",
			);
		}
		const available = Math.min(size, Math.max(0, file.length - at));
		if (available > 0) file.copy(output, dst, at, at + available);
		at += available;
		dst += size;
	}
	return output;
}

/** The bytes of an image that is not packed, which the reference asks for as many of as it needs. */
function readPixels(file: Buffer, offset: number, size: number): Buffer {
	if (offset < 0 || offset + size > file.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Truncated Apple Pie image");
	}
	return Buffer.from(file.subarray(offset, offset + size));
}

export const applePieGtImageDescriptor: FormatDescriptor = {
	id: "applepie-gt-image",
	name: "Apple Pie image",
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
			source: "Legacy/ApplePie/ImageGT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const applePieGtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: applePieGtImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Apple Pie image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: (layout.flags & ALPHA_FLAG) !== 0,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					flags: layout.flags,
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
				compression: (layout.flags & ALPHA_FLAG) !== 0 ? "run-length" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Apple Pie image");
		const { width, height, flags, dataOffset } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The alpha channel is looked for first, and a file carrying its bit is read as thirty two bits
		// whatever the two low bits say.
		if ((flags & ALPHA_FLAG) !== 0) {
			const pixels = unpackRle(file, dataOffset, width * height);
			return Readable.from([writeBmp32(width, height, pixels, false)]);
		}
		if ((flags & DEPTH_MASK) === DEPTH_GRAYSCALE) {
			const pixels = readPixels(file, dataOffset, width * height);
			return Readable.from([writeBmp8(width, height, pixels, false)]);
		}
		const pixels = readPixels(file, dataOffset, width * height * 3);
		return Readable.from([writeBmp24(width, height, pixels, false)]);
	},
});
