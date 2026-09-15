// Format reference: GARbro "ArcFormats/Hypatia/ImageLSG.cs", classes `LsgFormat` and `LsgMetaData`
// (Kogado image format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `BM`, the word the reference registers the format under, and the header behind it. */
const SIGNATURE: Buffer = Buffer.from("BM", "latin1");
const HEADER_SIZE = 0x14;
const SIZE_FIELD = 4;
const DEPTH_FIELD = 8;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x10;
/** The two depths the reference reads, and nothing else. */
const DEPTHS = new Set([8, 24]);
/** The colour map a picture of eight bits is handed is a companion file, or the ramp of greys behind it. */
const PALETTE_EXTENSION = "pal";
const DEFAULT_PALETTE = "base.pal";
const PALETTE_ENTRIES = 0x100;
/** The companion holds three bytes to a colour where a bitmap entry holds four. */
const PALETTE_SIZE = PALETTE_ENTRIES * 3;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface LsgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The length of the pixels the header declares. */
	bitmapSize: number;
}

/**
 * The reference's `LsgFormat.ReadMetaData`: the header of this format is not the header of a bitmap, even
 * though it opens with the word a bitmap opens with. A picture of any depth but eight or twenty four bits is
 * not one this format claims.
 */
export function readLsgLayout(data: Buffer): LsgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	if (!DEPTHS.has(bitsPerPixel)) return undefined;
	return {
		bitmapSize: data.readInt32LE(SIZE_FIELD),
		bitsPerPixel,
		width: data.readUInt32LE(WIDTH_FIELD),
		height: data.readUInt32LE(HEIGHT_FIELD),
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * The colour map of a picture of eight bits, which the reference reads from the companion file named after
 * the picture, or from `base.pal` beside it. Its entries are red, green and blue, where a bitmap keeps blue,
 * green and red and a byte of its own behind them. A companion that holds less than a whole map is refused,
 * where the reference fails on it outright.
 */
async function readLsgPalette(sourcePath: string): Promise<Buffer | undefined> {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	const raw =
		(await readCompanionFile(
			sourcePath,
			changeExtension(name, PALETTE_EXTENSION),
		)) ?? (await readCompanionFile(sourcePath, DEFAULT_PALETTE));
	if (!raw) return undefined;
	if (raw.length < PALETTE_SIZE) {
		throw invalidPicture("Kogado picture holds no whole colour map");
	}
	const palette: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let i = 0; i < PALETTE_ENTRIES; i += 1) {
		palette[i * 4] = raw[i * 3 + 2] ?? 0;
		palette[i * 4 + 1] = raw[i * 3 + 1] ?? 0;
		palette[i * 4 + 2] = raw[i * 3] ?? 0;
	}
	return palette;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const hypatiaLsgImageDescriptor: FormatDescriptor = {
	id: "hypatia-lsg-image",
	name: "Kogado image",
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
			source: "ArcFormats/Hypatia/ImageLSG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hypatiaLsgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hypatiaLsgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readLsgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLsgLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Kogado picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Kogado picture size ${layout.width}x${layout.height}`,
			);
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
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							bitmapSize: layout.bitmapSize,
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
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readLsgLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Kogado picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Kogado picture size ${layout.width}x${layout.height}`,
			);
		}
		// The pixels are kept one behind the other, with no padding between the rows of the picture.
		const length = layout.width * layout.height * (layout.bitsPerPixel >> 3);
		if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Kogado picture of ${length} bytes is too large`,
			);
		}
		if (stored.length < HEADER_SIZE + length) {
			throw invalidPicture("Kogado picture is cut short of its pixels");
		}
		const pixels = Buffer.from(
			stored.subarray(HEADER_SIZE, HEADER_SIZE + length),
		);
		if (24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		const palette = await readLsgPalette(sourcePath);
		return Readable.from([
			palette
				? writeBmp8Palette(layout.width, layout.height, pixels, palette)
				: writeBmp8(layout.width, layout.height, pixels),
		]);
	},
});
