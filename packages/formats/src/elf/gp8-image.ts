// Format reference: GARbro "ArcFormats/elf/ImageGP8.cs", classes `Gp8Format` and `MskFormat` (two Ai5 engine
// images: an indexed picture with its palette in front of it, and a mask without one).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const OFFSET_X_FIELD = 0;
const OFFSET_Y_FIELD = 2;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const PALETTE_OFFSET = HEADER_SIZE;
const PALETTE_ENTRIES = 0x100;
const PALETTE_ENTRY_SIZE = 4;
/** Where the picture itself begins, behind the palette of the indexed kind. */
const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_ENTRIES * PALETTE_ENTRY_SIZE;
const BITS_PER_PIXEL = 8;
const MAX_DIMENSION = 0x1000;
/** Where the two kinds allow a picture to be placed, which they do not agree on. */
const INDEXED_POSITION_LIMIT = 0x300;
const MASK_POSITION_LIMIT = 0x800;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface Ai5Header {
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
}

/** The eight bytes both kinds of picture begin with: where it belongs and how large it is, all signed words. */
async function readHeader(source: ByteSource): Promise<Ai5Header | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		return {
			offsetX: header.readInt16LE(OFFSET_X_FIELD),
			offsetY: header.readInt16LE(OFFSET_Y_FIELD),
			width: header.readInt16LE(WIDTH_FIELD),
			height: header.readInt16LE(HEIGHT_FIELD),
		};
	} catch {
		return undefined;
	}
}

/**
 * The indexed kind: the file has to be longer than its palette — a picture of nothing at all is no picture —
 * and both of its positions have to lie within three hundred of the beginning.
 */
async function readGp8Layout(
	source: ByteSource,
): Promise<Ai5Header | undefined> {
	if (source.size <= BigInt(PIXEL_OFFSET)) return undefined;
	const header = await readHeader(source);
	if (!header) return undefined;
	if (
		header.offsetX < 0 ||
		header.offsetY < 0 ||
		header.offsetX > INDEXED_POSITION_LIMIT ||
		header.offsetY > INDEXED_POSITION_LIMIT
	) {
		return undefined;
	}
	if (
		header.width <= 0 ||
		header.width > MAX_DIMENSION ||
		header.height <= 0 ||
		header.height > MAX_DIMENSION
	) {
		return undefined;
	}
	return header;
}

/**
 * The mask: no palette, no length to speak of, and positions allowed twice as far from the beginning as the
 * indexed kind's. The reference reads its eight bytes without asking whether they are there, which stops a
 * shorter file just as finding no header does.
 */
async function readMskLayout(
	source: ByteSource,
): Promise<Ai5Header | undefined> {
	const header = await readHeader(source);
	if (!header) return undefined;
	if (
		header.offsetX < 0 ||
		header.offsetY < 0 ||
		header.offsetX > MASK_POSITION_LIMIT ||
		header.offsetY > MASK_POSITION_LIMIT
	) {
		return undefined;
	}
	if (
		header.width <= 0 ||
		header.width > MAX_DIMENSION ||
		header.height <= 0 ||
		header.height > MAX_DIMENSION
	) {
		return undefined;
	}
	return header;
}

/**
 * The pixels both kinds keep behind their headers: a stream of LZSS whose length the reader requires to be the
 * whole picture. The reference reads into a buffer of exactly that many bytes and refuses anything else, so a
 * stream that stops short is an error rather than a picture with its tail left black.
 */
function readPixels(stored: Buffer, needed: number): Buffer {
	const decoded = inflateLzss(stored, { outputLength: needed });
	if (decoded.length !== needed) {
		throw new GarbroError("INVALID_ARCHIVE", "Truncated Ai5 image pixels");
	}
	return decoded;
}

