// Format reference: GARbro "ArcFormats/Silky/ImageAKB.cs", class `AkbFormat` (AI6WIN engine image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, listCompanionFiles } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `AKB ` for an image of its own and `AKB+` for one that is drawn over another. */
const SIGNATURES: Buffer[] = [
	Buffer.from("AKB ", "latin1"),
	Buffer.from("AKB+", "latin1"),
];
const INCREMENTAL_MARKER = 0x2b;
const EXTENSIONS: string[] = [];
const HEADER_SIZE = 0x20;
const NAME_FIELD_OFFSET = 0x20;
/** The reference always steps over this many bytes for the name, however long the name in them is. */
const NAME_FIELD_SIZE = 0x20;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const FLAGS_FIELD = 8;
const BACKGROUND_FIELD = 0x0c;
const OFFSET_X_FIELD = 0x10;
const OFFSET_Y_FIELD = 0x14;
const EDGE_X_FIELD = 0x18;
const EDGE_Y_FIELD = 0x1c;
/** A set bit here means twenty four bits, a clear one thirty two. */
const DEPTH_FLAG = 0x40000000;
/** A set bit here means the fourth byte of a pixel is an alpha value rather than a filler. */
const ALPHA_FLAG = 0x80000000;
/** The colour the overlay leaves alone, which is the same green key the other Silky formats use. */
const KEY_RED = 0;
const KEY_GREEN = 0xff;
const KEY_BLUE = 0;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface AkbLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flags: number;
	background: Buffer;
	offsetX: number;
	offsetY: number;
	innerWidth: number;
	innerHeight: number;
	baseFileName: string;
	dataOffset: number;
}

/**
 * Reads whatever the reference reads before it decides the file is one of these. Both the width and the height
 * have to be known, the overlay has to fit inside the image it is drawn on — the reference returns nothing at
 * all when it does not — and the pixels start either right behind the header or behind a name field.
 */
function parseAkbLayout(file: Buffer): AkbLayout | undefined {
	if (file.length < HEADER_SIZE) return undefined;
	const signature = file.subarray(0, 4);
	if (!SIGNATURES.some((candidate) => candidate.equals(signature)))
		return undefined;
	const width = file.readUInt16LE(WIDTH_FIELD);
	const height = file.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const flags = file.readUInt32LE(FLAGS_FIELD);
	const bitsPerPixel = (flags & DEPTH_FLAG) === 0 ? 32 : 24;
	const offsetX = file.readInt32LE(OFFSET_X_FIELD);
	const offsetY = file.readInt32LE(OFFSET_Y_FIELD);
	const innerWidth = file.readInt32LE(EDGE_X_FIELD) - offsetX;
	const innerHeight = file.readInt32LE(EDGE_Y_FIELD) - offsetY;
	if (innerWidth > width || innerHeight > height) return undefined;
	if (width * height * (bitsPerPixel / 8) > MAX_IMAGE_BYTES) return undefined;
	let baseFileName = "";
	let dataOffset = HEADER_SIZE;
	if ((signature[3] ?? 0) === INCREMENTAL_MARKER) {
		const available = Math.min(
			NAME_FIELD_SIZE,
			Math.max(0, file.length - NAME_FIELD_OFFSET),
		);
		const field = file.subarray(
			NAME_FIELD_OFFSET,
			NAME_FIELD_OFFSET + available,
		);
		const end = field.indexOf(0x00);
		baseFileName = field
			.subarray(0, end < 0 ? field.length : end)
			.toString("latin1");
		// `ReadCString` stops the name at its terminator but always steps over the whole field.
		dataOffset = NAME_FIELD_OFFSET + available;
	}
	return {
		width,
		height,
		bitsPerPixel,
		flags,
		background: Buffer.from(
			file.subarray(BACKGROUND_FIELD, BACKGROUND_FIELD + 4),
		),
		offsetX,
		offsetY,
		innerWidth,
		innerHeight,
		baseFileName,
		dataOffset,
	};
}

/**
 * The whole image the overlay is drawn on, which is one pixel repeated when the header names one. The
 * reference copies the first pixel into every place in the first row and then unfolds that row down the rest
 * of the image in one overlapping copy.
 */
function createBackground(layout: AkbLayout, stride: number): Buffer {
	const pixelSize = layout.bitsPerPixel / 8;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	if (layout.background.readUInt32LE(0) !== 0) {
		for (let at = 0; at < stride; at += pixelSize) {
			layout.background.copy(pixels, at, 0, pixelSize);
		}
		pixels.copyWithin(stride, 0, pixels.length - stride);
	}
	return pixels;
}

/**
 * Unfolds the overlay's own deltas. Its first row is a difference from the pixel before each one and every
 * later row a difference from the row above, both of them byte by byte; the reference adds them in that order
 * and its own byte arithmetic wraps.
 */
function restoreDelta(pixels: Buffer, stride: number, pixelSize: number): void {
	let source = 0;
	for (let index = pixelSize; index < stride; index += 1) {
		pixels[index] = ((pixels[index] ?? 0) + (pixels[source++] ?? 0)) & 0xff;
	}
	source = 0;
	for (let index = stride; index < pixels.length; index += 1) {
		pixels[index] = ((pixels[index] ?? 0) + (pixels[source++] ?? 0)) & 0xff;
	}
}

