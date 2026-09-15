// Format reference: GARbro "ArcFormats/GsPack/ImageGS.cs", classes `PicFormat` and `PicMetaData` (GsPack
// image format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	writeBmp16,
	writeBmp24,
	writeBmp32,
	writeBmp8Palette,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from([0x00, 0x00, 0x04, 0x00]);
/** The measurements begin behind these words, which stand behind the signature. */
const PACKED_SIZE_FIELD = 4;
const UNPACKED_SIZE_FIELD = 8;
const HEADER_SIZE_FIELD = 0xc;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
const BPP_FIELD = 0x1c;
/** The place of the picture, present only in a header that reaches this far. */
const EXTRA_FIELD = 0x20;
const OFFSET_X_FIELD = 0x24;
const OFFSET_Y_FIELD = 0x28;
const PLACEMENT_HEADER_SIZE = 0x2c;
/** How much of the header the reference reads before it knows whether the place of the picture is there. */
const HEADER_READ_SIZE = 0x20;
const PALETTE_SIZE = 0x100 * 4;
const DEPTH_8 = 8;
const DEPTH_16 = 16;
const DEPTH_24 = 24;
const DEPTH_32 = 32;
/** The depths whose pixels the reader takes; any other is one the reference garbles. */
const SUPPORTED_DEPTHS = [DEPTH_8, DEPTH_16, DEPTH_24, DEPTH_32];
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface PicLayout {
	packedSize: number;
	unpackedSize: number;
	/** Where the stream of the picture begins. */
	headerSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The word that says whether a thirty two bit picture carries the transparency of its pixels. */
	extra: number;
	offsetX: number;
	offsetY: number;
}

function isPicSignature(data: Buffer): boolean {
	return data.subarray(0, 4).equals(SIGNATURE);
}

/**
 * `PicFormat.ReadMetaData`: the lengths of the stream and of what it unfolds to, and the length of the header,
 * which must leave something of the file behind it — the stream standing at its end must fit inside the file
 * as well. Behind those come a word the reference skips, the measurements, the depth and, in a header that
 * reaches thirty four bytes, the place of the picture.
 */
export function readPicLayout(data: Buffer): PicLayout | undefined {
	if (data.length < HEADER_READ_SIZE) return undefined;
	if (!isPicSignature(data)) return undefined;
	const packedSize = data.readUInt32LE(PACKED_SIZE_FIELD);
	const unpackedSize = data.readUInt32LE(UNPACKED_SIZE_FIELD);
	const headerSize = data.readUInt32LE(HEADER_SIZE_FIELD);
	if (headerSize >= data.length) return undefined;
	if (packedSize + headerSize > data.length) return undefined;
	const layout: PicLayout = {
		packedSize,
		unpackedSize,
		headerSize,
		width: data.readUInt32LE(WIDTH_FIELD),
		height: data.readUInt32LE(HEIGHT_FIELD),
		bitsPerPixel: data.readInt32LE(BPP_FIELD),
		extra: 0,
		offsetX: 0,
		offsetY: 0,
	};
	if (headerSize >= PLACEMENT_HEADER_SIZE) {
		layout.extra = data.readInt32LE(EXTRA_FIELD);
		layout.offsetX = data.readInt32LE(OFFSET_X_FIELD);
		layout.offsetY = data.readInt32LE(OFFSET_Y_FIELD);
	}
	return layout;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** How many bytes of the stream a picture takes, colour map and all. */
export function picBodyLength(layout: PicLayout): number {
	const rowBytes = layout.width * ((layout.bitsPerPixel + 7) >> 3);
	const palette = DEPTH_8 === layout.bitsPerPixel ? PALETTE_SIZE : 0;
	return palette + rowBytes * layout.height;
}

/** `PicFormat.Read`: the stream behind the header, unfolded with the settings the reference leaves alone. */
export function unfoldPic(stored: Buffer, layout: PicLayout): Buffer {
	const length = picBodyLength(layout);
	if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`GsPack picture of ${length} bytes is too large`,
		);
	}
	return inflateLzss(stored.subarray(layout.headerSize), {
		outputLength: length,
	});
}

export const gsPackPicImageDescriptor: FormatDescriptor = {
	id: "gs-pack-pic-image",
	name: "GsPack image format",
	extensions: ["pic"],
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
			source: "ArcFormats/GsPack/ImageGS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gsPackPicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsPackPicImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_READ_SIZE)) return false;
		return readPicLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPicLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a GsPack picture");
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
		const layout = readPicLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a GsPack picture");
		}
		if (!SUPPORTED_DEPTHS.includes(layout.bitsPerPixel)) {
			// The reference takes any other depth for a thirty two bit one while reading one byte for every
			// eight bits it names, which is a picture of neither kind.
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported GsPack picture depth ${layout.bitsPerPixel}`,
			);
		}
		const unfolded = unfoldPic(stored, layout);
		const rowBytes = layout.width * ((layout.bitsPerPixel + 7) >> 3);
		const length = rowBytes * layout.height;
		if (DEPTH_8 === layout.bitsPerPixel) {
			if (unfolded.length < PALETTE_SIZE) {
				throw invalidPicture("GsPack picture carries no whole colour map");
			}
			const palette = Buffer.from(unfolded.subarray(0, PALETTE_SIZE));
			// The reference reads the pixels into a buffer of its own and leaves what the stream does not
			// reach at nothing, rather than failing.
			const pixels: Buffer = Buffer.alloc(length, 0x00);
			unfolded.copy(pixels, 0, PALETTE_SIZE, PALETTE_SIZE + length);
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette),
			]);
		}
		const pixels: Buffer = Buffer.alloc(length, 0x00);
		unfolded.copy(pixels, 0, 0, length);
		if (DEPTH_16 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp16(layout.width, layout.height, pixels, false, RGB565_MASKS),
			]);
		}
		if (DEPTH_24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
