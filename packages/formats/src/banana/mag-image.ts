// Format reference: GARbro "ArcFormats/Banana/ImageMAG.cs", classes `MagFormat` and `MagMetaData` (a
// twenty four or thirty two bit picture on a larger canvas, both halves an LZSS stream behind a delta walk).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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

/** The head the reference reads at once. */
const HEADER_SIZE = 0x24;
/** The rectangle of the picture inside its canvas, and the canvas itself. */
const LEFT_FIELD = 0;
const TOP_FIELD = 4;
const RIGHT_FIELD = 8;
const BOTTOM_FIELD = 0xc;
const CANVAS_WIDTH_FIELD = 0x18;
const CANVAS_HEIGHT_FIELD = 0x1c;
const ALPHA_OFFSET_FIELD = 0x20;
/** The two words at 0x10 and 0x14 must be nothing. */
const RESERVED_FIRST = 0x10;
const RESERVED_SECOND = 0x14;
/** The canvas may not be larger than this, in either direction. */
const MAX_CANVAS = 0x2000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface MagLayout {
	/** The rectangle of the picture inside the canvas. */
	width: number;
	height: number;
	left: number;
	top: number;
	canvasWidth: number;
	canvasHeight: number;
	/** Whether the alpha channel is stored at all, and where behind the head it stands. */
	alphaOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MagFormat.ReadMetaData`: the two words at `0x10` and `0x14` must be nothing; the rectangle of the picture
 * is the four words at the start, the canvas behind it two more, and the offset of the alpha stream at
 * `0x20`. The rectangle must lie inside the canvas and the canvas may not be larger than `0x2000` in either
 * direction, both measured with signed comparisons. The depth is thirty two bits when an alpha stream is
 * declared and twenty four when it is not.
 */
export function readMagLayout(data: Buffer): MagLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.readInt32LE(RESERVED_FIRST) !== 0) return undefined;
	if (data.readInt32LE(RESERVED_SECOND) !== 0) return undefined;
	const left = data.readInt32LE(LEFT_FIELD);
	const top = data.readInt32LE(TOP_FIELD);
	const right = data.readInt32LE(RIGHT_FIELD);
	const bottom = data.readInt32LE(BOTTOM_FIELD);
	const canvasWidth = data.readInt32LE(CANVAS_WIDTH_FIELD);
	const canvasHeight = data.readInt32LE(CANVAS_HEIGHT_FIELD);
	const alphaOffset = data.readUInt32LE(ALPHA_OFFSET_FIELD);
	const width = right - left;
	const height = bottom - top;
	if (
		left >= canvasWidth ||
		top >= canvasHeight ||
		width <= 0 ||
		width > canvasWidth ||
		height <= 0 ||
		height > canvasHeight ||
		canvasWidth <= 0 ||
		canvasWidth > MAX_CANVAS ||
		canvasHeight <= 0 ||
		canvasHeight > MAX_CANVAS
	) {
		return undefined;
	}
	const size = width * height * 4;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return {
		width,
		height,
		left,
		top,
		canvasWidth,
		canvasHeight,
		alphaOffset,
	};
}

/**
 * `MagFormat.Read`: the pixels are an LZSS stream of three bytes per pixel that has to unfold to exactly the
 * rectangle of the picture. The bytes are then walked twice: along the first row, every byte behind the third
 * is the sum of itself and the byte three before it, and from the second row on every byte is the sum of
 * itself and the byte a whole row before it, both held to eight bits. The alpha stream, when there is one, is
 * a byte per pixel of the **canvas**, and the alpha of the picture is read from the canvas where the picture
 * lies, bottom row first.
 */
export function unpackMag(data: Buffer, layout: MagLayout): Buffer {
	const stride = layout.width * 3;
	const length = stride * layout.height;
	if (layout.alphaOffset === 0) {
		const pixels = inflateLzss(data.subarray(HEADER_SIZE), {
			outputLength: length,
		});
		if (pixels.length !== length) {
			throw invalidPicture("BANANA Shu-Shu picture is cut short of its stream");
		}
		const output = Buffer.from(pixels);
		applyDeltas(output, stride);
		return output;
	}
	const pixels = inflateLzss(data.subarray(HEADER_SIZE), {
		outputLength: length,
	});
	if (pixels.length !== length) {
		throw invalidPicture("BANANA Shu-Shu picture is cut short of its stream");
	}
	const planes = Buffer.from(pixels);
	applyDeltas(planes, stride);
	const alphaLength = layout.canvasWidth * layout.canvasHeight;
	if (!Number.isSafeInteger(alphaLength) || alphaLength > LIMIT) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`BANANA Shu-Shu alpha channel of ${alphaLength} bytes is too large`,
		);
	}
	const alphaStart = HEADER_SIZE + layout.alphaOffset;
	if (alphaStart > data.length) {
		throw invalidPicture(
			"BANANA Shu-Shu picture is cut short of its alpha stream",
		);
	}
	const alpha = inflateLzss(data.subarray(alphaStart), {
		outputLength: alphaLength,
	});
	if (alpha.length !== alphaLength) {
		throw invalidPicture(
			"BANANA Shu-Shu picture is cut short of its alpha stream",
		);
	}
	const imageStride = layout.width * 4;
	const image: Buffer = Buffer.alloc(imageStride * layout.height, 0x00);
	const alphaY = layout.canvasHeight - (layout.top + layout.height);
	let destination = 0;
	for (let y = layout.height - 1; y >= 0; y -= 1) {
		let source = stride * y;
		let alphaSource = layout.canvasWidth * (alphaY + y) + layout.left;
		if (alphaSource < 0 || alphaSource + layout.width > alpha.length) {
			throw invalidPicture(
				"BANANA Shu-Shu picture reads past its alpha channel",
			);
		}
		for (let i = 0; i < imageStride; i += 4) {
			image[destination++] = planes[source++] ?? 0;
			image[destination++] = planes[source++] ?? 0;
			image[destination++] = planes[source++] ?? 0;
			image[destination++] = alpha[alphaSource++] ?? 0;
		}
	}
	return image;
}

/** The reference's own two walks, each byte the sum of itself and one before it, held to eight bits. */
function applyDeltas(pixels: Buffer, stride: number): void {
	let source = 0;
	for (let i = 3; i < stride; i += 1) {
		pixels[i] = ((pixels[i] ?? 0) + (pixels[source++] ?? 0)) & 0xff;
	}
	source = 0;
	for (let i = stride; i < pixels.length; i += 1) {
		pixels[i] = ((pixels[i] ?? 0) + (pixels[source++] ?? 0)) & 0xff;
	}
}

async function readLayout(source: ByteSource): Promise<MagLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readMagLayout(stored);
	} catch {
		return undefined;
	}
}

export const bananaMagImageDescriptor: FormatDescriptor = {
	id: "banana-mag-image",
	name: "BANANA Shu-Shu image format",
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
			source: "ArcFormats/Banana/ImageMAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bananaMagImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bananaMagImageDescriptor,
	// The reference declares no signature and gates on nothing else, so any file can be a candidate.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a BANANA Shu-Shu picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.alphaOffset !== 0 ? 32 : 24,
					offsetX: layout.left,
					offsetY: layout.top,
					canvasWidth: layout.canvasWidth,
					canvasHeight: layout.canvasHeight,
				},
			}),
			// The pixels are unfolded from a stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.alphaOffset !== 0 ? 32 : 24,
				offsetX: layout.left,
				offsetY: layout.top,
				canvasWidth: layout.canvasWidth,
				canvasHeight: layout.canvasHeight,
				hasAlpha: layout.alphaOffset !== 0,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a BANANA Shu-Shu picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackMag(stored, layout);
		if (layout.alphaOffset === 0) {
			// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, true),
			]);
		}
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
