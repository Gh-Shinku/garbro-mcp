// Format reference: GARbro "ArcFormats/Leaf/ImageLGF.cs", class `LgfFormat` (a Leaf image whose fourth byte
// holds the depth, which is also what its three signatures differ in). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The three characters every signature starts with: the reference's constants read back as `lfg`. */
const SIGNATURE = Buffer.from("lfg", "latin1");
/**
 * The fourth byte is the depth, and the reference declares exactly three signatures because of it:
 * `0x1866676C`, `0x2066676C` and `0x0966676C`, i.e. fourth bytes 0x18, 0x20 and 0x09.
 */
const DEPTH_OFFSET = 3;
const VALID_DEPTHS = [9, 24, 32];
const HEADER_SIZE = 8;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 6;
const PALETTE_OFFSET = 12;
const PALETTE_ENTRIES = 0x100;
const PALETTE_ENTRY_SIZE = 4;
const PALETTE_SIZE = PALETTE_ENTRIES * PALETTE_ENTRY_SIZE;

interface LgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the pixels start. */
	pixelOffset: number;
	/** Whether a palette sits between the header and the pixels. */
	hasPalette: boolean;
}

/**
 * `ReadMetaData` reads eight bytes and takes the depth from the fourth, mapping nine to eight. Note that it
 * never looks at bytes eight to eleven, and that the depth is really what its three signatures encode, so a
 * file with a fourth byte of eight is not recognised even though eight is the depth nine maps to.
 */
async function readLayout(source: ByteSource): Promise<LgfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 3).equals(SIGNATURE)) return undefined;
		const declared = header[DEPTH_OFFSET] ?? 0;
		if (!VALID_DEPTHS.includes(declared)) return undefined;
		// Nine is how the reference writes eight, and the depth it reports is eight.
		const bitsPerPixel = declared === 9 ? 8 : declared;
		const width = header.readUInt16LE(WIDTH_OFFSET);
		const height = header.readUInt16LE(HEIGHT_OFFSET);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		const hasPalette = bitsPerPixel === 8;
		return {
			width,
			height,
			bitsPerPixel,
			pixelOffset: PALETTE_OFFSET + (hasPalette ? PALETTE_SIZE : 0),
			hasPalette,
		};
	} catch {
		return undefined;
	}
}

/**
 * `ReadPalette` with `PaletteFormat.RgbX` reads four bytes an entry as red, green, blue and an unused byte, and
 * `ReadColorMap` leaves that order alone — it only converts for `Bgr` and `BgrX`, which means the reader's
 * internal order is the red, green, blue one. A bitmap palette is stored the other way round, so the port
 * swaps the first and third byte of every entry, the same conversion the Hypatia WBM reader documents.
 */
function toBitmapPalette(stored: Buffer): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < PALETTE_ENTRIES; i += 1) {
		palette[i * 4] = stored[i * 4 + 2] ?? 0;
		palette[i * 4 + 1] = stored[i * 4 + 1] ?? 0;
		palette[i * 4 + 2] = stored[i * 4] ?? 0;
		palette[i * 4 + 3] = stored[i * 4 + 3] ?? 0;
	}
	return palette;
}

export const lgfImageDescriptor: FormatDescriptor = {
	id: "leaf-lgf-image",
	name: "Leaf image",
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
			source: "ArcFormats/Leaf/ImageLGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lgfImageDescriptor,
	// The reference's three signatures differ only in their fourth byte, so the gate is the three bytes they
	// share and the depth is checked in detection, where the fuller rule belongs.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf LGF image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the copied pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf LGF image");
		const stride = (layout.width * layout.bitsPerPixel) / 8;
		const needed = stride * layout.height;
		// `Read` compares the count it got with the size it asked for and throws when they differ.
		if (Number(source.size) < layout.pixelOffset + needed)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Leaf LGF image");
		const stored = Buffer.from(
			await source.readAt(BigInt(layout.pixelOffset), needed),
		);
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		if (layout.bitsPerPixel === 8) {
			const palette = toBitmapPalette(
				Buffer.from(await source.readAt(BigInt(PALETTE_OFFSET), PALETTE_SIZE)),
			);
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, stored, palette),
			]);
		}
		if (layout.bitsPerPixel === 24)
			return Readable.from([writeBmp24(layout.width, layout.height, stored)]);
		return Readable.from([writeBmp32(layout.width, layout.height, stored)]);
	},
});
