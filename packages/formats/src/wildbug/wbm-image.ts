// Format reference: GARBro "ArcFormats/WildBug/ImageWBM.cs", classes `WbmFormat` and the `WbmReader` whose
// nine packed walks stand on the `WpxDecoder` base. The head and the record walk are shared with the ported
// sound in `wpx-section.ts`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	RGB555_MASKS,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	findWpxSection,
	readWpxIndex,
	readWpxSectionData,
	WPX_SIGNATURE,
	type WpxSection,
} from "./wpx-section.js";

/** The four bytes that tell a picture of this engine from a sound of it. */
const PICTURE_MARKER = "BMP";
/** The record that names the picture's own head, then the pixels, the colours and the alpha channel. */
const HEADER_SECTION_ID = 0x10;
const PIXEL_SECTION_ID = 0x11;
const PALETTE_SECTION_ID = 0x12;
const ALPHA_SECTION_ID = 0x13;
/** The picture's head names its size and the depth it is stored in. */
const HEADER_MIN_SIZE = 0x10;
const HEADER_WIDTH_FIELD = 4;
const HEADER_HEIGHT_FIELD = 6;
const HEADER_DEPTH_FIELD = 0x0c;
/** The ways a picture of this engine is stored, and the bytes a pixel takes in each. */
const DEPTHS: Record<number, number> = { 8: 1, 16: 2, 24: 3, 32: 4 };
/** The one way of storing a section that this port reads; the top bit of the section's format. */
const STORED_FORMAT = 0x80;
/** The colours a picture of eight bits may carry, three bytes each. */
const PALETTE_COLORS = 0x100;
const PALETTE_ENTRY = 3;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface WbmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixelSize: number;
	/** The stride every row of the picture takes, which is padded to four bytes. */
	stride: number;
	pixels: WpxSection;
	palette: WpxSection | undefined;
	alpha: WpxSection | undefined;
	/** The alpha channel's own stride, padded the same way. */
	alphaStride: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(dataFormat: number): GarbroError {
	return new GarbroError(
		"UNSUPPORTED_FEATURE",
		`The packed ways of storing a Wild Bug picture are not ported (section format 0x${dataFormat.toString(16)}, which would be ${describeFormat(dataFormat)})`,
	);
}

/** Which of the nine walks of the reference a section's own byte would ask for. */
function describeFormat(dataFormat: number): string {
	if (0 === (dataFormat & 0x01)) return "the 0x00 walk";
	if (0 !== (dataFormat & 0x08)) {
		return 0 !== (dataFormat & 0x04)
			? "the 0x0c or 0x0d walk"
			: 0 !== (dataFormat & 0x02)
				? "the 0x0a or 0x0b walk"
				: "the 0x08 or 0x09 walk";
	}
	if (0 !== (dataFormat & 0x04)) return "the 0x04 or 0x05 walk";
	if (0 !== (dataFormat & 0x02)) return "the 0x02 or 0x03 walk";
	return "the 0x01 walk";
}

/**
 * `WbmFormat.ReadMetaData`: the head names a picture, and the record that opens with `0x10` holds the
 * picture's own head - the width, the height and the depth it is stored in. The records that open with
 * `0x11`, `0x12` and `0x13` hold the pixels, the colours of an eight bit picture and an alpha channel.
 */
