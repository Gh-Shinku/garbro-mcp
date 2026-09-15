// Format reference: GARbro "ArcFormats/VnEngine/ImageZAW.cs", class `ZawFormat` (GEM/vnengine image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { crc32, inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `ZAW`, and the header of sixty four bytes behind it. */
const SIGNATURE: Buffer = Buffer.from("ZAW", "ascii");
const HEADER_SIZE = 0x40;
/** The word of the checksum, which the check is made over once it has been cleared. */
const CHECKSUM_FIELD = 4;
/** The byte naming the depth of the picture. */
const DEPTH_FIELD = 0x0c;
const WIDTH_FIELD = 0x10;
const HEIGHT_FIELD = 0x14;
const OFFSET_X_FIELD = 0x18;
const OFFSET_Y_FIELD = 0x1c;
/** The depths the byte names. The reference reads a `1` as twenty four bits and anything else as eight. */
const DEPTH_32 = 3;
const DEPTH_16 = 2;
const DEPTH_24 = 1;
const BPP_32 = 32;
const BPP_16 = 16;
const BPP_24 = 24;
const BPP_8 = 8;
/** Where the pixels start, and how much of them the reference unfolds at once. */
const PIXELS_OFFSET = 0x40;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface ZawLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
}

/**
 * `ZawFormat.ReadMetaData`: the header carries a checksum of itself with its own word cleared, and a picture
 * whose checksum does not hold up is not one this format claims. Behind it sit the depth of the picture as a
 * byte, its width, its height and where its corner lies.
 */
export function readZawLayout(data: Buffer): ZawLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const header = Buffer.from(data.subarray(0, HEADER_SIZE));
	const declared = header.readUInt32LE(CHECKSUM_FIELD);
	header.writeUInt32LE(0, CHECKSUM_FIELD);
	if (crc32(header) >>> 0 !== declared) return undefined;
	const depth = header[DEPTH_FIELD] ?? 0;
	const bitsPerPixel =
		DEPTH_32 === depth
			? BPP_32
			: DEPTH_16 === depth
				? BPP_16
				: DEPTH_24 === depth
					? BPP_24
					: BPP_8;
	return {
		width: header.readUInt32LE(WIDTH_FIELD),
		height: header.readUInt32LE(HEIGHT_FIELD),
		offsetX: header.readInt32LE(OFFSET_X_FIELD),
		offsetY: header.readInt32LE(OFFSET_Y_FIELD),
		bitsPerPixel,
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The reference's own scaling of a half and a byte's worth of alpha into a whole byte, clamped. */
function scaleAlpha(value: number): number {
	return Math.min(Math.floor((value * 0xff) / 0x80), 0xff);
}

export const vnEngineZawImageDescriptor: FormatDescriptor = {
	id: "vn-engine-zaw-image",
	name: "GEM/vnengine image",
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
			source: "ArcFormats/VnEngine/ImageZAW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const vnEngineZawImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vnEngineZawImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readZawLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readZawLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a GEM/vnengine picture");
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
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
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
		const layout = readZawLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a GEM/vnengine picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported GEM/vnengine picture size ${layout.width}x${layout.height}`,
			);
		}
		const length = layout.width * layout.height * (layout.bitsPerPixel >> 3);
		if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`GEM/vnengine picture of ${length} bytes is too large`,
			);
		}
		let unfolded: Buffer;
		try {
			unfolded = await inflateZlibBufferCapped(
				stored.subarray(PIXELS_OFFSET),
				MAXIMUM_PICTURE_BYTES,
			);
		} catch {
			throw invalidPicture("GEM/vnengine picture holds no stream");
		}
		// The reference reads as much as the stream gives and leaves the rest of the picture as it was.
		const storedPixels: Buffer = Buffer.alloc(length, 0x00);
		unfolded.copy(storedPixels, 0, 0, Math.min(length, unfolded.length));
		if (BPP_24 === layout.bitsPerPixel) {
			// The format keeps a picture of twenty four bits red, green and blue, where a bitmap keeps the
			// other two first.
			for (let i = 0; i + 2 < storedPixels.length; i += 3) {
				const red = storedPixels[i] ?? 0;
				storedPixels[i] = storedPixels[i + 2] ?? 0;
				storedPixels[i + 2] = red;
			}
			return Readable.from([
				writeBmp24(layout.width, layout.height, storedPixels),
			]);
		}
		if (BPP_8 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp8(layout.width, layout.height, storedPixels),
			]);
		}
		const pixels: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
		if (BPP_16 === layout.bitsPerPixel) {
			// Two bytes to a pixel: the level of grey and what stands behind it.
			let at = 0;
			for (let dst = 0; dst < pixels.length; dst += 4) {
				const grey = storedPixels[at] ?? 0;
				const alpha = storedPixels[at + 1] ?? 0;
				at += 2;
				pixels[dst] = grey;
				pixels[dst + 1] = grey;
				pixels[dst + 2] = grey;
				pixels[dst + 3] = scaleAlpha(alpha);
			}
		} else {
			for (let dst = 0; dst + 3 < storedPixels.length; dst += 4) {
				pixels[dst] = storedPixels[dst + 2] ?? 0;
				pixels[dst + 1] = storedPixels[dst + 1] ?? 0;
				pixels[dst + 2] = storedPixels[dst] ?? 0;
				pixels[dst + 3] = scaleAlpha(storedPixels[dst + 3] ?? 0);
			}
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
