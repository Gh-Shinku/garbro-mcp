// Format reference: GARbro "ArcFormats/Pandora/ImageXL24.cs", class `Xl24Format` (the "Pandora.box" picture
// format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four letters the reference signs this format with. */
const SIGNATURE = Buffer.from("XL24", "latin1");
const HEADER_SIZE = 0x10;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 12;
/** The depth the reference always reports, whatever the file says. */
const BITS_PER_PIXEL = 24;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Xl24Layout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Xl24Format.ReadMetaData`: the four letters, four bytes the reference skips, and the measurements, which the
 * stream of the picture begins right behind at `0x10`.
 */
export function readXl24Layout(data: Buffer): Xl24Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	return { width, height };
}

/** How many bytes the pixels of a picture of these measurements take. */
export function xl24PixelBytes(layout: Xl24Layout): number {
	return layout.width * layout.height * 3;
}

/** The pixel a payload of the given length holds, taken from the stream as far as it goes. */
function readPixel(
	data: Buffer,
	position: number,
	pixels: Buffer,
	dst: number,
	count: number,
): void {
	if (dst + count > pixels.length) {
		throw invalidPicture("Pandora picture writes past its own end");
	}
	let end = position + count;
	if (end > data.length) end = data.length;
	if (end > position) {
		data.copy(pixels, dst, position, end);
	}
}

/**
 * `Xl24Format.Read`: the stream is walked a row at a time, from the **bottom** row up, and every row but the
 * bottom one is exclusive-or'd with the row below it once it stands. A row is built of pixels whose control
 * byte says what to do: nothing skips a byte — one pixel for a byte of one, and two plus what the byte behind
 * the control holds for the byte of nothing; `0x80` ends the row; `0xFF` puts down one pixel and carries it
 * through the rest of the row; a byte above `0x80` puts down one pixel and carries it through as many pixels
 * as the control says past the first; and a byte below it puts down that many pixels themselves. The colours
 * of a run are the same pixel repeated, which is why a run of them is copied with the overlap the reference
 * uses, and a picture whose stream stops in the middle of a control byte is refused, while a payload that
 * stops early simply leaves the rest of that pixel as it stands, the way the .NET stream does.
 */
export function unpackXl24(data: Buffer, layout: Xl24Layout): Buffer {
	const stride = layout.width * 3;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let position = HEADER_SIZE;
	let previousLine = 0;
	let line = pixels.length - stride;
	while (line >= 0) {
		let dst = line;
		let x = layout.width;
		while (x > 0) {
			if (position >= data.length) {
				throw invalidPicture("Pandora picture is cut short of its stream");
			}
			const control = data[position] ?? 0;
			position += 1;
			if (0 === control) {
				if (position >= data.length) {
					throw invalidPicture("Pandora picture is cut short of its stream");
				}
				const count = (data[position] ?? 0) + 2;
				position += 1;
				dst += 3 * count;
				x -= count;
			} else if (1 === control) {
				dst += 3;
				x -= 1;
			} else if (0x80 === control) {
				x = 0;
			} else if (0xff === control) {
				readPixel(data, position, pixels, dst, 3);
				position = Math.min(position + 3, data.length);
				x -= 1;
				if (x > 0) {
					if (!copyOverlapped(pixels, dst, dst + 3, x * 3)) {
						throw invalidPicture("Pandora picture writes past its own end");
					}
				}
				x = 0;
			} else if (control > 0x80) {
				const count = control - 0x80;
				readPixel(data, position, pixels, dst, 3);
				position = Math.min(position + 3, data.length);
				if (count > 1) {
					if (!copyOverlapped(pixels, dst, dst + 3, (count - 1) * 3)) {
						throw invalidPicture("Pandora picture writes past its own end");
					}
				}
				dst += count * 3;
				x -= count;
			} else {
				const count = 3 * control;
				readPixel(data, position, pixels, dst, count);
				position = Math.min(position + count, data.length);
				dst += count;
				x -= control;
			}
		}
		if (previousLine !== 0) {
			for (let index = 0; index < stride; index += 1) {
				pixels[line + index] =
					(pixels[line + index] ?? 0) ^ (pixels[previousLine + index] ?? 0);
			}
		}
		previousLine = line;
		line -= stride;
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const pandoraXl24ImageDescriptor: FormatDescriptor = {
	id: "pandora-xl24-image",
	name: '"Pandora.box" image format',
	extensions: ["bmp"],
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
			source: "ArcFormats/Pandora/ImageXL24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pandoraXl24ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pandoraXl24ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readXl24Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readXl24Layout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Pandora picture");
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
							bitsPerPixel: BITS_PER_PIXEL,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readXl24Layout(stored);
		if (!layout) {
			throw invalidPicture("Not a Pandora picture");
		}
		const size = xl24PixelBytes(layout);
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Pandora picture of ${size} bytes is too large`,
			);
		}
		// The rows are unfolded from the bottom up, which fills the buffer of a bitmap that is stored from
		// the top down — the row the stream begins with is the bottom row of the picture, the one the reader
		// of the reference hands on as its last.
		const pixels = unpackXl24(stored, layout);
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
