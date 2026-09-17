// Format reference: GARbro "ArcFormats/Ipac/ImageIES.cs", classes `IesFormat` and `IesRawFormat` (two IPAC
// pictures: one signed `IES2` with a colour map or an alpha channel, and one raw with no signature at all).
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'IES2', the signature of the signed kind. */
const SIGNATURE = Buffer.from("IES2", "latin1");
/** The heads of the two kinds. */
const SIGNED_HEADER_SIZE = 0x14;
const RAW_HEADER_SIZE = 0x10;
const SIGNED_WIDTH_FIELD = 8;
const SIGNED_HEIGHT_FIELD = 0xc;
const SIGNED_DEPTH_FIELD = 0x10;
const RAW_WIDTH_FIELD = 0;
const RAW_HEIGHT_FIELD = 4;
const RAW_DEPTH_FIELD = 8;
const RAW_RESERVED_FIELD = 0xc;
/** Where the colour map of each kind stands, and where its pixels do. */
const SIGNED_PALETTE_OFFSET = 0x20;
const RAW_PALETTE_OFFSET = 0x14;
const SIGNED_PIXEL_OFFSET = 0x420;
const RAW_PIXEL_OFFSET = 0x414;
const PALETTE_SIZE = 0x100 * 4;
/** The depths the readers know. */
const DEPTHS = [8, 24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface IesLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function pictureSize(width: number, height: number, depth: number): number {
	return width * height * depth;
}

/**
 * `IesFormat.ReadMetaData`: the word `IES2`, and the width, the height and the depth at eight, twelve and
 * sixteen. Only a depth of eight or twenty four bits is read; the reference throws for any other when it is
 * asked to unpack.
 */
export function readIesLayout(data: Buffer): IesLayout | undefined {
	if (data.length < SIGNED_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(SIGNED_WIDTH_FIELD);
	const height = data.readUInt32LE(SIGNED_HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(SIGNED_DEPTH_FIELD);
	if (bitsPerPixel !== 8 && bitsPerPixel !== 24) return undefined;
	if (width === 0 || height === 0) return undefined;
	const size = pictureSize(width, height, bitsPerPixel / 8);
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, bitsPerPixel };
}

/**
 * `IesRawFormat.ReadMetaData`: the reference gates on the `.ies` extension, the width and the height stand at
 * the start of the head, the depth at eight and a clear word at twelve, and the pixels behind the four
 * hundred and thirty six bytes of head and colour map have to be exactly the size the measurements and the
 * depth ask for.
 */
export function readIesRawLayout(
	data: Buffer,
	sourcePath: string,
	fileLength: number,
): IesLayout | undefined {
	if (sourceExtension(sourcePath) !== "ies") return undefined;
	if (data.length < RAW_HEADER_SIZE) return undefined;
	if (data.readInt32LE(RAW_RESERVED_FIELD) !== 0) return undefined;
	const width = data.readUInt32LE(RAW_WIDTH_FIELD);
	const height = data.readUInt32LE(RAW_HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(RAW_DEPTH_FIELD);
	if (bitsPerPixel !== 8 && bitsPerPixel !== 32) return undefined;
	if (width === 0 || height === 0) return undefined;
	const size = pictureSize(width, height, bitsPerPixel / 8);
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	if (size !== fileLength - RAW_PIXEL_OFFSET) return undefined;
	return { width, height, bitsPerPixel };
}

/** `ReadPalette` with `PaletteFormat.RgbX`: four byte entries of red, green and blue and nothing. */
function readIesPalette(data: Buffer, offset: number): Buffer {
	const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		const at = offset + index * 4;
		entries[index * 4] = data[at + 2] ?? 0;
		entries[index * 4 + 1] = data[at + 1] ?? 0;
		entries[index * 4 + 2] = data[at] ?? 0;
	}
	return entries;
}

/** The twenty four bit picture: three bytes a pixel followed by one alpha byte each, interleaved. */
function mergeIesAlpha(rgb: Buffer, alpha: Buffer): Buffer {
	const pixels: Buffer = Buffer.alloc((rgb.length / 3) * 4, 0x00);
	for (let index = 0; index < rgb.length / 3; index += 1) {
		pixels[index * 4] = rgb[index * 3] ?? 0;
		pixels[index * 4 + 1] = rgb[index * 3 + 1] ?? 0;
		pixels[index * 4 + 2] = rgb[index * 3 + 2] ?? 0;
		pixels[index * 4 + 3] = alpha[index] ?? 0;
	}
	return pixels;
}

async function readHeader(
	source: ByteSource,
	length: number,
): Promise<Buffer | undefined> {
	if (source.size < BigInt(length)) return undefined;
	try {
		return Buffer.from(await source.readAt(0n, length));
	} catch {
		return undefined;
	}
}

async function readSignedLayout(
	source: ByteSource,
): Promise<IesLayout | undefined> {
	const header = await readHeader(source, SIGNED_HEADER_SIZE);
	if (!header) return undefined;
	return readIesLayout(header);
}

async function readRawLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<IesLayout | undefined> {
	const header = await readHeader(source, RAW_HEADER_SIZE);
	if (!header) return undefined;
	return readIesRawLayout(header, sourcePath, Number(source.size));
}

function iesEntry(
	layout: IesLayout,
	offset: number,
	fileName: string,
	size: bigint,
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(offset),
			size,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		}),
		// The pixels are read as they stand and a bitmap header is written around them.
		sizeKnown: false,
	};
}

