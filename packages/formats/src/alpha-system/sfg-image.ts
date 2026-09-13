// Format reference: GARbro "Legacy/AlphaSystem/ImageSFG.cs", class `SfgFormat` (Alpha System image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
/** The depth field holds a count of *planes*, not bits, and only one and four are legal. */
const MONO_PLANES = 1;
const COLOUR_PLANES = 4;
const PALETTE_ENTRIES = 0x100;
const PALETTE_BYTES = PALETTE_ENTRIES * 4;
const PALETTE_OFFSET = HEADER_SIZE;
/** The palette only exists for the one plane depth. */
const MONO_PALETTE_BYTES = 0x400;

interface SfgLayout {
	width: number;
	height: number;
	/** The depth field as the file stores it: one or four. */
	planes: number;
	/** The depth in bits a pixel: eight or thirty two. */
	bitsPerPixel: number;
}

/**
 * There is no signature at all, so everything the format knows comes from eight bytes and one comparison. The
 * dimensions and the plane count are read first, and then a length the file has to match **exactly**: the
 * pixels, plus the header, plus a kilobyte of palette when there is one. That equality is what does the work a
 * signature would otherwise do, and it is why a truncated or padded file is not recognised.
 *
 * The reference computes that length in a thirty two bit integer, so a huge pair of dimensions wraps. A wrapped
 * value is almost always negative and therefore never equals a real file's length, which declines; a wrapped
 * value that happens to be positive and to match is accepted, and the port follows it there too rather than
 * adding a width or height limit of its own.
 */
async function readFields(source: ByteSource): Promise<SfgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const planes = head.readUInt16LE(0);
		const width = head.readUInt16LE(2);
		const height = head.readUInt16LE(4);
		if (
			(planes !== MONO_PLANES && planes !== COLOUR_PLANES) ||
			width === 0 ||
			height === 0
		)
			return undefined;
		let expected = (width * height * planes + HEADER_SIZE) | 0;
		if (planes === MONO_PLANES) expected = (expected + MONO_PALETTE_BYTES) | 0;
		if (BigInt(expected) !== source.size) return undefined;
		return {
			width,
			height,
			planes,
			bitsPerPixel: planes * 8,
		};
	} catch {
		return undefined;
	}
}

export const sfgImageDescriptor: FormatDescriptor = {
	id: "alpha-system-sfg-image",
	name: "Alpha System image",
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
			source: "Legacy/AlphaSystem/ImageSFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sfgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sfgImageDescriptor,
	// No signature and no extension: the exact length is the whole gate.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Alpha System image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
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
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Alpha System image");
		// The exact length check means the pixels are exactly as long as the buffer, so every read here is
		// complete and the reference's tolerance for a short stream cannot be reached.
		const pixelSize = pixelBytes(layout);
		const pixels = Buffer.from(
			await source.readAt(BigInt(source.size) - BigInt(pixelSize), pixelSize),
		);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		if (layout.planes === MONO_PLANES) {
			// The palette is read in the blue-green-red-alpha order, which is already what a bitmap wants, so
			// the four bytes are carried across unchanged.
			const palette = Buffer.from(
				await source.readAt(BigInt(PALETTE_OFFSET), PALETTE_BYTES),
			);
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette, false),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});

/** The pixels are the whole file less the header and, for the one plane depth, the palette. */
function pixelBytes(layout: SfgLayout): number {
	return layout.width * layout.height * layout.planes;
}
