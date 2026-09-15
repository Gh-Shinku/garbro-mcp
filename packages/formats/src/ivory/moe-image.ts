// Format reference: GARBro "ArcFormats/Ivory/ImageMOE.cs", class `MoeFormat`. The picture is a run of raw and
// repeated pixels, of a depth that comes from the name of the file rather than from the file itself.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference declares no signature: the first four bytes are the measurements of the picture. */
const HEADER_SIZE = 4;
const MAXIMUM_WIDTH = 800;
const MAXIMUM_HEIGHT = 600;
const DEPTH_GREY = 8;
const DEPTH_COLOUR = 24;
/** The grey picture holds seventeen shades, the last of which is white. */
const MAXIMUM_ALPHA = 0x10;
const PALETTE_SIZE = 0x100 * 4;

export interface MoeLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	bytesPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MoeFormat.ReadMetaData`: the first four bytes hold the measurements, the width in the lower half of the
 * word and the height in the upper half. The picture may measure up to eight hundred by six hundred, and the
 * depth comes from the name of the file rather than from the file itself: a file named `.shw` holds a grey
 * picture of one byte to the pixel and every other one a picture of three.
 */
export function readMoeLayout(
	data: Buffer,
	grey: boolean,
): MoeLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const word = data.readUInt32LE(0);
	const width = word & 0xffff;
	const height = (word >>> 16) & 0xffff;
	if (0 === width || width > MAXIMUM_WIDTH) return undefined;
	if (0 === height || height > MAXIMUM_HEIGHT) return undefined;
	const bitsPerPixel = grey ? DEPTH_GREY : DEPTH_COLOUR;
	const bytesPerPixel = bitsPerPixel / 8;
	if (!isValidMoeInput(data, width, height, bytesPerPixel)) return undefined;
	return { width, height, bitsPerPixel, bytesPerPixel };
}

/** The name decides the depth, and the reference asks for the letters in their upper case spelling. */
export function hasShwExtension(sourcePath: string): boolean {
	return sourcePath
		.replace(/^.*[/\\]/, "")
		.toUpperCase()
		.endsWith(".SHW");
}

/**
 * `MoeFormat.IsValidInput`: the stream is walked without reading it, to see whether it holds a whole picture.
 * A control byte of `0x80` and above stands for that many pixels less one hundred and twenty eight that stand
 * in the stream themselves, and any other control byte for that many pixels taken from the one behind them,
 * which stand in the stream once. The picture is whole when the walk lands on its last pixel and not past it;
 * a walk that asks for a pixel the stream does not hold leaves the picture turned away.
 */
export function isValidMoeInput(
	data: Buffer,
	width: number,
	height: number,
	bytesPerPixel: number,
): boolean {
	const total = width * height;
	let at = HEADER_SIZE;
	let dst = 0;
	while (dst < total) {
		if (at >= data.length) return false;
		let count = data[at++] ?? 0;
		if (0 !== (count & 0x80)) {
			count = Math.min(count & 0x7f, total - dst);
			at += count * bytesPerPixel;
		} else {
			at += bytesPerPixel;
		}
		dst += count;
		if (dst > total) return false;
	}
	return true;
}

/**
 * `MoeFormat.Read`: the same walk, taking the pixels out of the stream. A run of pixels that stand in the
 * stream reads as many as the picture still holds room for and leaves the rest as they stand; a run that
 * repeats the pixel behind it reads one pixel and copies it forward, so the pixel behind can be the one the
 * run has just written. A stream that runs out where a control byte is wanted is refused, as is a run that
 * writes past the picture — which the reference's own reader answers with an exception — and a run of no
 * pixels, which the reference's own copy refuses as well.
 */
export function decodeMoe(data: Buffer, layout: MoeLayout): Buffer {
	const { bytesPerPixel } = layout;
	const pixels: Buffer = Buffer.alloc(
		bytesPerPixel * layout.width * layout.height,
		0x00,
	);
	let at = HEADER_SIZE;
	let dst = 0;
	while (dst < pixels.length) {
		const control = at < data.length ? (data[at++] ?? 0) : -1;
		if (-1 === control) {
			throw invalidPicture("Ivory picture is cut short of its stream");
		}
		if (0 !== (control & 0x80)) {
			const count = Math.min(
				bytesPerPixel * (control & 0x7f),
				pixels.length - dst,
			);
			const room = Math.max(0, Math.min(count, data.length - at));
			data.copy(pixels, dst, at, at + room);
			at += room;
			dst += count;
			continue;
		}
		const count = control * bytesPerPixel;
		if (count < bytesPerPixel) {
			throw invalidPicture("Ivory picture holds a run of no pixels");
		}
		if (dst + count > pixels.length) {
			throw invalidPicture("Ivory picture writes past its own end");
		}
		const room = Math.max(0, Math.min(bytesPerPixel, data.length - at));
		data.copy(pixels, dst, at, at + room);
		at += room;
		// The pixel behind stands exactly one pixel back, so the copy reads what it has just written.
		if (
			!copyOverlapped(pixels, dst, dst + bytesPerPixel, count - bytesPerPixel)
		) {
			throw invalidPicture("Ivory picture writes past its own end");
		}
		dst += count;
	}
	return pixels;
}

/** `MoeFormat.Read`: the grey picture carries a ramp of seventeen shades, black to white, and nothing behind. */
export function greyRampPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let index = 0; index <= MAXIMUM_ALPHA; index += 1) {
		const shade = Math.trunc((index * 0xff) / MAXIMUM_ALPHA);
		palette[index * 4] = shade;
		palette[index * 4 + 1] = shade;
		palette[index * 4 + 2] = shade;
	}
	return palette;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ivoryMoeImageDescriptor: FormatDescriptor = {
	id: "ivory-moe-image",
	name: "Ivory image format",
	extensions: ["moe", "shw"],
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
			source: "ArcFormats/Ivory/ImageMOE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ivoryMoeImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivoryMoeImageDescriptor,
	// The reference declares no signature at all, so the format is a candidate for every file and the walk
	// over the stream is what tells a picture apart.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return (
			readMoeLayout(await readStored(source), hasShwExtension(sourcePath)) !==
			undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const grey = hasShwExtension(sourcePath);
		const layout = readMoeLayout(await readStored(source), grey);
		if (!layout) {
			throw invalidPicture("Not an Ivory picture");
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
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "ivory",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = await readStored(source);
		// The depth comes from the name of the file, which the entry no longer carries, so it is read back out
		// of what the listing kept of it.
		const depth = Number(entry.metadata?.bitsPerPixel ?? DEPTH_COLOUR);
		const layout = readMoeLayout(stored, DEPTH_GREY === depth);
		if (!layout) {
			throw invalidPicture("Not an Ivory picture");
		}
		const pixels = decodeMoe(stored, layout);
		if (DEPTH_COLOUR === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, false),
			]);
		}
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				pixels,
				greyRampPalette(),
				false,
			),
		]);
	},
});
