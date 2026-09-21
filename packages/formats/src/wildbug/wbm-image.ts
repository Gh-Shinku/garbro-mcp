// Format reference: GARBro "ArcFormats/WildBug/ImageWBM.cs", classes `WbmFormat`, the `WbmReader` whose
// nine packed walks stand on the `WpxDecoder` base, and the section walk shared with the ported sound in
// `wpx-section.ts`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB555_MASKS,
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
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
/** The one way of storing a section that is read as it stands, and the bits that pick a packed walk. */
const STORED_FORMAT = 0x80;
const WALK_BITS = 0x0f;
/** The bytes a walk reads at a time, and the step the first pixel of a packed picture takes. */
const BUFFER_SIZE = 0x8000;
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
		`The packed way 0x${dataFormat.toString(16)} of a Wild Bug picture is not ported (${describeFormat(dataFormat)})`,
	);
}

/** Which of the nine walks of the reference a section's own byte asks for, said plainly. */
function describeFormat(dataFormat: number): string {
	const way = dataFormat & WALK_BITS;
	if (0 === way) return "the walk this port reads";
	return `the 0x${way.toString(16).padStart(2, "0")} walk`;
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
 * `WpxDecoder`, the base every walk of this engine stands on: a sliding buffer of thirty two thousand bytes
 * over the section's packed bytes, a byte at a time for a literal, and a bit reader over the same buffer for
 * the flags of a walk. `readNext` refuses where the reference throws, which lets the walk that asked for the
 * byte be tried again the reference's way.
 */
export class WbmPackedReader {
	readonly output: Buffer;
	/** The section's packed bytes, and what is left of them. */
	#whole: Buffer;
	#rest: Buffer;
	#remaining: number;
	readonly #buffer: Buffer = Buffer.alloc(BUFFER_SIZE, 0x00);
	#current = 0;
	#available = 0;
	#bits = 0;
	#bitCount = 0;

	constructor(section: Buffer, packedSize: number, unpackedSize: number) {
		this.#whole = Buffer.from(section.subarray(0, packedSize));
		this.#rest = this.#whole;
		this.#remaining = this.#whole.length;
		this.output = Buffer.alloc(unpackedSize, 0x00);
	}

	/** `WpxDecoder.ResetInput`: every attempt starts over at the section's first byte. */
	reset(): void {
		this.#rest = this.#whole;
		this.#remaining = this.#whole.length;
		this.#current = 0;
		this.#available = 0;
		this.#bits = 0;
		this.#bitCount = 0;
	}

	/** `WpxDecoder.FillBuffer`: as much of what is left as the buffer takes. */
	fillBuffer(): number {
		if (this.#remaining <= 0) return 0;
		const size = Math.min(this.#remaining, BUFFER_SIZE);
		const chunk = this.#rest.subarray(0, size);
		this.#rest = this.#rest.subarray(size);
		this.#remaining -= size;
		chunk.copy(this.#buffer, 0);
		return chunk.length;
	}

	readNext(): number {
		if (this.#current >= this.#available) {
			this.#available = this.fillBuffer();
			if (0 === this.#available) {
				throw invalid("The picture ends before its own bytes do");
			}
			this.#current = 0;
		}
		const value = this.#buffer[this.#current] ?? 0;
		this.#current += 1;
		return value;
	}

	/** `WpxDecoder.ReadCount`: a run of one bits names how many bits the count itself takes. */
	readCount(): number {
		let steps = 1;
		while (0 === this.nextBit()) steps += 1;
		let count = 1;
		for (let index = 0; index < steps; index += 1) {
			count = count + count + this.nextBit();
		}
		return count - 1;
	}

	/**
	 * The start of a walk: the buffer is filled, and how much it took is kept, which is what the reference's
	 * own `m_available` field holds and what every byte read behind it is measured against.
	 */
	begin(): number {
		this.#available = this.fillBuffer();
		return this.#available;
	}

	/** The first pixel of a packed picture is copied straight out of the buffer, as the reference does. */
	copyFromBuffer(target: Buffer, offset: number, count: number): void {
		this.#buffer.copy(target, 0, offset, offset + count);
	}

	/**
	 * The bits of a packed picture begin behind that first pixel, padded to a whole four bytes; the
	 * reference sets its own cursor there and loads the byte it finds.
	 */
	beginBitsAt(offset: number): void {
		this.#current = offset;
		this.#bits = this.#buffer[this.#current] ?? 0;
		this.#current += 1;
		this.#bitCount = 8;
	}

	nextBit(): number {
		if (0 === this.#bitCount) {
			this.#bits = this.readNext();
			this.#bitCount = 8;
		}
		const bit = (this.#bits >> 7) & 1;
		this.#bits = (this.#bits << 1) & 0xff;
		this.#bitCount -= 1;
		return bit;
	}
}

/** `WbmReader.GenerateOffsetTableV1`: eight pixel offsets, taken from the row above once a row is wide. */
export function offsetTableV1(stride: number, pixelSize: number): number[] {
	const table = [0, 0, 0, 0, 0, 0, 0, 0];
	table[4] = pixelSize;
	table[2] = 2 * pixelSize;
	table[5] = 3 * pixelSize;
	if (5 * pixelSize < stride) {
		table[6] = stride - pixelSize;
		table[0] = stride;
		table[7] = pixelSize + stride;
		table[3] = 2 * pixelSize + stride;
		table[1] = 2 * stride;
	} else {
		table[6] = 4 * pixelSize;
		table[0] = 5 * pixelSize;
		table[7] = 6 * pixelSize;
		table[3] = 7 * pixelSize;
		table[1] = 8 * pixelSize;
	}
	return table;
}

/** `WbmReader.GenerateOffsetTableV2`, the table every walk starts with. */
export function offsetTableV2(stride: number, pixelSize: number): number[] {
	const table = [0, 0, 0, 0, 0, 0, 0, 0];
	table[0] = pixelSize;
	table[1] = 2 * pixelSize;
	table[2] = 3 * pixelSize;
	if (5 * pixelSize < stride) {
		table[3] = stride - pixelSize;
		table[4] = stride;
		table[5] = pixelSize + stride;
		table[6] = 2 * pixelSize + stride;
		table[7] = 2 * stride;
	} else {
		table[3] = 4 * pixelSize;
		table[4] = 5 * pixelSize;
		table[5] = 6 * pixelSize;
		table[6] = 7 * pixelSize;
		table[7] = 8 * pixelSize;
	}
	return table;
}

/**
 * `WbmReader.UnpackV1`, the `0x01` walk: much the same shape as the `0x00` one, but its back references
 * differ. On the reference's first attempt a reference is either a byte or a word away from the byte before
 * the place it writes to, and stands for a run of two or three bytes; on the later attempts one of the two
 * forms is a short run taken from the table of pixel offsets instead. A clear bit behind either form **adds**
 * the counted run to the run itself, where the `0x00` walk let the counted run stand for the whole of it.
 */
export function unpackV1(
	reader: WbmPackedReader,
	offsetTable: readonly number[],
	pixelSize: number,
	condition: number,
	version: number,
): Buffer | undefined {
	const minCount = 1 === pixelSize ? 2 : 1;
	const available = reader.begin();
	if (0 === available) return undefined;
	const step = (pixelSize + 3) & ~3;
	if (available < step) return undefined;
	reader.copyFromBuffer(reader.output, 0, pixelSize);
	let destination = pixelSize;
	let remaining = reader.output.length - pixelSize;
	reader.beginBitsAt(step);
	while (remaining > 0) {
		while (condition === reader.nextBit()) {
			reader.output[destination] = reader.readNext();
			destination += 1;
			remaining -= 1;
			if (0 === remaining) return reader.output;
		}
		let count: number;
		let source: number;
		if (version > 1) {
			if (0 !== reader.nextBit()) {
				if (0 !== reader.nextBit()) {
					source = reader.readNext();
					count = 2;
				} else {
					source = reader.readNext() | (reader.readNext() << 8);
					count = 3;
				}
				source = destination - 1 - source;
			} else {
				count = minCount;
				let index = reader.nextBit();
				index = index + index + reader.nextBit();
				index = index + index + reader.nextBit();
				source = destination - (offsetTable[index] ?? 0);
			}
		} else if (0 !== reader.nextBit()) {
			count = minCount;
			let index = reader.nextBit() << 2;
			index |= reader.nextBit() << 1;
			index |= reader.nextBit();
			source = destination - (offsetTable[index] ?? 0);
		} else {
			count = 2;
			source = destination - 1 - reader.readNext();
		}
		if (0 === reader.nextBit()) count += reader.readCount();
		if (remaining < count) return undefined;
		if (!copyOverlapped(reader.output, source, destination, count)) {
			// The reference's own copy walks off the buffer here, which its caller catches.
			throw invalid("A run of the picture reaches outside it");
		}
		destination += count;
		remaining -= count;
	}
	return reader.output;
}

/**
 * `WbmReader.UnpackV0`, the `0x00` walk: the first pixel is copied as it stands and then the picture is read
 * a bit at a time. A bit equal to the walk's own condition is a literal byte; any other bit begins a back
 * reference, whose three bits name one of the eight pixel offsets and whose following bit says whether the
 * run is the shortest one or a counted one.
 *
 * The walk hands nothing back for three of its own findings - the section holds no bytes, it holds fewer
 * bytes than the first pixel takes, or a run reaches past the picture - and the reference lets those end the
 * whole unpack rather than trying again, which is what this does as well.
 */
export function unpackV0(
	reader: WbmPackedReader,
	offsetTable: readonly number[],
	pixelSize: number,
	condition: number,
): Buffer | undefined {
	const minCount = 1 === pixelSize ? 2 : 1;
	const available = reader.begin();
	if (0 === available) return undefined;
	const step = (pixelSize + 3) & ~3;
	if (available < step) return undefined;
	reader.copyFromBuffer(reader.output, 0, pixelSize);
	let destination = pixelSize;
	let remaining = reader.output.length - pixelSize;
	reader.beginBitsAt(step);
	while (remaining > 0) {
		while (condition === reader.nextBit()) {
			reader.output[destination] = reader.readNext();
			destination += 1;
			remaining -= 1;
			if (0 === remaining) return reader.output;
		}
		let index = reader.nextBit() << 2;
		index |= reader.nextBit() << 1;
		index |= reader.nextBit();
		const source = destination - (offsetTable[index] ?? 0);
		const count =
			0 !== reader.nextBit() ? minCount : minCount + reader.readCount();
		if (remaining < count) return undefined;
		if (!copyOverlapped(reader.output, source, destination, count)) {
			// The reference's own copy walks off the buffer here, which its caller catches.
			throw invalid("A run of the picture reaches outside it");
		}
		destination += count;
		remaining -= count;
	}
	return reader.output;
}

/** The section's bytes as they stand, which is how the reference reads the one stored way. */
function storedSection(data: Buffer, section: WpxSection): Buffer | undefined {
	return readWpxSectionData(data, section, section.unpackedSize);
}

/**
 * `WbmReader.Unpack`: a section kept as it stands when its format has the top bit set or declares no packed
 * length at all; otherwise one of the nine walks, of which this port reads the `0x00` one, with the three
 * attempts the reference makes over its two offset tables.
 */
export function unpackWbmSection(
	data: Buffer,
	section: WpxSection,
	stride: number,
	pixelSize: number,
	what: string,
): Buffer {
	if (0 === (section.dataFormat & STORED_FORMAT) && 0 !== section.packedSize) {
		const way = section.dataFormat & WALK_BITS;
		if (0 !== way && 1 !== way) {
			throw unsupported(section.dataFormat);
		}
		const bytes = readWpxSectionData(data, section, section.packedSize);
		if (!bytes) {
			throw invalid(`The picture's ${what} reaches past the end of the file`);
		}
		let table = offsetTableV2(stride, pixelSize);
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (1 === attempt) table = offsetTableV1(stride, pixelSize);
			const reader = new WbmPackedReader(
				bytes,
				bytes.length,
				section.unpackedSize,
			);
			try {
				// The reference's own three attempts: two with the later table and one bit, and one with
				// the earlier table and a bit of nothing. The walk is told which attempt it is, because
				// the first one shapes its references differently.
				const condition = attempt < 2 ? 1 : 0;
				const version = 2 - attempt;
				const result =
					0 === way
						? unpackV0(reader, table, pixelSize, condition)
						: unpackV1(reader, table, pixelSize, condition, version);
				// A finding of the walk's own ends the unpack, as it does in the reference.
				if (!result) throw invalid("The picture does not unpack");
				return result;
			} catch (error) {
				if (2 === attempt) throw error;
			}
		}
	}
	const stored = storedSection(data, section);
	if (!stored) {
		throw invalid(`The picture's ${what} reaches past the end of the file`);
	}
	return stored;
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
	const pixels = unpackWbmSection(
		data,
		layout.pixels,
		layout.stride,
		layout.pixelSize,
		"pixels",
	);
	if (pixels.length < layout.stride * layout.height) {
		throw invalid("The picture is shorter than the size its head names");
	}
	let palette: Buffer | undefined;
	if (layout.palette) {
		try {
			palette = readPalette(
				unpackWbmSection(
					data,
					layout.palette,
					PALETTE_COLORS * PALETTE_ENTRY,
					PALETTE_ENTRY,
					"colours",
				),
			);
		} catch {
			// The reference lets a failed colour section leave the picture without colours at all.
			palette = undefined;
		}
	}
	let alpha: Buffer | undefined;
	if (layout.alpha) {
		try {
			const bytes = unpackWbmSection(
				data,
				layout.alpha,
				layout.alphaStride,
				1,
				"alpha channel",
			);
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
			project: "GARBro",
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
