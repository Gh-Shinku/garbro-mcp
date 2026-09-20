// Format reference: GARbro "ArcFormats/Seraphim/ImageSeraph.cs", classes `SeraphCfImage`, `SeraphCtImage`,
// `SeraphCbImage`, `SeraphCxImage` and the reader they share, `SeraphReader` (Seraphim engine images).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x10;
/** The reference reads the map of an eight bit picture with `Math.Min (colors, 0x100)` entries. */
const MAX_PALETTE_COLORS = 0x100;
/** The reference multiplies the measurements without a check; a cap keeps a broken header from asking for all of memory. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
/** A control byte whose high nibble is fifteen is not an opcode: the reference throws on it. */
const INVALID_CONTROL_MASK = 0xf0;
const INVALID_CONTROL_VALUE = 0xf0;

/**
 * The three pictures that begin with the same two letters: the reference registers all four of its words for
 * `SeraphCfImage` and hands that list down to `SeraphCtImage` and `SeraphCxImage` through the constructor of the
 * class they extend, so a file of either of those is found by the very same words. The list ends in a zero,
 * which is the pass that offers every remaining file to the format; the port keeps that as an extension
 * fallback.
 */
const CF_SIGNATURE_BYTES: Buffer[] = [
	Buffer.from([0x43, 0x46, 0x00, 0x00]),
	Buffer.from([0x43, 0x46, 0x02, 0x00]),
	Buffer.from([0x43, 0x46, 0x04, 0x00]),
	Buffer.from([0x43, 0x46, 0x07, 0x00]),
	Buffer.from([0x43, 0x46, 0x09, 0x00]),
	Buffer.from([0x43, 0x46, 0x14, 0x00]),
];

/** `SeraphCbImage` registers one word beside the zero of the same second pass. */
const CB_SIGNATURE_BYTES: Buffer[] = [Buffer.from([0x43, 0x42, 0x00, 0x01])];

interface SeraphPixelsLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The length of the compressed stream behind the header. */
	packedSize: number;
}

interface SeraphIndexedLayout extends SeraphPixelsLayout {
	colors: number;
}

/** A reader over the stored bytes that keeps the reference's stream semantics. */
class SeraphStream {
	private position: number;

	constructor(
		private readonly data: Buffer,
		position = 0,
	) {
		this.position = position;
	}

	/**
	 * .NET `ReadByte`: the byte, or minus one at the end of the stream. Opcodes that count with that value are
	 * signed in the reference, and the port keeps it signed so that the arithmetic of a truncated stream is the
	 * same.
	 */
	readByte(): number {
		if (this.position >= this.data.length) return -1;
		const value = this.data[this.position] ?? 0;
		this.position += 1;
		return value;
	}

	/**
	 * .NET `Stream.Read`: as many bytes as are left, at most `count`. A short read is the end of the stream, and
	 * a range outside the target is the exception the reference's own copy would raise.
	 */
	read(target: Buffer, offset: number, count: number): number {
		if (offset < 0 || count < 0 || offset + count > target.length) {
			throw invalidStream();
		}
		const length = Math.min(
			count,
			Math.max(0, this.data.length - this.position),
		);
		this.data.copy(target, offset, this.position, this.position + length);
		this.position += length;
		return length;
	}

	seek(position: number): void {
		this.position = position;
	}
}

function invalidStream(): GarbroError {
	return new GarbroError(
		"INVALID_ARCHIVE",
		"Seraphim image stream runs past its picture",
	);
}

function invalidOpcode(): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim image opcode");
}

/** A byte of the decoded picture, where the reference writes straight through an array. */
function writeByte(target: Buffer, index: number, value: number): void {
	if (index < 0 || index >= target.length) throw invalidStream();
	target[index] = value;
}

function fillBytes(
	target: Buffer,
	offset: number,
	value: number,
	count: number,
): void {
	for (let i = 0; i < count; i += 1) writeByte(target, offset + i, value);
}

/** The copy the whole-format unpackers lean on, with this format's own failure for a range outside it. */
function copyInto(
	data: Buffer,
	source: number,
	destination: number,
	count: number,
): void {
	if (!copyOverlapped(data, source, destination, count)) throw invalidStream();
}

