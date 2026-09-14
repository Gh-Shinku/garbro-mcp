// Format reference: GARbro "Legacy/Tobe/ImageWBI.cs", class `WbiFormat`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE: Buffer = Buffer.from("WBI-", "latin1");
const VERSION: Buffer = Buffer.from("V1.00\0", "latin1");
const HEADER_SIZE = 0x20;
const VERSION_OFFSET = 4;
const WIDTH_FIELD = 0x0e;
const HEIGHT_FIELD = 0x10;
/** The byte a run is written with, which the pixels of the image never carry as one of their own. */
const RLE_CODE_FIELD = 0x1c;
const BITS_PER_PIXEL = 24;
const BYTES_PER_PIXEL = 3;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface WbiLayout {
	width: number;
	height: number;
	rleCode: number;
}

/** The header the reference reads: its word, its version, the measurements and the byte runs are written with. */
async function readLayout(source: ByteSource): Promise<WbiLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if (
			!header
				.subarray(VERSION_OFFSET, VERSION_OFFSET + VERSION.length)
				.equals(VERSION)
		) {
			return undefined;
		}
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * BYTES_PER_PIXEL > MAX_IMAGE_BYTES) return undefined;
		return { width, height, rleCode: header[RLE_CODE_FIELD] ?? 0 };
	} catch {
		return undefined;
	}
}

/**
 * The reference's reader: pixels of three bytes, blue, green and red, with runs written as the code byte and
 * how many pixels to write. Two details of it are worth keeping:
 *
 * * the count is read as the **second** byte of a little endian word, so the pair behind the code is the code
 *   and then the count;
 * * a count of **nothing** is not a run of nothing but a pixel: the reader steps back over the pair, writes the
 *   pixel it had just read once more, and the next pixel it reads takes the code byte as its blue and throws
 *   away the byte behind it — the count of nothing, which is what makes the two kinds distinguishable.
 *
 * A file that ends in the middle of a pixel stops with an error, which is what the reference's own reads do.
 */
function unpackPixels(file: Buffer, rleCode: number, count: number): Buffer {
	const pixels: Buffer = Buffer.alloc(count * BYTES_PER_PIXEL, 0x00);
	let at = HEADER_SIZE;
	let dst = 0;
	let skip = false;
	let blue = 0;
	let green = 0;
	let red = 0;
	let left = 0;
	while (dst < pixels.length) {
		if (left <= 0) {
			if (at >= file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated TOBE image");
			}
			blue = file[at] ?? 0;
			at += 1;
			if (skip) {
				// The reference reads this byte without asking whether it was there, so its position may pass
				// the end of the file before the two that follow it are refused.
				at += 1;
				skip = false;
			}
			if (at + 2 > file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated TOBE image");
			}
			green = file[at] ?? 0;
			red = file[at + 1] ?? 0;
			at += 2;
			left = 1;
			if (at < file.length && file[at] === rleCode) {
				if (at + 2 > file.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated TOBE image");
				}
				left = file[at + 1] ?? 0;
				if (left <= 0) {
					left = 1;
					// The reference reads the pair and then steps back over it, which leaves its position on the
					// code byte — so the next pixel it reads takes that byte as its blue and throws away the one
					// behind it, which is the count of nothing.
					skip = true;
				} else {
					at += 2;
				}
			}
		}
		left -= 1;
		pixels[dst] = blue;
		pixels[dst + 1] = green;
		pixels[dst + 2] = red;
		dst += BYTES_PER_PIXEL;
	}
	return pixels;
}

export const tobeWbiImageDescriptor: FormatDescriptor = {
	id: "tobe-wbi-image",
	name: "TOBE image",
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
			source: "Legacy/Tobe/ImageWBI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tobeWbiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tobeWbiImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid TOBE image");
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
					bitsPerPixel: BITS_PER_PIXEL,
					rleCode: layout.rleCode,
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
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid TOBE image");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackPixels(
			file,
			layout.rleCode,
			layout.width * layout.height,
		);
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