export const ipacIesImageDescriptor: FormatDescriptor = {
	id: "ipac-ies-image",
	name: "IPAC image format",
	extensions: ["ies"],
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
			source: "ArcFormats/Ipac/ImageIES.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ipacIesImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ipacIesImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSignedLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readSignedLayout(source);
		if (!layout) {
			throw invalidPicture("Not an IPAC picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry = iesEntry(
			layout,
			SIGNED_PIXEL_OFFSET,
			fileName,
			source.size - BigInt(SIGNED_PIXEL_OFFSET),
		);
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
		const layout = await readSignedLayout(source);
		if (!layout) {
			throw invalidPicture("Not an IPAC picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (layout.bitsPerPixel === 24) {
			const count = layout.width * layout.height;
			const rgbStart = SIGNED_PIXEL_OFFSET;
			const alphaStart = rgbStart + count * 3;
			if (alphaStart + count > stored.length) {
				throw invalidPicture("IPAC picture is cut short of its pixels");
			}
			const pixels = mergeIesAlpha(
				stored.subarray(rgbStart, rgbStart + count * 3),
				stored.subarray(alphaStart, alphaStart + count),
			);
			// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
			return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
		}
		const count = layout.width * layout.height;
		if (SIGNED_PIXEL_OFFSET + count > stored.length) {
			throw invalidPicture("IPAC picture is cut short of its pixels");
		}
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				stored.subarray(SIGNED_PIXEL_OFFSET, SIGNED_PIXEL_OFFSET + count),
				readIesPalette(stored, SIGNED_PALETTE_OFFSET),
			),
		]);
	},
});

export const ipacIesRawImageDescriptor: FormatDescriptor = {
	id: "ipac-ies-raw-image",
	name: "IPAC raw image format",
	extensions: ["ies"],
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
			source: "ArcFormats/Ipac/ImageIES.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ipacIesRawImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ipacIesRawImageDescriptor,
	// The reference declares no signature word; the extension and the head are the only gates.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readRawLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readRawLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a raw IPAC picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry = iesEntry(
			layout,
			RAW_PIXEL_OFFSET,
			fileName,
			source.size - BigInt(RAW_PIXEL_OFFSET),
		);
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
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const layout = await readRawLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a raw IPAC picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const count = layout.width * layout.height;
		if (layout.bitsPerPixel === 32) {
			if (RAW_PIXEL_OFFSET + count * 4 > stored.length) {
				throw invalidPicture("Raw IPAC picture is cut short of its pixels");
			}
			// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
			return Readable.from([
				writeBmp32(
					layout.width,
					layout.height,
					stored.subarray(RAW_PIXEL_OFFSET, RAW_PIXEL_OFFSET + count * 4),
				),
			]);
		}
		if (RAW_PIXEL_OFFSET + count > stored.length) {
			throw invalidPicture("Raw IPAC picture is cut short of its pixels");
		}
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				stored.subarray(RAW_PIXEL_OFFSET, RAW_PIXEL_OFFSET + count),
				readIesPalette(stored, RAW_PALETTE_OFFSET),
			),
		]);
	},
});
