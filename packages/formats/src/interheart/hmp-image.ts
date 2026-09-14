// Format reference: GARbro "ArcFormats/Interheart/ImageHMP.cs", class `HmpFormat` (Interheart hover map).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference registers no signature at all and gates on the file name: `ReadMetaData` returns nothing
 * unless the name ends in `.hmp`, so the format is reached through that extension alone.
 */
const EXTENSION = ".hmp";
const HEADER_SIZE = 8;
const BITS_PER_PIXEL = 8;
const MAX_DIMENSION = 0x7fff;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/**
 * The reference's `DefaultPalette`: a grey ramp for every index from eight up, then the sixteen colours of
 * the classic palette written over the front of it. Two details are its own and are kept here — the ramp
 * therefore starts at nineteen, not at eight, and index sixteen is assigned **twice** (first `0xFF7F00`,
 * then `0xFF7F7F`), so the second value is the one that stands.
 */
const DEFAULT_PALETTE: Buffer = (() => {
	const colours: Array<[number, number]> = [
		[0, 0x000000],
		[1, 0x00007f],
		[2, 0x007f00],
		[3, 0x007f7f],
		[4, 0x7f0000],
		[5, 0x7f007f],
		[6, 0x7f7f00],
		[7, 0x7f7f7f],
		[8, 0x0000ff],
		[9, 0x00ff00],
		[10, 0x00ffff],
		[11, 0xff0000],
		[12, 0xff00ff],
		[13, 0xffff00],
		[14, 0xffffff],
		[15, 0xff007f],
		[16, 0xff7f00],
		[16, 0xff7f7f],
		[17, 0x7f00ff],
		[18, 0xffff7f],
	];
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let index = 8; index < 0x100; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = index;
		palette[index * 4 + 2] = index;
	}
	// `Color.FromRgb` orders its arguments red, green and blue, and a bitmap palette holds blue first.
	for (const [index, colour] of colours) {
		palette[index * 4] = colour & 0xff;
		palette[index * 4 + 1] = (colour >> 8) & 0xff;
		palette[index * 4 + 2] = (colour >> 16) & 0xff;
	}
	return palette;
})();

interface HmpLayout {
	width: number;
	height: number;
}

async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<HmpLayout | undefined> {
	if (!sourcePath.toLowerCase().endsWith(EXTENSION)) return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(0);
		const height = header.readUInt32LE(4);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		if (width * height > MAX_IMAGE_BYTES) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const interheartHmpImageDescriptor: FormatDescriptor = {
	id: "interheart-hmp-image",
	name: "Interheart hover map",
	extensions: ["hmp"],
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
			source: "ArcFormats/Interheart/ImageHMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const interheartHmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: interheartHmpImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart hover map");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source, "x.hmp");
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart hover map");
		const { width, height } = layout;
		const needed = width * height;
		if (BigInt(HEADER_SIZE + needed) > source.size) {
			// The reference reads what it asks for and hands the short buffer to its image layer, which fails.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Interheart hover map is truncated",
			);
		}
		const stored = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), needed),
		);
		// No stride and no flip in the reference, so the rows are tight and the bitmap is top down.
		return Readable.from([
			writeBmp8Palette(width, height, stored, DEFAULT_PALETTE, false),
		]);
	},
});
