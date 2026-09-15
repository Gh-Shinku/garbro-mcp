// Format reference: GARbro "Legacy/KeroQ/ImageKGD1.cs", classes `Kgd1Format` and `Kgd1MetaData` (KeroQ image
// format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("KGD1", "latin1");
const HEADER_SIZE = 0x18;
const BPP_FIELD = 6;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xc;
const ALPHA_LENGTH_FIELD = 0x10;
/** A colour map of two hundred and fifty six entries, four bytes each, in the order the reference reads it. */
const PALETTE_SIZE = 0x100 * 4;
const DEPTH_8 = 8;
const DEPTH_24 = 24;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface Kgd1Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	alphaLength: number;
}

function isKgd1Signature(data: Buffer): boolean {
	return data.subarray(0, 4).equals(SIGNATURE);
}

/**
 * `Kgd1Format.ReadMetaData`: a depth of eight or twenty four bits and the measurements behind it, with a
 * length of transparency behind those — the transparency of the picture is kept as a stream of its own, and
 * a length of nothing says there is none. The reference looks at no more than this, so a file whose pixels
 * are cut short is claimed here and refused when it is read.
 */
export function readKgd1Layout(data: Buffer): Kgd1Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!isKgd1Signature(data)) return undefined;
	const bitsPerPixel = data.readInt16LE(BPP_FIELD);
	if (bitsPerPixel !== DEPTH_8 && bitsPerPixel !== DEPTH_24) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	// The reference would build an empty image; nothing can be drawn from one.
	if (width === 0 || height === 0) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		alphaLength: data.readInt32LE(ALPHA_LENGTH_FIELD),
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Kgd1Format.ApplyAlphaChannel`: the transparency is stored as its own opposite, so a byte is turned over. */
function applyAlpha(
	layout: Kgd1Layout,
	pixels: Buffer,
	palette: Buffer | undefined,
	alpha: Buffer,
): Buffer {
	const count = layout.width * layout.height;
	const output: Buffer = Buffer.alloc(count * 4, 0x00);
	if (DEPTH_24 === layout.bitsPerPixel) {
		for (let index = 0; index < count; index += 1) {
			output[index * 4] = pixels[index * 3] ?? 0;
			output[index * 4 + 1] = pixels[index * 3 + 1] ?? 0;
			output[index * 4 + 2] = pixels[index * 3 + 2] ?? 0;
			output[index * 4 + 3] = ~(alpha[index] ?? 0) & 0xff;
		}
	} else {
		for (let index = 0; index < count; index += 1) {
			const entry = (pixels[index] ?? 0) * 4;
			output[index * 4] = palette?.[entry] ?? 0;
			output[index * 4 + 1] = palette?.[entry + 1] ?? 0;
			output[index * 4 + 2] = palette?.[entry + 2] ?? 0;
			output[index * 4 + 3] = ~(alpha[index] ?? 0) & 0xff;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const keroqKgd1ImageDescriptor: FormatDescriptor = {
	id: "keroq-kgd1-image",
	name: "KeroQ image format",
	extensions: ["kgd"],
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
			source: "Legacy/KeroQ/ImageKGD1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const keroqKgd1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keroqKgd1ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readKgd1Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readKgd1Layout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a KeroQ image");
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
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 0 !== layout.alphaLength ? 32 : layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readKgd1Layout(stored);
		if (!layout) {
			throw invalidPicture("Not a KeroQ image");
		}
		const count = layout.width * layout.height;
		const pixelBytes = count * (layout.bitsPerPixel >> 3);
		if (
			!Number.isSafeInteger(pixelBytes) ||
			pixelBytes > MAXIMUM_PICTURE_BYTES
		) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`KeroQ image of ${pixelBytes} bytes is too large`,
			);
		}
		let offset = HEADER_SIZE;
		let alpha: Buffer | undefined;
		if (0 !== layout.alphaLength) {
			// A length of nothing but not a length of bytes is refused here, where the reference's own reading
			// of them would throw before it looks at the picture.
			if (
				layout.alphaLength < 0 ||
				offset + layout.alphaLength > stored.length
			) {
				throw invalidPicture("KeroQ image is cut short of its transparency");
			}
			if (layout.alphaLength < count) {
				throw invalidPicture("KeroQ image holds no transparency to speak of");
			}
			alpha = stored.subarray(offset, offset + layout.alphaLength);
			offset += layout.alphaLength;
		}
		let palette: Buffer | undefined;
		if (DEPTH_8 === layout.bitsPerPixel) {
			if (offset + PALETTE_SIZE > stored.length) {
				throw invalidPicture("KeroQ image carries no whole colour map");
			}
			palette = stored.subarray(offset, offset + PALETTE_SIZE);
			offset += PALETTE_SIZE;
		}
		if (offset + pixelBytes > stored.length) {
			throw invalidPicture("KeroQ image is cut short of its pixels");
		}
		const pixels = stored.subarray(offset, offset + pixelBytes);
		if (alpha) {
			return Readable.from([
				writeBmp32(
					layout.width,
					layout.height,
					applyAlpha(layout, pixels, palette, alpha),
				),
			]);
		}
		if (DEPTH_24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, Buffer.from(pixels)),
			]);
		}
		if (!palette) {
			throw invalidPicture("KeroQ image carries no whole colour map");
		}
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				Buffer.from(pixels),
				Buffer.from(palette),
			),
		]);
	},
});