export function readWbmLayout(data: Buffer): WbmLayout | undefined {
	const index = readWpxIndex(data, PICTURE_MARKER);
	if (!index) return undefined;
	const find = (id: number): WpxSection | undefined =>
		findWpxSection(index.directory, id, index.count, index.directorySize);
	const header = find(HEADER_SECTION_ID);
	if (!header || header.unpackedSize < HEADER_MIN_SIZE) return undefined;
	const head = readWpxSectionData(data, header, header.unpackedSize);
	if (!head) return undefined;
	const width = head.readUInt16LE(HEADER_WIDTH_FIELD);
	const height = head.readUInt16LE(HEADER_HEIGHT_FIELD);
	const bitsPerPixel = head[HEADER_DEPTH_FIELD] ?? 0;
	const pixelSize = DEPTHS[bitsPerPixel];
	if (0 === width || 0 === height || undefined === pixelSize) return undefined;
	const stride = (width * pixelSize + 3) & ~3;
	const total = stride * height;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	const pixels = find(PIXEL_SECTION_ID);
	if (!pixels) return undefined;
	const palette = 8 === bitsPerPixel ? find(PALETTE_SECTION_ID) : undefined;
	const alpha = bitsPerPixel >= 24 ? find(ALPHA_SECTION_ID) : undefined;
	return {
		width,
		height,
		bitsPerPixel,
		pixelSize,
		stride,
		pixels,
		palette,
		alpha,
		alphaStride: (width + 3) & ~3,
	};
}

/**
 * The one way of storing a section this port reads. The reference hands the section's bytes over as they
 * stand when the top bit of the section's format is set, or when the section declares no packed length at
 * all; every other way is one of the nine packed walks of the `WbmReader`, which are not ported.
 */
function sectionBytes(data: Buffer, section: WpxSection, what: string): Buffer {
	if (0 === (section.dataFormat & STORED_FORMAT) && 0 !== section.packedSize) {
		throw unsupported(section.dataFormat);
	}
	const bytes = readWpxSectionData(data, section, section.unpackedSize);
	if (!bytes) {
		throw invalid(`The picture's ${what} reaches past the end of the file`);
	}
	return bytes;
}

/** `WbmFormat.CreatePalette`: three bytes a colour, and nothing for the places a short table leaves. */
function readPalette(source: Buffer): Buffer {
	const colours: Buffer = Buffer.alloc(PALETTE_COLORS * 4, 0x00);
	const count = Math.min(
		Math.floor(source.length / PALETTE_ENTRY),
		PALETTE_COLORS,
	);
	for (let colour = 0; colour < count; colour += 1) {
		const at = colour * PALETTE_ENTRY;
		// A bitmap keeps its colours blue first, the picture keeps them red first.
		colours[colour * 4] = source[at + 2] ?? 0;
		colours[colour * 4 + 1] = source[at + 1] ?? 0;
		colours[colour * 4 + 2] = source[at] ?? 0;
	}
	return colours;
}

export interface WbmPicture {
	pixels: Buffer;
	palette: Buffer | undefined;
	/** The alpha channel, one byte to a pixel, when the picture carries one. */
	alpha: Buffer | undefined;
	bottomUp: boolean;
}

/**
 * `WbmFormat.Read`: the pixels come from their own section. A picture of eight bits names its colours
 * through a table of its own, and a picture of twenty four bits or more may carry an alpha channel, which
 * is spread over the pixels and turns them into four byte ones. The rows are kept from the top down.
 */
export function decodeWbmPicture(data: Buffer, layout: WbmLayout): WbmPicture {
	const pixels = sectionBytes(data, layout.pixels, "pixels");
	if (pixels.length < layout.stride * layout.height) {
		throw invalid("The picture is shorter than the size its head names");
	}
	let palette: Buffer | undefined;
	if (layout.palette) {
		let source: Buffer | undefined;
		try {
			source = sectionBytes(data, layout.palette, "colours");
		} catch {
			// The reference lets a failed colour section leave the picture without colours at all.
			source = undefined;
		}
		if (source) palette = readPalette(source);
	}
	let alpha: Buffer | undefined;
	if (layout.alpha) {
		try {
			const bytes = sectionBytes(data, layout.alpha, "alpha channel");
			if (bytes.length >= layout.alphaStride * layout.height) {
				alpha = Buffer.from(bytes);
			}
		} catch {
			// A failed alpha section leaves the picture without one, as the reference's own catch does.
			alpha = undefined;
		}
	}
	return {
		pixels: Buffer.from(pixels.subarray(0, layout.stride * layout.height)),
		palette,
		alpha,
		bottomUp: false,
	};
}

