// Format reference: GARbro "ArcFormats/Tail/ImageCFP.cs", classes `CfpFormat`, `CfpMetaData` and
// `Cfp2Format` (a Tail picture of twenty four bits a pixel held as six planes of nibbles, and a transparent
// one of thirty two bits held as four planes). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'REB ' and 'BR' as the words the reference registers, the second standing in the low half. */
const CFP_SIGNATURES = [0x20424552, 0x00005242];
/** 'REB2', the mark of the transparent bitmap. */
const CFP2_SIGNATURE = 0x32424552;
const CFP_HEADER_SIZE = 0x1c;
const CFP_WIDTH_FIELD = 0x14;
const CFP_HEIGHT_FIELD = 0x18;
const CFP2_HEADER_SIZE = 0x20;
const CFP2_START_FIELD = 0x10;
const CFP2_MINIMUM_START = 0x36;
const CFP2_WIDTH_FIELD = 0x14;
const CFP2_HEIGHT_FIELD = 0x18;
const CFP2_DATA_OFFSET_FIELD = 0x1c;
/** The smallest a start may be, and where the pixels of the older variant stand. */
const CFP2_TIGHT_OFFSET = 0x1c;
const MAX_DIMENSION = 0x8000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CfpLayout {
	width: number;
	height: number;
	/** The width rounded up to two pixels, which is what the planes hold. */
	paddedWidth: number;
	/** The bytes of a row of the reader's own buffer, which may be padded. */
	stride: number;
	/**
	 * The step the planes are walked with. It is the row of the reader's buffer, except where an odd width
	 * rounded up to two pixels would make the planes wider than that row — a width the reference itself
	 * cannot walk, since its own array write would reach past the end (a documented deviation).
	 */
	pitch: number;
	/** Only the transparent variant carries one. */
	dataOffset: number;
	dataLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CfpFormat.ReadMetaData`: the word at nought is `REB ` or, in its low half, `BR`, the width and the height
 * stand at `0x14` and `0x18` as words, and the depth is always reported as twenty four bits. A row of the
 * reader's buffer is the width in bytes rounded up to four, while the planes hold the width rounded up to
 * two pixels, so the two may differ by one pixel.
 */
export function readCfpLayout(
	data: Buffer,
	fileLength = data.length,
): CfpLayout | undefined {
	if (data.length < CFP_HEADER_SIZE) return undefined;
	if (!CFP_SIGNATURES.includes(data.readUInt32LE(0))) return undefined;
	const width = data.readUInt32LE(CFP_WIDTH_FIELD);
	const height = data.readUInt32LE(CFP_HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > MAX_DIMENSION || height > MAX_DIMENSION) return undefined;
	const paddedWidth = (width + 1) & ~1;
	const stride = (width * 3 + 3) & ~3;
	const plane = paddedWidth * height;
	const packedSize = plane * 3;
	if (packedSize > LIMIT || fileLength < packedSize) return undefined;
	return {
		width,
		height,
		paddedWidth,
		stride,
		pitch: Math.max(stride, paddedWidth * 3),
		dataOffset: fileLength - packedSize,
		dataLength: packedSize,
	};
}

/**
 * `Cfp2Format.ReadMetaData`: the head begins with `REB2`, the start stands at `0x10` as a word and may not
 * be smaller than `0x36`, the width and the height stand at `0x14` and `0x18`, and the depth is always
 * reported as thirty two bits. Where the picture itself would reach past the file it stands right behind the
 * start; otherwise the word at `0x1C` says how far behind the head it stands.
 */
export function readCfp2Layout(
	data: Buffer,
	fileLength = data.length,
): CfpLayout | undefined {
	if (data.length < CFP2_HEADER_SIZE) return undefined;
	if (data.readUInt32LE(0) !== CFP2_SIGNATURE) return undefined;
	if (data.readInt32LE(CFP2_START_FIELD) < CFP2_MINIMUM_START) return undefined;
	const width = data.readInt32LE(CFP2_WIDTH_FIELD);
	const height = data.readInt32LE(CFP2_HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (width > MAX_DIMENSION || height > MAX_DIMENSION) return undefined;
	const dataLength = width * height * 4;
	if (dataLength > LIMIT) return undefined;
	const dataOffset =
		CFP2_HEADER_SIZE + dataLength > fileLength
			? CFP2_TIGHT_OFFSET
			: CFP2_HEADER_SIZE + data.readInt32LE(CFP2_DATA_OFFSET_FIELD);
	if (dataOffset < CFP2_TIGHT_OFFSET || dataOffset >= fileLength)
		return undefined;
	return {
		width,
		height,
		paddedWidth: width,
		stride: width * 4,
		pitch: width * 4,
		dataOffset,
		dataLength,
	};
}

/**
 * `CfpFormat.Read`: six planes, each of half the picture, hold the nibbles of the blue, the green and the red
 * bytes of two pixels at a time. Every step of a pair of pixels takes one byte from each plane: the low
 * nibble of the second plane and the high nibble of the first make the first pixel, and the high nibble of
 * both make the second. The planes are walked from the **bottom** row up, so the first row of a plane is the
 * lowest row of the picture, and the result is handed out top down.
 */
export function unpackCfp(data: Buffer, layout: CfpLayout): Buffer {
	const input = data.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.dataLength,
	);
	if (input.length !== layout.dataLength) {
		throw invalidPicture("Tail picture is cut short of its planes");
	}
	const total = layout.paddedWidth * layout.height;
	const pixels: Buffer = Buffer.alloc(layout.pitch * layout.height, 0x00);
	let src1 = 0;
	let src2 = total >> 1;
	let src3 = total;
	let src4 = src2 + total;
	let src5 = total * 2;
	let src6 = src5 + (total >> 1);
	for (
		let dstRow = layout.pitch * (layout.height - 1);
		dstRow >= 0;
		dstRow -= layout.pitch
	) {
		let dst = dstRow;
		for (let x = 0; x < layout.paddedWidth; x += 2) {
			pixels[dst] =
				((input[src2] ?? 0) & 0x0f) | (((input[src1] ?? 0) << 4) & 0xf0);
			pixels[dst + 3] = ((input[src1] ?? 0) & 0xf0) | ((input[src2] ?? 0) >> 4);
			pixels[dst + 1] =
				((input[src4] ?? 0) & 0x0f) | (((input[src3] ?? 0) << 4) & 0xf0);
			pixels[dst + 4] = ((input[src3] ?? 0) & 0xf0) | ((input[src4] ?? 0) >> 4);
			pixels[dst + 2] =
				((input[src6] ?? 0) & 0x0f) | (((input[src5] ?? 0) << 4) & 0xf0);
			pixels[dst + 5] = ((input[src5] ?? 0) & 0xf0) | ((input[src6] ?? 0) >> 4);
			dst += 6;
			src1 += 1;
			src2 += 1;
			src3 += 1;
			src4 += 1;
			src5 += 1;
			src6 += 1;
		}
	}
	return pixels;
}

/**
 * `Cfp2Format.Read`: four planes of the whole picture hold the blue, the green, the red and the fourth byte
 * of every pixel in turn. The planes are walked from the **bottom** row up, so the first row of a plane is
 * the lowest row of the picture, and the result is handed out top down.
 */
export function unpackCfp2(data: Buffer, layout: CfpLayout): Buffer {
	const input = data.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.dataLength,
	);
	const total = layout.width * layout.height;
	const pixels: Buffer = Buffer.alloc(layout.pitch * layout.height, 0x00);
	let blue = 0;
	let green = total;
	let red = total * 2;
	let fourth = total * 3;
	for (
		let dstRow = layout.pitch * (layout.height - 1);
		dstRow >= 0;
		dstRow -= layout.pitch
	) {
		let dst = dstRow;
		for (let x = 0; x < layout.width; x += 1) {
			pixels[dst] = input[blue] ?? 0;
			pixels[dst + 1] = input[green] ?? 0;
			pixels[dst + 2] = input[red] ?? 0;
			pixels[dst + 3] = input[fourth] ?? 0;
			dst += 4;
			blue += 1;
			green += 1;
			red += 1;
			fourth += 1;
		}
	}
	return pixels;
}

/** The rows of the reader's own buffer, which may be padded, taken out into the tight pixels a writer wants. */
function compactRows(
	pixels: Buffer,
	height: number,
	stride: number,
	rowBytes: number,
): Buffer {
	if (stride === rowBytes) return pixels;
	const tight = Buffer.alloc(height * rowBytes, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(tight, row * rowBytes, row * stride, row * stride + rowBytes);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(
	layout: CfpLayout,
	sourcePath: string,
	compressed: boolean,
): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.dataOffset),
			size: BigInt(layout.dataLength),
			compressed,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				stride: layout.stride,
			},
		}),
		// The pixels are unfolded from the planes and a bitmap header is written around them.
		sizeKnown: false,
	};
}

export const tailCfpImageDescriptor: FormatDescriptor = {
	id: "tail-cfp-image",
	name: "Tail image format",
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
			source: "ArcFormats/Tail/ImageCFP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tailCfpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tailCfpImageDescriptor,
	detection: {
		signatures: CFP_SIGNATURES.map((value) => {
			const bytes = Buffer.alloc(4);
			bytes.writeUInt32LE(value);
			return { bytes };
		}),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CFP_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, CFP_HEADER_SIZE));
			if (!CFP_SIGNATURES.includes(header.readUInt32LE(0))) return false;
			// The planes stand at the end of the file, so the head alone is enough to walk them.
			const width = header.readUInt32LE(CFP_WIDTH_FIELD);
			const height = header.readUInt32LE(CFP_HEIGHT_FIELD);
			if (width === 0 || height === 0) return false;
			if (width > MAX_DIMENSION || height > MAX_DIMENSION) return false;
			return ((width + 1) & ~1) * height * 3 <= Number(source.size);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCfpLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Tail picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath, true)],
			metadata: {
				image: "bmp",
				compression: "nibble-planes",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCfpLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Tail picture");
		}
		const pixels = compactRows(
			unpackCfp(stored, layout),
			layout.height,
			layout.pitch,
			layout.width * 3,
		);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});

export const tailCfp2ImageDescriptor: FormatDescriptor = {
	id: "tail-cfp-reb2-image",
	name: "Tail transparent bitmap",
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
			source: "ArcFormats/Tail/ImageCFP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tailCfp2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tailCfp2ImageDescriptor,
	detection: {
		signatures: [
			(() => {
				const bytes = Buffer.alloc(4);
				bytes.writeUInt32LE(CFP2_SIGNATURE);
				return { bytes };
			})(),
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CFP2_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, CFP2_HEADER_SIZE));
			if (header.readUInt32LE(0) !== CFP2_SIGNATURE) return false;
			return readCfp2Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCfp2Layout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Tail transparent bitmap");
		}
		return {
			entries: [pictureEntry(layout, sourcePath, true)],
			metadata: {
				image: "bmp",
				compression: "planes",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCfp2Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Tail transparent bitmap");
		}
		const pixels = unpackCfp2(stored, layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
