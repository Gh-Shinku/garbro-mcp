// Format reference: GARbro "ArcFormats/elf/ImageHIZ.cs", classes `HizFormat`, `HipFormat` and `HizMetaData`
// (an elf bitmap behind an exclusive-ored header, and the composite picture that carries one inside itself).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferByteSource,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `hiz` and `hip`, each with the byte a three letter marker leaves. */
const HIZ_SIGNATURE = Buffer.from("hiz\0", "latin1");
const HIP_SIGNATURE = Buffer.from("hip\0", "latin1");
const HEADER_SIZE = 0x18;
/** Where the picture behind a header of this format begins, which the composite kind moves further on. */
const DATA_OFFSET = 0x4c;
const HIP_DATA_OFFSET = DATA_OFFSET + HEADER_SIZE;
const COUNT_FIELD = 4;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xc;
const MARK_FIELD = 0x10;
const SIZE_FIELD = 0x14;
const HIP_INDEX_OFFSET = 0xc;
const COUNT = 100;
/** Every measurement behind the header is exclusive-ored with a word of its own. */
const WIDTH_XOR = 0xaa5a5a5a;
const HEIGHT_XOR = 0xac9326af;
const SIZE_XOR = 0x19739d6a;
/** A word that says the file is something else of this engine rather than a picture of this kind. */
const OTHER_FORMAT_WORD = 0x375a8436;
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
/** The four planes the picture is stored in, which the reader interleaves into whole pixels. */
const PLANES = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

export interface HizLayout {
	width: number;
	height: number;
}

/**
 * The header of the picture, read the way the reference's metadata reader reads it: a count that has to be a
 * hundred, two measurements behind an exclusive or, a word that says the file is another format rather than a
 * picture of this kind, and the size of the picture — which has to be exactly its pixels and no more.
 */
export function readHizHeader(header: Buffer): HizLayout | undefined {
	if (header.length < HEADER_SIZE) return undefined;
	if (header.readInt32LE(COUNT_FIELD) !== COUNT) return undefined;
	const width = (header.readUInt32LE(WIDTH_FIELD) ^ WIDTH_XOR) >>> 0;
	const height = (header.readUInt32LE(HEIGHT_FIELD) ^ HEIGHT_XOR) >>> 0;
	if (header.readInt32LE(MARK_FIELD) === OTHER_FORMAT_WORD) return undefined;
	const unpackedSize = (header.readUInt32LE(SIZE_FIELD) ^ SIZE_XOR) >>> 0;
	// The reference multiplies the measurements in the arithmetic of an unsigned word, where the product may
	// wrap around; the port keeps that product as it stands.
	if (unpackedSize !== (Math.imul(width, height) * BYTES_PER_PIXEL) >>> 0)
		return undefined;
	// The reference would be left with a picture it cannot build, and one whose pixels it cannot hold.
	if (width === 0 || height === 0) return undefined;
	if (width * height * BYTES_PER_PIXEL > MAX_IMAGE_BYTES) return undefined;
	return { width, height };
}

/** The header of a whole file: its word first, and then the header behind it. */
export async function readHizImageLayout(
	source: ByteSource,
): Promise<HizLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, HIZ_SIGNATURE.length).equals(HIZ_SIGNATURE))
			return undefined;
		return readHizHeader(header);
	} catch {
		return undefined;
	}
}

/**
 * The pixels of the picture: a stream of LZSS that carries **four planes**, one byte of every pixel each, read
 * one plane after the other and woven into whole pixels blue, green, red and alpha. The reference reads the
 * planes one by one from a single stream and refuses any plane that falls short, which is the same as refusing a
 * stream shorter than the whole picture — and the port reads the whole of it at once and weaves it after.
 */
