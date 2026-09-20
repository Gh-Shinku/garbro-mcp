// Format reference: GARbro "Legacy/MayBeSoft/ImageHHP.cs", classes `HhpFormat`, `HhpReader` (a fixed size
// May-Be Soft picture of a colour map and a bit stream of runs that walk down its columns). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference gates on this extension and hands out a picture of a fixed size. */
const EXTENSION = "hhp";
const WIDTH = 640;
const HEIGHT = 400;
/** The colour map stands first, three bytes an entry, red, green and blue. */
const PALETTE_SIZE = 0x100 * 3;
const PIXEL_OFFSET = PALETTE_SIZE;
/** The number of bits the two kinds of count are read with, told apart by two or three bits. */
const LENGTH_TABLE = [4, 6, 8, 0x14];
const SKIP_TABLE = [0, 0, 1, -1, 2, -2];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface HhpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `HhpFormat.ReadMetaData`: the reference gates on the `.HHP` extension and hands out a picture of six hundred
 * and forty by four hundred, eight bits a pixel, without looking inside the file. The port keeps the gate and
 * asks for the colour map behind it, so a file that cannot even hold one is not offered.
 */
export function readHhpLayout(
	data: Buffer,
	sourcePath: string,
): HhpLayout | undefined {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (data.length < PIXEL_OFFSET) return undefined;
	return { width: WIDTH, height: HEIGHT, bitsPerPixel: 8 };
}

/** The colour map turned into the four byte entries a bitmap wants: blue, green, red and nothing. */
function readHhpPalette(data: Buffer): Buffer {
	const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		entries[index * 4] = data[index * 3 + 2] ?? 0;
		entries[index * 4 + 1] = data[index * 3 + 1] ?? 0;
		entries[index * 4 + 2] = data[index * 3] ?? 0;
	}
	return entries;
}

/**
 * `HhpReader.Unpack`: the stream behind the colour map is read from the highest bit of every byte down. A walk
 * of runs begins at one place behind the start, so the first count says how far the first pixel stands: two
 * bits name how many bits the count is read with, and a count of nothing ends the walk. Behind the pixel
 * stands a walk down the column it belongs to: three bits name a place, of which nothing ends the walk and
 * six reads a count that carries the place whole rows down; every other place steps the place one row down and
 * as far aside as the table says, and writes the same pixel there.
 *
 * When the walk is done every pixel that was left at nothing takes the last value seen before it, and a value
 * that meets its own repeat turns to nothing and clears the one it carries. A stream that stops where a code
 * or a count is wanted is refused, where the reference's own bit reader would take nothing on the lengths it
 * reads separately (a documented deviation in the message only).
 */
export function unpackHhp(data: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(WIDTH * HEIGHT, 0x00);
	let bitPosition = PIXEL_OFFSET * 8;
	const totalBits = data.length * 8;
	const getBits = (count: number): number => {
		if (bitPosition + count > totalBits) {
			throw invalidPicture("May-Be Soft picture is cut short of its stream");
		}
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			const byte = data[bitPosition >> 3] ?? 0;
			const bit = (byte >> (7 - (bitPosition & 7))) & 1;
			value = (value << 1) | bit;
			bitPosition += 1;
		}
		return value;
	};
	let dst = -1;
	while (dst < output.length) {
		const code = getBits(2);
		const count = getBits(LENGTH_TABLE[code] ?? 4);
		if (0 === count) break;
		dst += count;
		const pixel = getBits(8);
		if (dst < 0 || dst >= output.length) {
			throw invalidPicture("May-Be Soft picture writes past its own end");
		}
		output[dst] = pixel;
		let position = dst;
		for (;;) {
			const step = getBits(3);
			if (0 === step) break;
			if (6 === step) {
				const kind = getBits(2);
				const rows = getBits(LENGTH_TABLE[kind] ?? 4);
				position += WIDTH * rows;
			} else {
				position += WIDTH + (SKIP_TABLE[step] ?? 0);
				if (position < 0 || position >= output.length) {
					throw invalidPicture("May-Be Soft picture writes past its own end");
				}
				output[position] = pixel;
			}
		}
	}
	let repeat = 0;
	for (let index = 0; index < output.length; index += 1) {
		const pixel = output[index] ?? 0;
		if (0 === pixel) {
			output[index] = repeat;
		} else if (pixel === repeat) {
			output[index] = 0;
			repeat = 0;
		} else {
			repeat = pixel;
		}
	}
	return output;
}

async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<HhpLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(PIXEL_OFFSET)) return undefined;
	return { width: WIDTH, height: HEIGHT, bitsPerPixel: 8 };
}

export const mayBeSoftHhpImageDescriptor: FormatDescriptor = {
	id: "may-be-soft-hhp-image",
	name: "May-Be Soft image format",
	extensions: [EXTENSION],
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
			source: "Legacy/MayBeSoft/ImageHHP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mayBeSoftHhpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mayBeSoftHhpImageDescriptor,
	// The reference declares no signature word; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a May-Be Soft picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const size = layout.width * layout.height * 4;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`May-Be Soft picture of ${size} bytes is too large`,
			);
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(PIXEL_OFFSET),
				size: source.size - BigInt(PIXEL_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The pixels are unfolded from a bit stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored.length < PIXEL_OFFSET) {
			throw invalidPicture(
				"May-Be Soft picture is cut short of its colour map",
			);
		}
		const pixels = unpackHhp(stored);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp8Palette(WIDTH, HEIGHT, pixels, readHhpPalette(stored), true),
		]);
	},
});
