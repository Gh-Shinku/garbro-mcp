// Format reference: GARbro "ArcFormats/DigitalWorks/ImageTM2.cs", class `Tim2Format` (PlayStation/2 image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE: Buffer = Buffer.from("TIM2", "latin1");
const EXTENSIONS = ["tm2", "ext"];
/** The reference reads this much of the file before it knows anything else about it. */
const META_HEADER_SIZE = 0x40;
/** The header size field counts from here, and the reference's own header ends right where the data starts. */
const DATA_BASE = 0x10;
const PALETTE_SIZE_FIELD = 0x14;
const HEADER_SIZE_FIELD = 0x1c;
const COLORS_FIELD = 0x1e;
const DEPTH_FIELD = 0x23;
const WIDTH_FIELD = 0x24;
const HEIGHT_FIELD = 0x26;
/** The depth codes the reference takes, and the bits each one stands for. Any other code is not this format. */
const DEPTHS: ReadonlyMap<number, number> = new Map([
	[1, 16],
	[2, 24],
	[3, 32],
	[5, 8],
]);
/** The library's `RgbA` colour map: red, green, blue and alpha, four bytes an entry. */
const PALETTE_ENTRY_SIZE = 4;
/** The palette arrives in blocks of eight colours that are stored in this order and wanted in another. */
const BLOCK_COLORS = 8;
const BLOCK_PARTS = 32;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface Tim2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	headerSize: number;
	colors: number;
	paletteSize: number;
}

async function readLayout(source: ByteSource): Promise<Tim2Layout | undefined> {
	if (source.size < BigInt(META_HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, META_HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		// The reference returns nothing at all for a depth code it does not know, so the word alone is not
		// enough to find this format.
		const bitsPerPixel = DEPTHS.get(header[DEPTH_FIELD] ?? 0);
		if (bitsPerPixel === undefined) return undefined;
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * (bitsPerPixel / 8) > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			headerSize: header.readUInt16LE(HEADER_SIZE_FIELD),
			colors: header.readUInt16LE(COLORS_FIELD),
			paletteSize: header.readInt32LE(PALETTE_SIZE_FIELD),
		};
	} catch {
		return undefined;
	}
}

/**
 * Puts a PlayStation 2 palette back into the order the picture reads it in. The colours arrive in blocks of
 * eight that are laid out by row and then by block, and are wanted by block and then by row, so a palette of
 * four blocks comes out as the first, third, second and fourth. The reference walks whole parts of thirty two
 * colours only, so a palette that does not fill even one of them has none of its colours copied at all and is
 * left as it was allocated — black, here.
 */
function reorderPalette(source: Buffer, colors: number): Buffer {
	const entries: Buffer = Buffer.alloc(colors * PALETTE_ENTRY_SIZE, 0x00);
	const parts = Math.floor(colors / BLOCK_PARTS);
	let destination = 0;
	for (let part = 0; part < parts; part += 1) {
		for (let block = 0; block < 2; block += 1) {
			for (let row = 0; row < 2; row += 1) {
				const stored = (part * 4 + row * 2 + block) * BLOCK_COLORS;
				for (let index = 0; index < BLOCK_COLORS; index += 1) {
					const from = (stored + index) * PALETTE_ENTRY_SIZE;
					// Red, green, blue and alpha into the bitmap's blue, green, red, alpha order.
					entries[destination] = source[from + 2] ?? 0;
					entries[destination + 1] = source[from + 1] ?? 0;
					entries[destination + 2] = source[from] ?? 0;
					entries[destination + 3] = source[from + 3] ?? 0;
					destination += PALETTE_ENTRY_SIZE;
				}
			}
		}
	}
	return entries;
}

export const digitalWorksTim2ImageDescriptor: FormatDescriptor = {
	id: "digital-works-tim2-image",
	name: "PlayStation/2 image",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/DigitalWorks/ImageTM2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const digitalWorksTim2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: digitalWorksTim2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PlayStation/2 image");
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
					bitsPerPixel: layout.bitsPerPixel,
					headerSize: layout.headerSize,
					colors: layout.colors,
					paletteSize: layout.paletteSize,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PlayStation/2 image");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const { width, height, bitsPerPixel } = layout;
		const pixelSize = bitsPerPixel / 8;
		const imageSize = width * height * pixelSize;
		let at = DATA_BASE + layout.headerSize;
		// The library's own read throws when the body does not fit the size the header declares.
		if (at + imageSize > file.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"PlayStation/2 image is truncated",
			);
		}
		const pixels = Buffer.from(file.subarray(at, at + imageSize));
		at += imageSize;
		let palette: Buffer | undefined;
		// The reference tests the pixel size rather than the depth here, which is true for every depth that
		// reaches it, so a colour count on a sixteen, twenty four or thirty two bit image reads a palette as
		// well — and fails if there is none to read.
		if (layout.colors > 0) {
			const needed = layout.colors * PALETTE_ENTRY_SIZE;
			if (at + needed > file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"PlayStation/2 palette is truncated",
				);
			}
			palette = reorderPalette(file.subarray(at, at + needed), layout.colors);
		}
		if (pixelSize >= 3) {
			// The body stores red, green, blue and the bitmap wants blue, green, red.
			for (let index = 0; index < pixels.length; index += pixelSize) {
				const red = pixels[index] ?? 0;
				pixels[index] = pixels[index + 2] ?? 0;
				pixels[index + 2] = red;
			}
		}
		let bitmap: Buffer;
		switch (bitsPerPixel) {
			case 8:
				// An eight bit image without a colour count is handed a null palette by the reference, which
				// cannot make a bitmap of it; the grey ramp stands in here.
				bitmap = palette
					? writeBmp8Palette(width, height, pixels, palette, false)
					: writeBmp8(width, height, pixels, false);
				break;
			case 16:
				bitmap = writeBmp16(width, height, pixels, false);
				break;
			case 24:
				bitmap = writeBmp24(width, height, pixels, false);
				break;
			default:
				bitmap = writeBmp32(width, height, pixels, false);
				break;
		}
		// `ImageData.Create` with no flip: the bitmap is top down with tight rows.
		return Readable.from([bitmap]);
	},
});