/**
 * The reference's `SeraphReader.UnpackRgb`, which decodes whole pixels for the images that are three or four
 * bytes wide. `stride` is a row of the picture and `total` the whole of it; both are counted in bytes.
 */
function unpackRgb(
	stored: Buffer,
	pixelSize: number,
	stride: number,
	total: number,
): Buffer {
	const output: Buffer = Buffer.alloc(total, 0x00);
	const stream = new SeraphStream(stored);
	let destination = 0;
	while (destination < output.length) {
		const control = stream.readByte();
		if (-1 === control) break;
		if ((control & INVALID_CONTROL_MASK) === INVALID_CONTROL_VALUE)
			throw invalidOpcode();
		let count: number;
		if (0 === (control & 0x80)) {
			if (0 !== (control & 0x40)) {
				count = (control & 0x3f) + 2;
				fillBytes(output, destination, stream.readByte() & 0xff, count);
			} else {
				count = (control & 0x3f) + 1;
				if (count !== stream.read(output, destination, count)) break;
			}
		} else if (0 === (control & 0x40)) {
			count = stream.readByte() | ((control & 0x0f) << 8);
			switch ((control >> 4) & 3) {
				case 0:
					count += 2;
					fillBytes(output, destination, stream.readByte() & 0xff, count);
					break;
				case 1:
					count += 1;
					copyInto(output, destination - stride, destination, count);
					break;
				case 2:
					count += 1;
					copyInto(output, destination - 2 * stride, destination, count);
					break;
				default:
					count += 1;
					copyInto(output, destination - 4 * stride, destination, count);
					break;
			}
		} else if (0 === (control & 0x30)) {
			count = stream.readByte() + ((control & 7) << 8) + 1;
			let run = pixelSize;
			if (0 !== (control & 8)) run *= 2;
			stream.read(output, destination, run);
			copyInto(output, destination, destination + run, count * run);
			count += 1;
			count *= run;
		} else if (0 === (control & 0x20)) {
			const offset = stream.readByte() + ((control & 0x0f) << 8) + 1;
			count = stream.readByte() + 1;
			const source = destination - pixelSize * offset;
			count = Math.min(count * pixelSize, output.length - destination);
			copyInto(output, source, destination, count);
		} else {
			const offset = stream.readByte() + ((control & 0x0f) << 8) + 1;
			count = stream.readByte() + 1;
			copyInto(output, destination - offset, destination, count);
		}
		if (0 === count) throw invalidOpcode();
		destination += count;
	}
	return output;
}

/**
 * The reference's `SeraphReader.UnpackBytes`, which decodes single bytes for the eight bit pictures and for the
 * transparency plane of `CT`. It keeps a row of slack behind the picture, as the reference does, because a run
 * that overruns it writes there rather than failing.
 */
function unpackBytes(
	stored: Buffer,
	width: number,
	height: number,
	position: number,
): Buffer {
	const total = width * height;
	const output: Buffer = Buffer.alloc(total + width, 0x00);
	const stream = new SeraphStream(stored, position);
	let destination = 0;
	while (destination < total) {
		const control = stream.readByte();
		if (-1 === control) break;
		if ((control & INVALID_CONTROL_MASK) === INVALID_CONTROL_VALUE)
			throw invalidOpcode();
		let count: number;
		if (0 === (control & 0x80)) {
			if (0 !== (control & 0x40)) {
				count = (control & 0x3f) + 2;
				fillBytes(output, destination, stream.readByte() & 0xff, count);
			} else {
				count = (control & 0x3f) + 1;
				if (count !== stream.read(output, destination, count)) break;
			}
		} else if (0 === (control & 0x40)) {
			count = stream.readByte() | ((control & 0x0f) << 8);
			switch ((control >> 4) & 3) {
				case 0:
					count += 2;
					fillBytes(output, destination, stream.readByte() & 0xff, count);
					break;
				case 1:
					count += 1;
					copyInto(output, destination - width, destination, count);
					break;
				case 2:
					count += 1;
					copyInto(output, destination - 2 * width, destination, count);
					break;
				default:
					count += 1;
					copyInto(output, destination - 4 * width, destination, count);
					break;
			}
		} else if (0 === (control & 0x20)) {
			count = stream.readByte() + ((control & 7) << 8) + 1;
			// Two, four, eight or sixteen bytes of pattern, which the opcode repeats.
			const run = 2 << ((control >> 3) & 3);
			stream.read(output, destination, run);
			copyInto(output, destination, destination + run, count * run);
			count += 1;
			count *= run;
		} else {
			const offset = stream.readByte() | ((control & 0x0f) << 8);
			count = stream.readByte() + 1;
			copyInto(output, destination - 1 - offset, destination, count);
		}
		destination += count;
	}
	return output;
}

