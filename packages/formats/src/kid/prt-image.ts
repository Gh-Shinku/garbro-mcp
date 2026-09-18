// Format reference: GARbro "ArcFormats/Kid/ImagePRT.cs", classes `PrtFormat`, `PrtMetaData` and
// `PrtReader` (a KID picture of eight, twenty four or thirty two bits a pixel, with or without a plane of
// its own for the fourth byte). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'PRT' with a nought behind it, which is the word the reference registers. */
const SIGNATURE = Buffer.from("PRT\0", "latin1");
const HEADER_SIZE = 0x14;
const VERSION_FIELD = 0x04;
const DEPTH_FIELD = 0x06;
const PALETTE_FIELD = 0x08;
const DATA_FIELD = 0x0a;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x0e;
const ALPHA_FIELD = 0x10;
/** The two versions the reference reads; the second carries a pair of offsets behind the head. */
const VERSIONS = [101, 102];
const DEPTHS = [8, 24, 32];
/** `ImageFormat.ReadPalette` takes two hundred and fifty six entries of four bytes each. */
const PALETTE_SIZE = 0x400;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface PrtLayout {
	version: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The row of the reader's own buffer, which is the width in bytes rounded up to four. */
	stride: number;
	paletteOffset: number;
	dataOffset: number;
	hasAlpha: boolean;
	/** Where the alpha plane stands, which is right behind the pixels. */
	alphaOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PrtFormat.ReadMetaData`: the word `PRT` with a nought behind it, the version at four as a word — of
 * which only `101` and `102` are read — the depth at six, the places of the palette and of the pixels at
 * eight and ten, the width and the height at twelve and fourteen, and a word at sixteen that says whether a
 * plane of fourth bytes stands behind the pixels. The second version carries a pair of offsets at `0x14`.
 */
export function readPrtLayout(
	data: Buffer,
	fileLength = data.length,
): PrtLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = data.readUInt16LE(VERSION_FIELD);
	if (!VERSIONS.includes(version)) return undefined;
	const bitsPerPixel = data.readUInt16LE(DEPTH_FIELD);
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const paletteOffset = data.readUInt16LE(PALETTE_FIELD);
	const dataOffset = data.readUInt16LE(DATA_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const hasAlpha = 0 !== data.readInt32LE(ALPHA_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (102 === version && data.length < HEADER_SIZE + 8) return undefined;
	const stride = (width * (bitsPerPixel >> 3) + 3) & ~3;
	const pixels = stride * height;
	if (pixels > LIMIT || dataOffset + pixels > fileLength) return undefined;
	if (hasAlpha && dataOffset + pixels + width * height > fileLength) {
		return undefined;
	}
	if (8 === bitsPerPixel) {
		if (paletteOffset + PALETTE_SIZE > fileLength) return undefined;
	}
	return {
		version,
		width,
		height,
		bitsPerPixel,
		stride,
		paletteOffset,
		dataOffset,
		hasAlpha,
		alphaOffset: dataOffset + pixels,
	};
}

/** The colour map of an eight bit picture, spread over four byte entries as a bitmap wants it. */
export function readPrtPalette(stored: Buffer, layout: PrtLayout): Buffer {
	if (8 !== layout.bitsPerPixel) return Buffer.alloc(0);
	return Buffer.from(
		stored.subarray(layout.paletteOffset, layout.paletteOffset + PALETTE_SIZE),
	);
}

/**
 * `PrtReader.ApplyAlphaIndexed` and `ApplyAlphaRgb`: where a picture has a plane of its own for the fourth
 * byte, the reader walks the **bottom** row of the pixels first, so the picture is turned the right way up
 * as the fourth byte of every pixel is taken from the plane in its own order, a byte a pixel. Every pixel
 * becomes four bytes, the colour's three and the alpha behind them.
 */
export function applyPrtAlpha(stored: Buffer, layout: PrtLayout): Buffer {
	const width = layout.width;
	const height = layout.height;
	const pixelSize = layout.bitsPerPixel >> 3;
	const alpha = stored.subarray(
		layout.alphaOffset,
		layout.alphaOffset + width * height,
	);
	const palette = readPrtPalette(stored, layout);
	const output: Buffer = Buffer.alloc(width * height * 4, 0x00);
	let dst = 0;
	let alphaSource = 0;
	let source = layout.dataOffset + layout.stride * (height - 1);
	for (let y = 0; y < height; y += 1) {
		let at = source;
		for (let x = 0; x < width; x += 1) {
			if (8 === layout.bitsPerPixel) {
				const entry = (stored[at] ?? 0) * 4;
				output[dst] = palette[entry] ?? 0;
				output[dst + 1] = palette[entry + 1] ?? 0;
				output[dst + 2] = palette[entry + 2] ?? 0;
			} else {
				output[dst] = stored[at] ?? 0;
				output[dst + 1] = stored[at + 1] ?? 0;
				output[dst + 2] = stored[at + 2] ?? 0;
			}
			output[dst + 3] = alpha[alphaSource] ?? 0;
			dst += 4;
			alphaSource += 1;
			at += pixelSize;
		}
		source -= layout.stride;
	}
	return output;
}

/** The rows of the reader's own buffer, which may be padded, taken out into the tight pixels a writer wants. */
function compactRows(
	stored: Buffer,
	layout: PrtLayout,
	rowBytes: number,
): Buffer {
	const tight: Buffer = Buffer.alloc(layout.height * rowBytes, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		stored.copy(
			tight,
			row * rowBytes,
			layout.dataOffset + row * layout.stride,
			layout.dataOffset + row * layout.stride + rowBytes,
		);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const kidPrtImageDescriptor: FormatDescriptor = {
	id: "kid-prt-image",
	name: "KID image format",
	extensions: ["prt", "cps"],
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
			source: "ArcFormats/Kid/ImagePRT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kidPrtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kidPrtImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
				return false;
			}
			return readPrtLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPrtLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a KID picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.stride * layout.height),
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
					hasAlpha: layout.hasAlpha,
				},
			}),
			// The fourth bytes and the turn of the rows are taken out into a bitmap of this project's own.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.hasAlpha ? 32 : layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPrtLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a KID picture");
		}
		if (layout.hasAlpha) {
			// The walk of the reader turns the rows the right way up itself, so the bitmap is top down.
			return Readable.from([
				writeBmp32(layout.width, layout.height, applyPrtAlpha(stored, layout)),
			]);
		}
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (8 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					compactRows(stored, layout, layout.width),
					readPrtPalette(stored, layout),
					true,
				),
			]);
		}
		const rowBytes = layout.width * (layout.bitsPerPixel >> 3);
		const tight = compactRows(stored, layout, rowBytes);
		if (24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, tight, true),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, tight, true),
		]);
	},
});