/** The palette of the indexed kind, as a bitmap names its colours: blue, green, red and nothing. */
function readPalette(file: Buffer): Buffer {
	const palette: Buffer = Buffer.alloc(
		PALETTE_ENTRIES * PALETTE_ENTRY_SIZE,
		0x00,
	);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const at = PALETTE_OFFSET + index * PALETTE_ENTRY_SIZE;
		// The reference makes a colour of the first three bytes and drops the fourth.
		palette[index * PALETTE_ENTRY_SIZE] = file[at] ?? 0;
		palette[index * PALETTE_ENTRY_SIZE + 1] = file[at + 1] ?? 0;
		palette[index * PALETTE_ENTRY_SIZE + 2] = file[at + 2] ?? 0;
	}
	return palette;
}

interface Ai5ImageInput {
	descriptor: FormatDescriptor;
	readLayout(source: ByteSource): Promise<Ai5Header | undefined>;
	/** Where the compressed pixels begin, and whether a palette sits in front of the picture. */
	pixelOffset: number;
	indexed: boolean;
	/** Whether the reference carries the position of the picture into its measurements. */
	reportOffsets: boolean;
	invalidMessage: string;
}

/** Both kinds are the same format around the same stream, so they are built the same way. */
function defineAi5Image(input: Ai5ImageInput): ArchiveFormat {
	return defineFixedArchive({
		descriptor: input.descriptor,
		detection: { signatures: [] },
		async detect(source: ByteSource): Promise<boolean> {
			return (await input.readLayout(source)) !== undefined;
		},
		async read(source: ByteSource, sourcePath: string) {
			const layout = await input.readLayout(source);
			if (!layout)
				throw new GarbroError("INVALID_ARCHIVE", input.invalidMessage);
			const metadata: Record<string, unknown> = {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			};
			if (input.reportOffsets) {
				metadata.offsetX = layout.offsetX;
				metadata.offsetY = layout.offsetY;
			}
			const entry: FixedEntry = {
				...createFixedEntry({
					id: 0,
					path: changeExtension(leafName(sourcePath), "bmp"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata,
				}),
				// The stored stream is compressed and a bitmap header is written around the pixels.
				sizeKnown: false,
			};
			return {
				entries: [entry],
				metadata: {
					image: "bmp",
					compression: "lzss",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				},
			};
		},
		async openEntry(source: ByteSource) {
			const layout = await input.readLayout(source);
			if (!layout)
				throw new GarbroError("INVALID_ARCHIVE", input.invalidMessage);
			const file = Buffer.from(await source.readAt(0n, Number(source.size)));
			if (file.length < input.pixelOffset) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Ai5 image header");
			}
			const needed = layout.width * layout.height;
			const pixels = readPixels(file.subarray(input.pixelOffset), needed);
			// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
			if (input.indexed) {
				return Readable.from([
					writeBmp8Palette(
						layout.width,
						layout.height,
						pixels,
						readPalette(file),
						true,
					),
				]);
			}
			return Readable.from([
				writeBmp8(layout.width, layout.height, pixels, true),
			]);
		},
	});
}

export const ai5Gp8ImageDescriptor: FormatDescriptor = {
	id: "ai5-gp8-image",
	name: "Ai5 engine indexed image",
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
			source: "ArcFormats/elf/ImageGP8.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5Gp8ImageFormat: ArchiveFormat = defineAi5Image({
	descriptor: ai5Gp8ImageDescriptor,
	readLayout: readGp8Layout,
	pixelOffset: PIXEL_OFFSET,
	indexed: true,
	reportOffsets: false,
	invalidMessage: "Invalid Ai5 indexed image",
});

export const ai5MskImageDescriptor: FormatDescriptor = {
	id: "ai5-msk-image",
	name: "Ai5 engine image mask",
	extensions: ["msk"],
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
			source: "ArcFormats/elf/ImageGP8.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5MskImageFormat: ArchiveFormat = defineAi5Image({
	descriptor: ai5MskImageDescriptor,
	readLayout: readMskLayout,
	pixelOffset: HEADER_SIZE,
	indexed: false,
	reportOffsets: true,
	invalidMessage: "Invalid Ai5 image mask",
});
