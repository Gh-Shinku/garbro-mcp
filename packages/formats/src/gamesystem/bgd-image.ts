// Format reference: GARbro "ArcFormats/GameSystem/ImageBGD.cs", class `BgdFormat`
// ('GameSystem' background image format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The word of the length, the width and the height, and nothing else. */
const HEADER_SIZE = 0x10;
const LENGTH_FIELD = 0;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const MAXIMUM_SIDE = 0x8000;
/** The picture is always this deep, and every three bytes of the stream hold two of its pixels. */
const BITS_PER_PIXEL = 24;
const BYTES_PER_OP = 3;

/**
 * The reference's `ShiftTable`: which of the three bands of differences the next nibble is read from, by the
 * band and the nibble that came before it.
 */
const SHIFT_TABLE = [
	0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0,
	1, 1, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1,
];

/**
 * The reference's `RgbShift`: the differences a nibble may stand for, in three bands of sixteen, the ones
 * behind the eighth being negative.
 */
const RGB_SHIFT = [
	1, 2, 4, 8, 0x10, 0x26, 0x50, 0xaa, -1, -2, -4, -8, -0x10, -0x26, -0x50,
	-0xaa, 2, 4, 6, 0x0c, 0x18, 0x30, 0x60, 0xc0, -2, -4, -6, -0x0c, -0x18, -0x30,
	-0x60, -0xc0, 5, 0x0a, 0x14, 0x1e, 0x32, 0x50, 0x82, 0xd2, -5, -0x0a, -0x14,
	-0x1e, -0x32, -0x50, -0x82, -0xd2,
];

export interface BgdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `BgdFormat.ReadMetaData`: the word the file opens with is the length of everything behind the header, so a
 * background has to be exactly as long as it says it is. The width and the height follow it, and neither may
 * be nothing or more than 32768.
 */
export function readBgdLayout(data: Buffer): BgdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.readUInt32LE(LENGTH_FIELD) + HEADER_SIZE !== data.length)
		return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || width > MAXIMUM_SIDE) return undefined;
	if (0 === height || height > MAXIMUM_SIDE) return undefined;
	return { width, height, bitsPerPixel: BITS_PER_PIXEL };
}

export const gameSystemBgdImageDescriptor: FormatDescriptor = {
	id: "gamesystem-bgd-image",
	name: "'GameSystem' background image",
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
			source: "ArcFormats/GameSystem/ImageBGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameSystemBgdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameSystemBgdImageDescriptor,
	// The reference registers this format under no word at all, so every file is offered to it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		// The word of the length means the whole file has to be read to check it.
		return readBgdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBgdLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a GameSystem background");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(HEADER_SIZE),
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
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBgdLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a GameSystem background");
		}
		const total = layout.width * layout.height;
		const count = total >> 1;
		if (stored.length < HEADER_SIZE + count * BYTES_PER_OP) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"GameSystem background is cut short of its pixels",
			);
		}
		// Every three bytes hold two pixels of four bits each, and each nibble is the difference to add to
		// the colour the same band of the picture held before.
		const pixels: Buffer = Buffer.alloc(total * 3, 0x00);
		let destination = 0;
		let blue = 0;
		let green = 0;
		let red = 0;
		let b1 = 1;
		let b2 = 1;
		let b3 = 1;
		for (let i = 0; i < count; i += 1) {
			const at = HEADER_SIZE + i * BYTES_PER_OP;
			const op =
				(stored[at] ?? 0) |
				((stored[at + 1] ?? 0) << 8) |
				((stored[at + 2] ?? 0) << 16);
			b1 = (b1 << 4) | (op & 0xf);
			b2 = (b2 << 4) | ((op >> 4) & 0xf);
			b3 = (b3 << 4) | ((op >> 8) & 0xf);
			blue += RGB_SHIFT[b1] ?? 0;
			green += RGB_SHIFT[b2] ?? 0;
			red += RGB_SHIFT[b3] ?? 0;
			pixels[destination] = blue & 0xff;
			pixels[destination + 1] = green & 0xff;
			pixels[destination + 2] = red & 0xff;
			destination += 3;
			b1 = ((SHIFT_TABLE[b1] ?? 0) << 4) | ((op >> 16) & 0xf);
			b2 = ((SHIFT_TABLE[b2] ?? 0) << 4) | ((op >> 20) & 0xf);
			b3 = ((SHIFT_TABLE[b3] ?? 0) << 4) | ((op >> 12) & 0xf);
			blue += RGB_SHIFT[b1] ?? 0;
			green += RGB_SHIFT[b2] ?? 0;
			red += RGB_SHIFT[b3] ?? 0;
			pixels[destination] = blue & 0xff;
			pixels[destination + 1] = green & 0xff;
			pixels[destination + 2] = red & 0xff;
			destination += 3;
			b1 = SHIFT_TABLE[b1] ?? 0;
			b2 = SHIFT_TABLE[b2] ?? 0;
			b3 = SHIFT_TABLE[b3] ?? 0;
		}
		// The rows of the picture are the other way up for a bitmap, which is what the reference's own
		// flipped image means.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