/** The reference's `FlipPixels`: the rows of the stored picture run from the bottom up. */
function flipRows(pixels: Buffer, stride: number, height: number): Buffer {
	const flipped: Buffer = Buffer.alloc(pixels.length, 0x00);
	let destination = 0;
	for (let source = stride * (height - 1); source >= 0; source -= stride) {
		pixels.copy(flipped, destination, source, source + stride);
		destination += stride;
	}
	return flipped;
}

function checkSize(width: number, height: number, bytesPerPixel: number): void {
	const total = width * height * bytesPerPixel;
	if (!Number.isSafeInteger(total) || total > MAX_IMAGE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Seraphim image of ${width}x${height} is too large`,
		);
	}
}

/** The bytes behind the header, which is where every one of the four streams begins. */
async function readStored(source: ByteSource): Promise<Buffer> {
	const length = Number(source.size) - HEADER_SIZE;
	return Buffer.from(await source.readAt(BigInt(HEADER_SIZE), length));
}

/**
 * The header of the three pictures that begin with the letters of `CF` and of the format `CT` and `CX` extend.
 * The reference reads it with the very same code for all of them and only the picture it decodes differs.
 */
async function readPixelsLayout(
	source: ByteSource,
): Promise<SeraphPixelsLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.length < HEADER_SIZE) return undefined;
	if (0x43 !== header[0] || 0x46 !== header[1] || 0 !== header[3])
		return undefined;
	const packedSize = header.readInt32LE(12);
	if (packedSize <= 0) return undefined;
	if (BigInt(packedSize) > source.size - BigInt(HEADER_SIZE)) return undefined;
	const width = header.readUInt16LE(8);
	const height = header.readUInt16LE(10);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: header.readInt16LE(4),
		offsetY: header.readInt16LE(6),
		packedSize,
	};
}

/** The header of the eight bit picture, whose measurements are signed and whose colour count may be nought. */
async function readIndexedLayout(
	source: ByteSource,
): Promise<SeraphIndexedLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.length < HEADER_SIZE) return undefined;
	if (0x43 !== header[0] || 0x42 !== header[1]) return undefined;
	const colors = header.readUInt16LE(2);
	// The reference's own upper bound on the packed length is commented out, so only a nought is refused. Its
	// effect would be a stream that is shorter than the format says, which the decoder itself tolerates.
	const packedSize = header.readInt32LE(12);
	if (packedSize <= 0) return undefined;
	const width = header.readInt16LE(8);
	const height = header.readInt16LE(10);
	if (width <= 0 || height <= 0 || colors > MAX_PALETTE_COLORS)
		return undefined;
	return {
		width,
		height,
		offsetX: header.readInt16LE(4),
		offsetY: header.readInt16LE(6),
		packedSize,
		colors,
	};
}

/** The colour map of an eight bit picture, read from the stream as the reference's constructor reads it. */
function readPalette(
	stored: Buffer,
	colors: number,
): { palette: Buffer; position: number } {
	const count = Math.min(colors, MAX_PALETTE_COLORS);
	const palette: Buffer = Buffer.alloc(MAX_PALETTE_COLORS * 4, 0x00);
	if (0 === count) return { palette, position: 0 };
	const length = count * 3;
	if (length > stored.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Unexpected end of Seraphim image palette",
		);
	}
	for (let i = 0; i < count; i += 1) {
		const source = i * 3;
		const target = i * 4;
		// The reference reads the map as RGB and builds a colour from it, which a bitmap stores as blue, green,
		// red and an unused byte.
		palette[target] = stored[source + 2] ?? 0;
		palette[target + 1] = stored[source + 1] ?? 0;
		palette[target + 2] = stored[source] ?? 0;
	}
	return { palette, position: length };
}

/** The reference's `UnpackCf`: three byte pixels read bottom up, which is a top down bitmap. */
async function renderPixels(
	source: ByteSource,
	layout: SeraphPixelsLayout,
	pixelSize: number,
): Promise<Buffer> {
	checkSize(layout.width, layout.height, pixelSize);
	const stride = layout.width * pixelSize;
	const stored = await readStored(source);
	const pixels = unpackRgb(stored, pixelSize, stride, stride * layout.height);
	const flipped = flipRows(pixels, stride, layout.height);
	return 3 === pixelSize
		? writeBmp24(layout.width, layout.height, flipped, false)
		: writeBmp32(layout.width, layout.height, flipped, false);
}

/** The reference's `UnpackCt`: a colour plane and a transparency plane of single bytes behind it. */
async function renderCt(
	source: ByteSource,
	layout: SeraphPixelsLayout,
): Promise<Buffer> {
	checkSize(layout.width, layout.height, 4);
	const { width, height } = layout;
	const stride = width * 3;
	const stored = await readStored(source);
	const rgb = unpackRgb(stored, 3, stride, stride * height);
	// The reference seeks to the length of the picture plus four bytes before it reads the transparency
	// plane, counted from the end of the sixteen byte header; the stored bytes the port holds begin there.
	const alpha = unpackBytes(stored, width, height, layout.packedSize + 4);
	const pixels: Buffer = Buffer.alloc(width * height * 4, 0x00);
	let destination = 0;
	for (let y = height - 1; y >= 0; y -= 1) {
		let source3 = y * stride;
		let source1 = y * width;
		for (let x = 0; x < width; x += 1) {
			pixels[destination] = rgb[source3] ?? 0;
			pixels[destination + 1] = rgb[source3 + 1] ?? 0;
			pixels[destination + 2] = rgb[source3 + 2] ?? 0;
			const value = Math.min(
				Math.trunc(((alpha[source1] ?? 0) * 0xff) / 0x64),
				0xff,
			);
			pixels[destination + 3] = ~value & 0xff;
			destination += 4;
			source3 += 3;
			source1 += 1;
		}
	}
	return writeBmp32(width, height, pixels, false);
}

/** The reference's `UnpackCb`: single byte pixels behind a colour map, read bottom up. */
async function renderIndexed(
	source: ByteSource,
	layout: SeraphImageLayout,
): Promise<Buffer> {
	checkSize(layout.width, layout.height, 1);
	const { width, height } = layout;
	const stored = await readStored(source);
	const { palette, position } = readPalette(stored, layout.colors ?? 0);
	const pixels = unpackBytes(stored, width, height, position);
	const flipped = flipRows(pixels, width, height);
	return writeBmp8Palette(width, height, flipped, palette, false);
}

function imageEntry(
	source: ByteSource,
	sourcePath: string,
	metadata: Record<string, unknown>,
): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: 0n,
			size: source.size,
			compressed: true,
			metadata,
		}),
		sizeKnown: false,
	};
}

interface SeraphImageLayout extends SeraphPixelsLayout {
	bitsPerPixel: number;
	colors?: number;
}

interface SeraphImageOptions {
	id: string;
	/** The name of the format as it is shown to a user. */
	name: string;
	/** How the picture is called in an error of its own. */
	description: string;
	signatures: Buffer[];
	/** The extension list of the reference, which hands its own down to the classes that extend it. */
	extensions: string[];
	readLayout: (source: ByteSource) => Promise<SeraphImageLayout | undefined>;
	render: (source: ByteSource, layout: SeraphImageLayout) => Promise<Buffer>;
	compression: string;
}

function defineSeraphImage(options: SeraphImageOptions): {
	descriptor: FormatDescriptor;
	format: ArchiveFormat;
} {
	const descriptor: FormatDescriptor = {
		id: options.id,
		name: options.name,
		extensions: options.extensions,
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
				source: "ArcFormats/Seraphim/ImageSeraph.cs",
				license: "MIT",
				commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
			},
		],
	};
	const format: ArchiveFormat = defineFixedArchive({
		descriptor,
		detection: {
			signatures: options.signatures.map((bytes) => ({ bytes })),
			// The reference's signature list ends in a zero, so its second pass offers every remaining file.
			extensionFallback: true,
		},
		async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
			void sourcePath;
			try {
				return (await options.readLayout(source)) !== undefined;
			} catch {
				return false;
			}
		},
		async read(source: ByteSource, sourcePath: string) {
			const layout = await options.readLayout(source);
			if (!layout) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`Invalid ${options.description}`,
				);
			}
			const metadata: Record<string, unknown> = {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			};
			if (undefined !== layout.colors) metadata.colors = layout.colors;
			return {
				entries: [imageEntry(source, sourcePath, metadata)],
				metadata: {
					image: "bmp",
					compression: options.compression,
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			};
		},
		async openEntry(source: ByteSource) {
			const layout = await options.readLayout(source);
			if (!layout) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`Invalid ${options.description}`,
				);
			}
			return Readable.from([await options.render(source, layout)]);
		},
	});
	return { descriptor, format };
}

async function readCfLayout(
	source: ByteSource,
): Promise<SeraphImageLayout | undefined> {
	const layout = await readPixelsLayout(source);
	if (!layout) return undefined;
	return { ...layout, bitsPerPixel: 24 };
}

async function readCtLayout(
	source: ByteSource,
): Promise<SeraphImageLayout | undefined> {
	const layout = await readPixelsLayout(source);
	if (!layout) return undefined;
	return { ...layout, bitsPerPixel: 32 };
}

async function readCbLayout(
	source: ByteSource,
): Promise<SeraphImageLayout | undefined> {
	const layout = await readIndexedLayout(source);
	if (!layout) return undefined;
	return { ...layout, bitsPerPixel: 8, colors: layout.colors };
}

const cfImage = defineSeraphImage({
	id: "seraphim-cf-image",
	name: "Seraphim engine image format",
	description: "Seraphim CF image",
	signatures: CF_SIGNATURE_BYTES,
	extensions: ["cts"],
	readLayout: readCfLayout,
	compression: "seraphim-pixel-rle",
	render: (source: ByteSource, layout: SeraphImageLayout) =>
		renderPixels(source, layout, 3),
});

export const seraphimCfImageDescriptor: FormatDescriptor = cfImage.descriptor;

/** The three byte picture; `CT` and `CX` differ from it only in the picture they decode. */
export const seraphimCfImageFormat: ArchiveFormat = cfImage.format;

const ctImage = defineSeraphImage({
	id: "seraphim-ct-image",
	name: "Seraphim engine image format",
	description: "Seraphim CT image",
	signatures: CF_SIGNATURE_BYTES,
	extensions: ["cts"],
	readLayout: readCtLayout,
	compression: "seraphim-rgb-alpha",
	render: (source: ByteSource, layout: SeraphImageLayout) =>
		renderCt(source, layout),
});

export const seraphimCtImageDescriptor: FormatDescriptor = ctImage.descriptor;

export const seraphimCtImageFormat: ArchiveFormat = ctImage.format;

const cbImage = defineSeraphImage({
	id: "seraphim-cb-image",
	name: "Seraphim engine image format",
	description: "Seraphim CB image",
	signatures: CB_SIGNATURE_BYTES,
	extensions: ["cb", "clb"],
	readLayout: readCbLayout,
	compression: "seraphim-byte-rle",
	render: (source: ByteSource, layout: SeraphImageLayout) =>
		renderIndexed(source, layout),
});

export const seraphimCbImageDescriptor: FormatDescriptor = cbImage.descriptor;

/** The eight bit picture, which is the only one with a colour map. */
export const seraphimCbImageFormat: ArchiveFormat = cbImage.format;

const cxImage = defineSeraphImage({
	id: "seraphim-cx-image",
	name: "Seraphim engine image format",
	description: "Seraphim CX image",
	signatures: CF_SIGNATURE_BYTES,
	extensions: ["cts"],
	readLayout: readCtLayout,
	compression: "seraphim-pixel-rle",
	render: (source: ByteSource, layout: SeraphImageLayout) =>
		renderPixels(source, layout, 4),
});

export const seraphimCxImageDescriptor: FormatDescriptor = cxImage.descriptor;

/** Four byte pixels decoded the way the three byte ones are, and found by the words of `CF` as well. */
export const seraphimCxImageFormat: ArchiveFormat = cxImage.format;