export function renderHizPixels(
	file: Buffer,
	dataOffset: number,
	layout: HizLayout,
): Buffer {
	const planeSize = layout.width * layout.height;
	const needed = planeSize * PLANES;
	if (dataOffset > file.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Unexpected end of file");
	}
	const decoded = inflateLzss(file.subarray(dataOffset), {
		outputLength: needed,
	});
	if (decoded.length !== needed) {
		throw new GarbroError("INVALID_ARCHIVE", "Unexpected end of file");
	}
	const pixels: Buffer = Buffer.alloc(needed, 0x00);
	for (let plane = 0; plane < PLANES; plane += 1) {
		let src = plane * planeSize;
		for (let i = plane; i < needed; i += PLANES) {
			pixels[i] = decoded[src] ?? 0;
			src += 1;
		}
	}
	return pixels;
}

export const ai5HizImageDescriptor: FormatDescriptor = {
	id: "ai5-hiz-image",
	name: "elf bitmap format",
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
			source: "ArcFormats/elf/ImageHIZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5HizImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5HizImageDescriptor,
	detection: { signatures: [{ bytes: HIZ_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHizImageLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readHizImageLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid elf image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
					dataOffset: DATA_OFFSET,
				} as Record<string, unknown>,
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
	async openEntry(source: ByteSource, _entry: FixedEntry) {
		const layout = await readHizImageLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid elf image");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = renderHizPixels(file, DATA_OFFSET, layout);
		// `ImageData.Create` with no flip: the bitmap is top down with tight rows.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});

interface HipLayout {
	firstOffset: number;
	firstLength: number;
	hiz: HizLayout;
}

/**
 * The header of the composite kind: which of the two index words names the first picture and where the second
 * begins. The reference looks at the first word and, finding nothing, at the one behind it; the second picture's
 * absence means the first runs to the end of the file, and a second picture in front of the first is no file of
 * this kind.
 *
 * The picture behind those offsets is read with the reader of the plain kind, which is what makes the two
 * formats one: the measurements and the pixels both come from it.
 */
async function readHipLayout(
	source: ByteSource,
): Promise<HipLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if (!header.subarray(0, HIP_SIGNATURE.length).equals(HIP_SIGNATURE))
			return undefined;
		let indexOffset = HIP_INDEX_OFFSET;
		let firstOffset = header.readUInt32LE(indexOffset);
		if (firstOffset === 0) {
			indexOffset += 4;
			firstOffset = header.readUInt32LE(indexOffset);
			if (firstOffset === 0) return undefined;
		}
		indexOffset += 4;
		const secondOffset = header.readUInt32LE(indexOffset);
		let firstLength: number;
		if (secondOffset === 0) {
			firstLength = Number(source.size) - firstOffset;
		} else if (secondOffset < firstOffset) {
			return undefined;
		} else {
			firstLength = secondOffset - firstOffset;
		}
		// The reference hands the region to a view of the file, which refuses one that reaches past its end.
		if (firstLength < HEADER_SIZE) return undefined;
		if (BigInt(firstOffset) + BigInt(firstLength) > source.size)
			return undefined;
		const region = Buffer.from(
			await source.readAt(BigInt(firstOffset), firstLength),
		);
		if (region.length < firstLength) return undefined;
		const hiz = await readHizImageLayout(new BufferByteSource(region));
		if (!hiz) return undefined;
		return { firstOffset, firstLength, hiz };
	} catch {
		return undefined;
	}
}

export const ai5HipImageDescriptor: FormatDescriptor = {
	id: "ai5-hip-image",
	name: "elf composite image format",
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
			source: "ArcFormats/elf/ImageHIZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ai5HipImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5HipImageDescriptor,
	detection: { signatures: [{ bytes: HIP_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHipLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readHipLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid elf composite image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.hiz.width,
					height: layout.hiz.height,
					bitsPerPixel: BITS_PER_PIXEL,
					// The reference moves the offset of the picture on by the length of this header, which
					// leaves it measured from the file rather than from the picture the index words name.
					dataOffset: HIP_DATA_OFFSET,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.hiz.width,
				height: layout.hiz.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry) {
		const layout = await readHipLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid elf composite image");
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = renderHizPixels(file, HIP_DATA_OFFSET, layout.hiz);
		// `ImageData.Create` with no flip: the bitmap is top down with tight rows.
		return Readable.from([
			writeBmp32(layout.hiz.width, layout.hiz.height, pixels, false),
		]);
	},
});