/** `WbmFormat.Read`'s last step: the alpha channel is spread into a four byte picture of its own. */
export function mergeWbmAlpha(picture: WbmPicture, layout: WbmLayout): Buffer {
	const { pixels, alpha } = picture;
	if (!alpha) return pixels;
	const merged: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let at = 0;
	for (let y = 0; y < layout.height; y += 1) {
		const alphaRow = y * layout.alphaStride;
		let source = y * layout.stride;
		for (let x = 0; x < layout.width; x += 1) {
			merged[at] = pixels[source] ?? 0;
			merged[at + 1] = pixels[source + 1] ?? 0;
			merged[at + 2] = pixels[source + 2] ?? 0;
			merged[at + 3] = alpha[alphaRow + x] ?? 0;
			at += 4;
			source += layout.pixelSize;
		}
	}
	return merged;
}

/**
 * The picture's rows are padded to four bytes, while every bitmap writer here takes rows that stand one
 * behind the other. The alpha merge walks by the pixel size and needs no such step.
 */
function unpadRows(pixels: Buffer, layout: WbmLayout): Buffer {
	const rowBytes = layout.width * layout.pixelSize;
	if (rowBytes === layout.stride) return pixels;
	const packed: Buffer = Buffer.alloc(rowBytes * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		pixels.copy(
			packed,
			row * rowBytes,
			row * layout.stride,
			row * layout.stride + rowBytes,
		);
	}
	return packed;
}

function wbmBitmap(data: Buffer, layout: WbmLayout): Buffer {
	const picture = decodeWbmPicture(data, layout);
	if (8 === layout.bitsPerPixel) {
		return picture.palette
			? writeBmp8Palette(
					layout.width,
					layout.height,
					unpadRows(picture.pixels, layout),
					picture.palette,
					picture.bottomUp,
				)
			: writeBmp8(
					layout.width,
					layout.height,
					unpadRows(picture.pixels, layout),
					picture.bottomUp,
				);
	}
	if (16 === layout.bitsPerPixel) {
		return writeBmp16(
			layout.width,
			layout.height,
			unpadRows(picture.pixels, layout),
			picture.bottomUp,
			RGB555_MASKS,
		);
	}
	if (32 === layout.bitsPerPixel) {
		return writeBmp32(
			layout.width,
			layout.height,
			mergeWbmAlpha(picture, layout),
			picture.bottomUp,
		);
	}
	return writeBmp24(
		layout.width,
		layout.height,
		unpadRows(picture.pixels, layout),
		picture.bottomUp,
	);
}

function wbmMetadata(layout: WbmLayout) {
	return {
		image: "bmp",
		width: layout.width,
		height: layout.height,
		bitsPerPixel: layout.bitsPerPixel,
		hasPalette: undefined !== layout.palette,
		hasAlphaChannel: undefined !== layout.alpha,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const wildbugWbmImageDescriptor: FormatDescriptor = {
	id: "wildbug-wbm-image",
	name: "Wild Bug image",
	extensions: [".wbm"],
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
			source: "ArcFormats/WildBug/ImageWBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wildbugWbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wildbugWbmImageDescriptor,
	// A sound of this engine opens with the same word, so the four bytes behind it are the difference.
	detection: { signatures: [{ bytes: WPX_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 0x10n) return false;
		return readWbmLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readWbmLayout(stored);
		if (!layout) throw invalid("Not a Wild Bug picture");
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
				},
			}),
			// The picture is reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return { entries: [entry], metadata: wbmMetadata(layout) };
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readWbmLayout(stored);
		if (!layout) throw invalid("Not a Wild Bug picture");
		return Readable.from([wbmBitmap(stored, layout)]);
	},
});