/** Draws the overlay onto the image, or copies it in whole when there is no image to draw on. */
function compose(
	image: Buffer,
	overlay: Buffer,
	layout: AkbLayout,
	innerStride: number,
	pixelSize: number,
	hasBackground: boolean,
): void {
	const stride = layout.width * pixelSize;
	let destination = layout.offsetY * stride + layout.offsetX * pixelSize;
	let source = 0;
	for (let row = 0; row < layout.innerHeight; row += 1) {
		if (destination < 0 || destination + innerStride > image.length) {
			// The reference writes outside its own bitmap here and fails with its own exception.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"AI6WIN overlay is drawn outside its image",
			);
		}
		if (!hasBackground) {
			overlay.copy(image, destination, source, source + innerStride);
		} else {
			for (let at = 0; at < innerStride; at += pixelSize) {
				const blue = overlay[source + at] ?? 0;
				const green = overlay[source + at + 1] ?? 0;
				const red = overlay[source + at + 2] ?? 0;
				// A pixel of pure green is the key that lets the image it is drawn on show through.
				if (blue === KEY_BLUE && green === KEY_GREEN && red === KEY_RED)
					continue;
				overlay.copy(
					image,
					destination + at,
					source + at,
					source + at + pixelSize,
				);
			}
		}
		destination += stride;
		source += innerStride;
	}
}

/**
 * Unpacks an overlay and draws it on `background`, which the caller leaves out for an image that stands on its
 * own — its own background field then supplies the colour. This is what the reference's reader does, and it is
 * also what it does for a base image it has found.
 */
function unpackAkb(
	file: Buffer,
	layout: AkbLayout,
	background: Buffer | undefined,
): Buffer {
	const pixelSize = layout.bitsPerPixel / 8;
	const stride = layout.width * pixelSize;
	if (layout.innerWidth === 0 || layout.innerHeight === 0) {
		return background ?? createBackground(layout, stride);
	}
	if (layout.innerWidth < 0 || layout.innerHeight < 0) {
		// The reference hands a negative size to its own buffer and fails there.
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"AI6WIN overlay has a negative size",
		);
	}
	const innerStride = layout.innerWidth * pixelSize;
	const needed = layout.innerHeight * innerStride;
	const stored = inflateLzss(file.subarray(layout.dataOffset), {
		outputLength: needed,
	});
	// The reference reads a whole row at a time and fails when the stream runs out before the last one.
	if (stored.length !== needed) {
		throw new GarbroError("INVALID_ARCHIVE", "AI6WIN image is too short");
	}
	// The stream carries its rows bottom up: the reference reads the first one into the end of its buffer.
	const overlay: Buffer = Buffer.alloc(needed, 0x00);
	for (let row = 0; row < layout.innerHeight; row += 1) {
		stored.copy(
			overlay,
			row * innerStride,
			(layout.innerHeight - 1 - row) * innerStride,
			(layout.innerHeight - row) * innerStride,
		);
	}
	restoreDelta(overlay, innerStride, pixelSize);
	if (
		background === undefined &&
		layout.innerWidth === layout.width &&
		layout.innerHeight === layout.height
	) {
		return overlay;
	}
	const image = background ?? createBackground(layout, stride);
	compose(
		image,
		overlay,
		layout,
		innerStride,
		pixelSize,
		background !== undefined,
	);
	return image;
}

/**
 * Finds the image an incremental overlay is drawn on. The reference takes the name the header carries, drops
 * its extension and tries every file that shares the stem, skipping the overlay itself, until one of them is an
 * image of the same depth and the same size. Its own note says a base that is itself incremental is unpacked as
 * if it were not, which is what happens here as well.
 */
async function readBaseImage(
	sourcePath: string,
	layout: AkbLayout,
): Promise<Buffer | undefined> {
	const candidates = await listCompanionFiles(sourcePath, layout.baseFileName);
	for (const candidate of candidates) {
		let file: Buffer;
		try {
			file = await readFile(candidate);
		} catch {
			continue;
		}
		const base = parseAkbLayout(file);
		if (!base) continue;
		if (
			base.bitsPerPixel !== layout.bitsPerPixel ||
			base.width !== layout.width ||
			base.height !== layout.height
		) {
			continue;
		}
		return unpackAkb(file, base, undefined);
	}
	return undefined;
}

export const silkyAkbImageDescriptor: FormatDescriptor = {
	id: "silky-akb-image",
	name: "AI6WIN image",
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
			source: "ArcFormats/Silky/ImageAKB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const silkyAkbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyAkbImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x40)),
			);
			return parseAkbLayout(header) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const header = Buffer.from(
			await source.readAt(0n, Math.min(Number(source.size), 0x40)),
		);
		const layout = parseAkbLayout(header);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AI6WIN image");
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
					flags: layout.flags,
					background: [...layout.background],
					// The reference picks `Bgra32` over `Bgr32` on this bit, which is the only thing it changes.
					hasAlpha: (layout.flags & ALPHA_FLAG) !== 0,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					innerWidth: layout.innerWidth,
					innerHeight: layout.innerHeight,
					baseFileName: layout.baseFileName,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		void entry;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = parseAkbLayout(file);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AI6WIN image");
		const background =
			layout.baseFileName.length > 0
				? await readBaseImage(sourcePath, layout)
				: undefined;
		const pixels = unpackAkb(file, layout, background);
		// `ImageData.Create` with the image's own stride and no flip: the bitmap is top down.
		const bitmap =
			layout.bitsPerPixel === 24
				? writeBmp24(layout.width, layout.height, pixels, false)
				: writeBmp32(layout.width, layout.height, pixels, false);
		return Readable.from([bitmap]);
	},
});
