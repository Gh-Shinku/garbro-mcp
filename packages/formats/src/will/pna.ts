// Format reference: GARBro ArcFormats/Will/ArcPNA.cs, class `PnaOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { readBmpImage } from "../shared/bmp.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readPngImage } from "../shared/png-image.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PNAP", "ascii");
const COUNT_OFFSET = 0x10;
const INDEX_START = 0x14;
const RECORD_SIZE = 0x28;
const X_OFFSET = 0x08;
const Y_OFFSET = 0x0c;
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
const SIZE_OFFSET = 0x24;
const NAME_WIDTH = 3;
/** The places of a colour of a picture of this engine, of four places of the file to a pixel. */
const PLACES = 4;
/** The words every picture a frame of this engine stands of opens with. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const BMP_SIGNATURE = Buffer.from("BM", "latin1");
/** Every frame is stored as thirty-two bit colour. */
const BITS_PER_PIXEL = 32;

/**
 * GARBro `PnaOpener.TryOpen`. A `PNAP` header carries the frame count at 0x10 and a table of 0x28-byte
 * frame records from 0x14. Payloads follow the table in record order.
 *
 * A record with a zero size is skipped and does not advance the payload cursor, which is where the
 * reference's logic differs from a plain walk: skipped frames also leave a gap in the numbering, because
 * frame names use the record index rather than the entry count.
 *
 * Frames are named `<archive>#<index>` with a three-digit index and typed as images. Their placement and
 * the frame geometry — position, size and thirty-two bit colour — are recorded as metadata; decoding the
 * frames themselves belongs to the image layer and is out of scope.
 */
async function readPnaIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const tableEnd = BigInt(INDEX_START + count * RECORD_SIZE);
	if (tableEnd > source.size) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	let payloadOffset = tableEnd;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (size === 0n) continue;
		if (!checkPlacement(payloadOffset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
			),
			offset: payloadOffset,
			size,
			metadata: {
				type: "image",
				x: index.readInt32LE(record + X_OFFSET),
				y: index.readInt32LE(record + Y_OFFSET),
				width: index.readUInt32LE(record + WIDTH_OFFSET),
				height: index.readUInt32LE(record + HEIGHT_OFFSET),
				bpp: BITS_PER_PIXEL,
			},
		});
		entries.push(entry);
		payloadOffset += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * `PnaDecoder.ReadPixels`: the reference reads the frame as a picture of its own and then stands of the
 * covering place of every pixel of it, which the picture of the frame carries over the places of its colour.
 * A covering place of nought or of the whole stands of no count of its own.
 */
export function unpremultiplyPnaPixels(pixels: Buffer): Buffer {
	for (let at = 0; at + 3 < pixels.length; at += PLACES) {
		const alpha = pixels[at + 3] ?? 0;
		if (0 === alpha || 0xff === alpha) continue;
		for (let place = 0; place < 3; place += 1) {
			// The reference stands of a place of the file of the picture, of the whole of the places of a
			// colour taken against the covering place; a count that stands over the whole stands of the
			// places of the file of the place itself, of the whole of them taken off.
			pixels[at + place] =
				Math.trunc(((pixels[at + place] ?? 0) * 0xff) / alpha) & 0xff;
		}
	}
	return pixels;
}

/** The places of a picture of a frame as four places of a colour to a pixel, blue first. */
function toBgra32(image: {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	palette?: Buffer;
}): Buffer | undefined {
	if (32 === image.bitsPerPixel) return Buffer.from(image.pixels);
	if (24 === image.bitsPerPixel) {
		const places = Buffer.alloc(image.width * image.height * PLACES, 0xff);
		for (let at = 0, to = 0; to < places.length; at += 3, to += PLACES) {
			places[to] = image.pixels[at] ?? 0;
			places[to + 1] = image.pixels[at + 1] ?? 0;
			places[to + 2] = image.pixels[at + 2] ?? 0;
		}
		return places;
	}
	if (8 === image.bitsPerPixel && image.palette) {
		const places = Buffer.alloc(image.width * image.height * PLACES, 0x00);
		for (let at = 0; at < places.length; at += PLACES) {
			const entry = (image.pixels[at >> 2] ?? 0) * PLACES;
			places[at] = image.palette[entry] ?? 0;
			places[at + 1] = image.palette[entry + 1] ?? 0;
			places[at + 2] = image.palette[entry + 2] ?? 0;
			// A colour map of a bitmap of this project stands of four places of a colour whose last place
			// stands of no count of its own; the reference reads the colour map of the engine, which stands
			// of the places of a colour alone.
			places[at + 3] = 0xff;
		}
		return places;
	}
	return undefined;
}

/** `ImageFormat.Read`, of the walks of the pictures this project carries. */
async function readPnaPicture(
	data: Buffer,
): Promise<{ width: number; height: number; pixels: Buffer } | undefined> {
	if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		const image = await readPngImage(data);
		if (!image) return undefined;
		const pixels = toBgra32(image);
		return pixels
			? { width: image.width, height: image.height, pixels }
			: undefined;
	}
	if (data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
		const image = readJpegImage(data);
		return {
			width: image.width,
			height: image.height,
			pixels: Buffer.from(image.pixels),
		};
	}
	if (data.subarray(0, BMP_SIGNATURE.length).equals(BMP_SIGNATURE)) {
		const image = readBmpImage(data);
		if (!image) return undefined;
		const pixels = toBgra32(image);
		return pixels
			? { width: image.width, height: image.height, pixels }
			: undefined;
	}
	return undefined;
}

/**
 * `PnaOpener.OpenImage` and the `PnaDecoder` behind it: the places of the file of a frame stand of a picture
 * of its own, which stands read of the walks of this project and then of the covering place of every pixel.
 */
const pnaEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const picture = await readPnaPicture(data);
	if (!picture) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The frame ${entry.path} stands of no picture this project reads`,
		);
	}
	// The reference hands the places of the picture over of the counts of the head of the frame, which must
	// stand of the counts of the picture itself.
	const width = Number(entry.metadata?.width ?? 0);
	const height = Number(entry.metadata?.height ?? 0);
	if (width !== picture.width || height !== picture.height) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The frame ${entry.path} stands of a picture of ${picture.width}x${picture.height} places against ${width}x${height}`,
		);
	}
	return Readable.from([
		writeBmp32(
			picture.width,
			picture.height,
			unpremultiplyPnaPixels(picture.pixels),
		),
	]);
};

export const willPnaDescriptor: FormatDescriptor = {
	id: "will-pna",
	name: "Pulltop multi-frame image format",
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
			source: "ArcFormats/Will/ArcPNA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willPnaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: willPnaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPnaIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPnaIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PNA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pnaEntryOpener,
});
