// Format reference: GARbro "ArcFormats/Mixwill/ImagePB00.cs", class `Pb00Format` and `Pb00MetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PB00", "latin1");
const HEADER_SIZE = 0x20;
const BITS_PER_PIXEL_FIELD = 4;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xc;
const CHANNEL_TABLE_OFFSET = 0x10;
const CHANNEL_TABLE_SIZE = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
/**
 * Which byte of a pixel each channel of the file fills: the channels are written in blue, green, red, alpha
 * order, so the first one goes to the third byte of a blue-green-red-alpha pixel.
 */
const CHANNEL_ORDER = [2, 1, 0, 3];
/** The depths whose channels fill a whole pixel of one of the two kinds of bitmap this port writes. */
const DEPTHS = new Map<number, number>([
	[24, 3],
	[32, 4],
]);

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface Pb00Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	channels: number;
	channelLengths: number[];
}

/** The header the reference reads: its word, the depth, the measurements and the length of each channel. */
async function readLayout(source: ByteSource): Promise<Pb00Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const bitsPerPixel = header.readInt32LE(BITS_PER_PIXEL_FIELD) * 8;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		const channels = Math.trunc(bitsPerPixel / 8);
		if (channels < 0) return undefined;
		if (width * height * channels > MAX_IMAGE_BYTES) return undefined;
		const channelLengths: number[] = [];
		for (let i = 0; i < CHANNEL_TABLE_SIZE; i += 1) {
			channelLengths.push(header.readInt32LE(CHANNEL_TABLE_OFFSET + i * 4));
		}
		return { width, height, bitsPerPixel, channels, channelLengths };
	} catch {
		return undefined;
	}
}

/**
 * The reference's reader: every channel is a run length encoded stream of its own, and the streams follow the
 * header one behind the other at the lengths the table gives. Two details of it are worth keeping:
 *
 * * the counter that decides when a stream ends counts the **bytes** of the runs, so a run of a repeated byte
 *   counts only the byte that names it and not the byte it repeats — which makes the reader step over the end
 *   of the stream it was given and read on into whatever follows;
 * * a length is a signed word, so a stream may start behind the one before it, or before the end of the header.
 *
 * A run that walks out of the pixels, and a stream that ends before its length does, both stop with an error,
 * which is what the reference's own reads do.
 */
function unpackChannel(
	file: Buffer,
	pixels: Buffer,
	offset: number,
	length: number,
	destination: number,
	channels: number,
): void {
	let at = offset;
	let dst = destination;
	for (let j = 0; j < length; j += 1) {
		if (at < 0 || at >= file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Mixwill image");
		}
		const b = file.readInt8(at);
		at += 1;
		if (b >= 0) {
			for (let count = b + 1; count > 0; count -= 1) {
				if (at < 0 || at >= file.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated Mixwill image");
				}
				if (dst >= pixels.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Pixel run past the image");
				}
				pixels[dst] = file[at] ?? 0;
				dst += channels;
				at += 1;
				j += 1;
			}
		} else {
			if (at < 0 || at >= file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Mixwill image");
			}
			const value = file[at] ?? 0;
			at += 1;
			for (let count = 1 - b; count > 0; count -= 1) {
				if (dst >= pixels.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Pixel run past the image");
				}
				pixels[dst] = value;
				dst += channels;
			}
			j += 1;
		}
	}
}

/** The channels of the file, one after the other, laid into the bytes of a pixel. */
function unpackPixels(file: Buffer, layout: Pb00Layout): Buffer {
	const pixels: Buffer = Buffer.alloc(
		layout.width * layout.height * layout.channels,
		0x00,
	);
	let position = HEADER_SIZE;
	for (let i = 0; i < layout.channels; i += 1) {
		const length = layout.channelLengths[i] ?? 0;
		unpackChannel(
			file,
			pixels,
			position,
			length,
			CHANNEL_ORDER[i] ?? 0,
			layout.channels,
		);
		position += length;
	}
	return pixels;
}

export const mixwillPb00ImageDescriptor: FormatDescriptor = {
	id: "mixwill-pb00-image",
	name: "Mixwill soft image",
	extensions: ["pb"],
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
			source: "ArcFormats/Mixwill/ImagePB00.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mixwillPb00ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mixwillPb00ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mixwill image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					channels: layout.channels,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "run-length",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mixwill image");
		// The reference makes a bitmap of the pixels whatever the depth says, so only the two depths whose
		// channels fill a whole pixel make it as far as a picture.
		if (!DEPTHS.has(layout.bitsPerPixel)) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Mixwill image depth ${layout.bitsPerPixel}`,
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackPixels(file, layout);
		// `ImageData.Create` stores the rows top down, which a bitmap records with a negative height.
		const bmp =
			layout.channels === 4
				? writeBmp32(layout.width, layout.height, pixels, false)
				: writeBmp24(layout.width, layout.height, pixels, false);
		return Readable.from([bmp]);
	},
});
