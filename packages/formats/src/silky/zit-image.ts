// Format reference: GARbro "ArcFormats/Silky/ImageZIT.cs", class `ZitFormat` (Silky's image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The three words the reference registers. Each is the marker `ZT` followed by a **type** word, and it is that
 * word which decides how the pixels behind the header are stored, so a file's type is always one of these three.
 */
const TYPE_BGR = 0x1803;
const TYPE_BGRA = 0x2084;
const TYPE_PALETTE = 0x8803;
const SIGNATURES: Buffer[] = [TYPE_BGR, TYPE_BGRA, TYPE_PALETTE].map((type) => {
	const bytes: Buffer = Buffer.alloc(4, 0x00);
	bytes.write("ZT", 0, "latin1");
	bytes.writeUInt16LE(type, 2);
	return bytes;
});
const EXTENSIONS: string[] = [];
const HEADER_SIZE = 0x10;
const TYPE_FIELD = 2;
const COLORS_FIELD = 4;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 10;
/** The colour a green pixel stands for, and what each unpacker writes in its place. */
const KEY_RED = 0;
const KEY_GREEN = 0xff;
const KEY_BLUE = 0;
const BGR_KEY_WORD = 0xffff;
const PALETTE_KEY_WORD = 0xff00;
const PALETTE_ENTRY_SIZE = 3;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface ZitLayout {
	width: number;
	height: number;
	imageType: number;
	colors: number;
}

async function readLayout(source: ByteSource): Promise<ZitLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const signature = header.subarray(0, 4);
		if (!SIGNATURES.some((candidate) => candidate.equals(signature)))
			return undefined;
		const imageType = header.readUInt16LE(TYPE_FIELD);
		// The reference throws for a type its reader does not know, which its own registration makes unreachable.
		if (
			imageType !== TYPE_BGR &&
			imageType !== TYPE_BGRA &&
			imageType !== TYPE_PALETTE
		) {
			return undefined;
		}
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * 4 > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			imageType,
			colors: header.readUInt16LE(COLORS_FIELD),
		};
	} catch {
		return undefined;
	}
}

/** Writes one pixel in the bitmap's own blue, green, red, alpha order. */
function writePixel(
	output: Buffer,
	destination: number,
	blue: number,
	green: number,
	red: number,
	alpha: number,
): void {
	output[destination] = blue;
	output[destination + 1] = green;
	output[destination + 2] = red;
	output[destination + 3] = alpha;
}

/** The four bytes the reference packs as a whole word when it meets its colour key. */
function writeKeyWord(output: Buffer, destination: number, word: number): void {
	output.writeUInt32LE(word >>> 0, destination);
}

export const silkyZitImageDescriptor: FormatDescriptor = {
	id: "silky-zit-image",
	name: "Silky's image",
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
			source: "ArcFormats/Silky/ImageZIT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const silkyZitImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyZitImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's image");
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
					// The reference describes every one of its three kinds as thirty two bits.
					bitsPerPixel: 32,
					imageType: layout.imageType,
					colors: layout.colors,
				} as Record<string, unknown>,
			}),
			sizeKnown: layout.imageType !== TYPE_BGRA,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's image");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
		let position = HEADER_SIZE;
		if (layout.imageType === TYPE_BGR) {
			// Three bytes a pixel, blue, green and red, with the green colour a key rather than a colour.
			for (let destination = 0; destination < pixels.length; destination += 4) {
				if (position + 3 > file.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Silky's image is truncated",
					);
				}
				const blue = file[position] ?? 0;
				const green = file[position + 1] ?? 0;
				const red = file[position + 2] ?? 0;
				position += 3;
				if (blue === KEY_BLUE && green === KEY_GREEN && red === KEY_RED) {
					writeKeyWord(pixels, destination, BGR_KEY_WORD);
				} else {
					writePixel(pixels, destination, blue, green, red, 0xff);
				}
			}
		} else if (layout.imageType === TYPE_BGRA) {
			// Four bytes a pixel, straight into the bitmap. The reference ignores how much its read returned, so
			// a body that stops short leaves the pixels it did not reach as they were allocated.
			file.copy(
				pixels,
				0,
				position,
				Math.min(file.length, position + pixels.length),
			);
		} else {
			const paletteSize = layout.colors * PALETTE_ENTRY_SIZE;
			if (position + paletteSize > file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Silky's palette is truncated",
				);
			}
			const palette = file.subarray(position, position + paletteSize);
			position += paletteSize;
			for (let destination = 0; destination < pixels.length; destination += 4) {
				if (position >= file.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Silky's image is truncated",
					);
				}
				const index = (file[position] ?? 0) * PALETTE_ENTRY_SIZE;
				position += 1;
				if (index + PALETTE_ENTRY_SIZE > palette.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Silky's palette index is out of range",
					);
				}
				const blue = palette[index] ?? 0;
				const green = palette[index + 1] ?? 0;
				const red = palette[index + 2] ?? 0;
				if (blue === KEY_BLUE && green === KEY_GREEN && red === KEY_RED) {
					// The palette kind writes a different word than the three byte kind does.
					writeKeyWord(pixels, destination, PALETTE_KEY_WORD);
				} else {
					writePixel(pixels, destination, blue, green, red, 0xff);
				}
			}
		}
		// `ImageData.Create` with no flip: the bitmap is top down with tight rows.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
