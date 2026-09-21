// Format reference: GARBro "ArcFormats/Eushully/ImageAGF.cs", class `AgfFormat` with the `AgfReader` that
// unpacks through it and the `LzssStream` it unfolds its sections with. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The engine's own word, and the word of nothing the reference registers beside it so that a picture whose
 * head is empty is taken as well.
 */
const SIGNATURE = Buffer.from("ACGF", "latin1");
const EMPTY_SIGNATURE = Buffer.alloc(4, 0x00);
/**
 * The head behind the word: a kind of picture, the size it unfolds to, and the size it is stored in. The
 * reference reads these fields out of a buffer it fills behind the word, so they stand four bytes further in.
 */
const HEADER_SIZE = 0x18;
const TYPE_FIELD = 4 + 4;
const UNPACKED_SIZE_FIELD = 4 + 0x0c;
const PACKED_SIZE_FIELD = 4 + 0x14;
/** Where the first section begins: the word and the head in front of it. */
const SECTION_START = 4 + HEADER_SIZE;
/** The head the unfolding section carries: the dimensions, and the depth the picture was stored in. */
const INNER_HEADER_SIZE = 0x20;
const INNER_WIDTH_FIELD = 0x14;
const INNER_HEIGHT_FIELD = 0x18;
const INNER_SOURCE_DEPTH_FIELD = 0x1e;
/** A picture stored in eight bits or fewer carries its colours behind the rest of that head. */
const INNER_TAIL_SIZE = 0x18;
const PALETTE_OFFSET = INNER_HEADER_SIZE + INNER_TAIL_SIZE;
const PALETTE_COLORS = 0x100;
const PALETTE_ENTRY = 4;
/** The picture itself stands behind three words of its own, which tell how long it unfolds to. */
const PICTURE_HEADER_SIZE = 12;
const PICTURE_UNPACKED_FIELD = 4;
const PICTURE_PACKED_FIELD = 8;
/** The alpha channel is a section of its own, marked with its own word. */
const ALPHA_HEADER_SIZE = 0x24;
const ALPHA_TAG = "ACIF";
const ALPHA_UNPACKED_FIELD = 0x1c;
const ALPHA_PACKED_FIELD = 0x20;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface AgfImageLayout {
	width: number;
	height: number;
	/** The depth the picture is written in: twenty four bits, or thirty two when it carries alpha. */
	bitsPerPixel: number;
	/** The depth it was stored in, which is up to thirty two. */
	sourceBitsPerPixel: number;
	/** Where the colours stand, for a picture stored in eight bits or fewer. */
	paletteOffset: number | undefined;
	/** Where the picture's own section stands. */
	pictureOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AgfReader.OpenSection`: a section that declares two different sizes is packed, and one that declares the
 * same size twice is stored as it stands. The reference wraps a packed one in an `LzssStream`, whose settings
 * are the ones this project's codec already carries.
 */
function openSection(
	data: Buffer,
	offset: number,
	unpackedSize: number,
	packedSize: number,
): Buffer {
	if (offset < 0 || packedSize < 0 || offset + packedSize > data.length) {
		throw invalidImage("A section of the picture lies outside it");
	}
	if (unpackedSize < 0 || unpackedSize > LIMIT) {
		throw invalidImage("A section of the picture is larger than it may be");
	}
	const body = data.subarray(offset, offset + packedSize);
	if (unpackedSize === packedSize) return Buffer.from(body);
	let unfolded: Buffer;
	try {
		unfolded = inflateLzss(body, { outputLength: unpackedSize });
	} catch {
		throw invalidImage("A section of the picture does not unfold");
	}
	if (unfolded.length !== unpackedSize) {
		throw invalidImage("A section of the picture does not unfold to its size");
	}
	return unfolded;
}

/**
 * `AgfFormat.ReadMetaData`: the file opens with the engine's word, or with nothing at all, and the head
 * behind it names the kind of picture, how large it unfolds to and how large it is stored. Those first bytes
 * unfold to a head of their own, which holds the dimensions and the depth the picture was stored in.
 */
export function readAgfImageLayout(data: Buffer): AgfImageLayout | undefined {
	if (data.length < SECTION_START) return undefined;
	const signature = data.subarray(0, 4);
	if (!signature.equals(SIGNATURE) && !signature.equals(EMPTY_SIGNATURE)) {
		return undefined;
	}
	const type = data.readInt32LE(TYPE_FIELD);
	if (1 !== type && 2 !== type) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD);
	if (unpackedSize < INNER_HEADER_SIZE) return undefined;

	let inner: Buffer;
	try {
		inner = openSection(data, SECTION_START, unpackedSize, packedSize);
	} catch {
		return undefined;
	}
	if (inner.length < INNER_HEADER_SIZE) return undefined;
	const width = inner.readUInt32LE(INNER_WIDTH_FIELD);
	const height = inner.readUInt32LE(INNER_HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	const sourceBitsPerPixel = inner.readInt16LE(INNER_SOURCE_DEPTH_FIELD);
	if (sourceBitsPerPixel <= 0 || sourceBitsPerPixel > 32) return undefined;
	const bitsPerPixel = 1 === type ? 24 : 32;
	const total = width * height * (bitsPerPixel / 8);
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	const paletteOffset = sourceBitsPerPixel <= 8 ? PALETTE_OFFSET : undefined;
	if (
		undefined !== paletteOffset &&
		paletteOffset + PALETTE_COLORS * PALETTE_ENTRY > inner.length
	) {
		return undefined;
	}
	const pictureOffset = HEADER_SIZE + packedSize;
	if (pictureOffset + PICTURE_HEADER_SIZE > data.length) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		sourceBitsPerPixel,
		paletteOffset,
		pictureOffset,
	};
}

/** The colours a picture stored in eight bits or fewer carries, blue first as a bitmap wants them. */
function readPalette(inner: Buffer, layout: AgfImageLayout): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_COLORS * PALETTE_ENTRY, 0x00);
	const at = layout.paletteOffset ?? 0;
	inner.copy(palette, 0, at, at + PALETTE_COLORS * PALETTE_ENTRY);
	return palette;
}

/**
 * `AgfReader.ReadAlphaChannel`: the section behind the picture opens with its own word and the size it unfolds
 * to, which must be one byte to a pixel. A section that is missing, is marked with another word, or unfolds
 * to another size leaves the picture without an alpha channel, which is how the reference falls back to
 * twenty four bits.
 */
function readAlpha(
	data: Buffer,
	layout: AgfImageLayout,
	offset: number,
): Buffer | undefined {
	if (offset + ALPHA_HEADER_SIZE > data.length) return undefined;
	if (data.toString("latin1", offset, offset + 4) !== ALPHA_TAG) {
		return undefined;
	}
	const unpackedSize = data.readInt32LE(offset + ALPHA_UNPACKED_FIELD);
	const packedSize = data.readInt32LE(offset + ALPHA_PACKED_FIELD);
	if (layout.width * layout.height !== unpackedSize) return undefined;
	try {
		return openSection(
			data,
			offset + ALPHA_HEADER_SIZE,
			unpackedSize,
			packedSize,
		);
	} catch {
		return undefined;
	}
}

/**
 * `AgfReader.Unpack` with its three ways of walking a row. The picture is stored with its **last row first**,
 * so the rows are turned over as they are written, while the alpha channel behind it stands in the order the
 * picture is finally seen in. A picture stored in four or eight bits names its colours through the palette it
 * carries, the four bit kind taking the **higher nibble of a byte first**.
 */
export function decodeAgf(
	data: Buffer,
	layout: AgfImageLayout,
): { pixels: Buffer; bitsPerPixel: number } {
	const picture = data.subarray(layout.pictureOffset);
	if (picture.length < PICTURE_HEADER_SIZE) {
		throw invalidImage("The picture ends before its own head");
	}
	const dataSize = picture.readInt32LE(PICTURE_UNPACKED_FIELD);
	const packedSize = picture.readInt32LE(PICTURE_PACKED_FIELD);
	const body = openSection(
		data,
		layout.pictureOffset + PICTURE_HEADER_SIZE,
		dataSize,
		packedSize,
	);
	let bitsPerPixel = layout.bitsPerPixel;
	let alpha: Buffer | undefined;
	if (32 === bitsPerPixel) {
		alpha = readAlpha(
			data,
			layout,
			layout.pictureOffset + PICTURE_HEADER_SIZE + packedSize,
		);
		if (undefined === alpha) bitsPerPixel = 24;
	}
	let colours: Buffer | undefined;
	if (layout.sourceBitsPerPixel <= 8) {
		colours = readPalette(
			openSection(
				data,
				SECTION_START,
				data.readInt32LE(UNPACKED_SIZE_FIELD),
				data.readInt32LE(PACKED_SIZE_FIELD),
			),
			layout,
		);
	}
	const sourcePixelSize = layout.sourceBitsPerPixel >> 3;
	const destinationPixelSize = bitsPerPixel >> 3;
	const sourceStride =
		((layout.width * layout.sourceBitsPerPixel) / 8 + 3) & ~3;
	const destinationStride = layout.width * destinationPixelSize;
	const output: Buffer = Buffer.alloc(layout.height * destinationStride, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		// The picture is stored with its last row first, while the picture written here runs from the top.
		const source = (layout.height - 1 - row) * sourceStride;
		const destination = row * destinationStride;
		// The alpha channel stands in the order the picture is seen in, so its row follows the written one.
		const alphaAt = row * layout.width;
		for (let x = 0; x < layout.width; x += 1) {
			const at = destination + x * destinationPixelSize;
			if (colours) {
				let index: number;
				if (4 === layout.sourceBitsPerPixel) {
					const packed = body[source + (x >> 1)] ?? 0;
					index = 0 === (x & 1) ? (packed >> 4) & 0x0f : packed & 0x0f;
				} else {
					index = body[source + x] ?? 0;
				}
				output[at] = colours[index * PALETTE_ENTRY] ?? 0;
				output[at + 1] = colours[index * PALETTE_ENTRY + 1] ?? 0;
				output[at + 2] = colours[index * PALETTE_ENTRY + 2] ?? 0;
			} else {
				const from = source + x * sourcePixelSize;
				output[at] = body[from] ?? 0;
				output[at + 1] = body[from + 1] ?? 0;
				output[at + 2] = body[from + 2] ?? 0;
			}
			if (alpha) output[at + 3] = alpha[alphaAt + x] ?? 0;
		}
	}
	return { pixels: output, bitsPerPixel };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const eushullyAgfImageDescriptor: FormatDescriptor = {
	id: "eushully-agf-image",
	name: "Eushully image",
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
			source: "ArcFormats/Eushully/ImageAGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eushullyAgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eushullyAgfImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }, { bytes: EMPTY_SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SECTION_START)) return false;
		return readAgfImageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readAgfImageLayout(stored);
		if (!layout) {
			throw invalidImage("Not an Eushully picture");
		}
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
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				sourceBitsPerPixel: layout.sourceBitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAgfImageLayout(stored);
		if (!layout) {
			throw invalidImage("Not an Eushully picture");
		}
		const { pixels, bitsPerPixel } = decodeAgf(stored, layout);
		// The rows are turned over while they are written, so the bitmap keeps a positive height.
		return Readable.from([
			bitsPerPixel === 32
				? writeBmp32(layout.width, layout.height, pixels, false)
				: writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
