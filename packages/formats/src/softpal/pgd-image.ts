// Format reference: GARbro "ArcFormats/Softpal/ImagePGD.cs", classes `Pgd11Format`, `Pgd00Format`,
// `PgdTgaFormat`, `PgdGeFormat`, `Pgd3Format` and the `PgdReader` beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { readTgaLayout, renderTgaImage } from "../gameres/tga-image.js";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'GE\x1C'`: the mark of the first kind of picture of the engine. */
const MARK_11C = [0x47, 0x45, 0x1c];
/** `'GE '`: the mark of the kind of picture of the engine of the table of the colours of it. */
const MARK_GE = [0x47, 0x45, 0x20];
/** `'PGD3'` and `'PGD2'`: the marks of the places of the file of a picture of the places of the picture. */
const MARK_PGD3 = [0x50, 0x47, 0x44, 0x33];
const MARK_PGD2 = [0x50, 0x47, 0x44, 0x32];
const HEAD_11C = 0x20;
const HEAD_00C = 0x24;
const HEAD_PGD_TGA = 0x2a;
const HEAD_GE = 0x20;
const HEAD_PGD3 = 0x30;
/** The walk of the places of the file of the picture of the places of the file of the engine. */
const DATA_11C = 0x20;
const DATA_00C = 0x1c;
const DATA_GE = 0x20;
const DATA_PGD3 = 0x30;
/** The places of the file of the walk of the engine of a picture of the places of the picture of it. */
const LOOK_BEHIND_11C = 0xffc;
const LOOK_BEHIND_00C = 3000;
/** The places of the file of the picture of the engine of the letters `00_C` of the head of it. */
const TAG_00C = 0x18;
/** The places of the file of the picture of the engine of the letters `11_C` of the head of it. */
const TAG_11C = 0x1c;
const BITS_24 = 24;
const BITS_32 = 32;
const BYTE = 0xff;
const SEGMENTS = 4;
const CLAMP_HIGH = 255;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidPicture("A picture of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

function startsWith(data: Buffer, mark: readonly number[], at = 0): boolean {
	if (data.length < at + mark.length) return false;
	return mark.every((value, index) => data[at + index] === value);
}

/** `PgdReader`: the walk of the places of the file of a picture of the engine. */
class PgdReader {
	private at: number;
	private readonly unpacked: Buffer;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		if (data.length < at + 8) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		const unpackedSize = data.readInt32LE(at);
		// The places of the file of the picture of the walk of the engine itself stand of no walk of the
		// places of the file of it: the reference reads them and stands of no places of the file of them.
		data.readInt32LE(at + 4);
		if (unpackedSize <= 0 || unpackedSize > data.length * 0x100 + 0x10000) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the picture of it",
			);
		}
		this.unpacked = Buffer.alloc(unpackedSize, 0);
		this.at = at + 8;
	}

	private readByte(): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private readUInt16(): number {
		if (this.at + 2 > this.data.length) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		const value = this.data.readUInt16LE(this.at);
		this.at += 2;
		return value;
	}

	private copy(destination: number, count: number): void {
		if (destination + count > this.unpacked.length) {
			throw invalidPicture(
				"A picture of the engine of the places of the file of the walk of it",
			);
		}
		for (let i = 0; i < count; i += 1) {
			this.unpacked[destination + i] = this.readByte();
		}
	}

	/** `PgdReader.Unpack`: the walk of the engine of the pictures of the two first kinds of it. */
	unpack(lookBehind: number): Buffer {
		let dst = 0;
		let control = 2;
		while (dst < this.unpacked.length) {
			control >>= 1;
			if (1 === control) {
				control = this.readByte() | 0x100;
			}
			if (0 !== (control & 1)) {
				let source = this.readUInt16();
				const count = this.readByte();
				if (dst > lookBehind) source += dst - lookBehind;
				if (source < 0 || count > this.unpacked.length - dst) {
					throw invalidPicture(
						"A picture of the engine of the places of the file of the walk of it",
					);
				}
				copyOverlapped(this.unpacked, source, dst, count);
				dst += count;
			} else {
				const count = this.readByte();
				this.copy(dst, count);
				dst += count;
			}
		}
		return this.unpacked;
	}

	/**
	 * `PgdReader.UnpackGePre`: the walk of the engine of the pictures of the third kind of it and of the
	 * places of the picture of the fourth kind of it.
	 */
	unpackGePre(): Buffer {
		let dst = 0;
		let control = 2;
		while (dst < this.unpacked.length) {
			control >>= 1;
			if (1 === control) {
				control = this.readByte() | 0x100;
			}
			if (0 !== (control & 1)) {
				const offset = this.readUInt16();
				let count = offset & 7;
				if (0 === (offset & 8)) {
					count = (count << 8) | this.readByte();
				}
				count += 4;
				const source = dst - (offset >> 4);
				if (source < 0 || count > this.unpacked.length - dst) {
					throw invalidPicture(
						"A picture of the engine of the places of the file of the walk of it",
					);
				}
				copyOverlapped(this.unpacked, source, dst, count);
				dst += count;
			} else {
				const count = this.readByte();
				this.copy(dst, count);
				dst += count;
			}
		}
		return this.unpacked;
	}
}

/** The places of the file of a picture of the engine, of the kind of the walk of the picture of it. */
export interface Pgd11Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
}

/** The places of the file of a picture of the engine of the places of the picture of it. */
export interface Pgd00Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
}

/** The places of the file of a picture of the engine of the table of the colours of the picture of it. */
export interface PgdGeLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	/** The walk of the places of the picture of the fourth kind of it, of 1 to 3. */
	method: number;
}

/** The places of the file of a picture of the engine of the places of the picture before the walk of it. */
export interface Pgd3Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	/** The name of the picture of the places of the picture before the walk of it. */
	baseName: string;
}

/** The picture of the engine of the walk of the places of the file of it, of the places of the picture. */
export interface PgdPixels {
	format: "bgra32" | "bgr24";
	data: Buffer;
}

/** `Pgd11Format.ReadMetaData`: the head of a picture of the first kind of the engine. */
export function readPgd11Layout(data: Buffer): Pgd11Layout | undefined {
	if (data.length < HEAD_11C) return undefined;
	if (!startsWith(data, MARK_11C)) return undefined;
	if (data.toString("latin1", TAG_11C, TAG_11C + 4) !== "11_C")
		return undefined;
	const width = data.readUInt32LE(0x0c);
	const height = data.readUInt32LE(0x10);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt32LE(4),
		offsetY: data.readInt32LE(8),
		bitsPerPixel: BITS_32,
	};
}

/** `Pgd00Format.ReadMetaData`: the head of a picture of the second kind of the engine. */
export function readPgd00Layout(data: Buffer): Pgd00Layout | undefined {
	if (data.length < HEAD_00C) return undefined;
	if (data.toString("latin1", TAG_00C, TAG_00C + 4) !== "00_C")
		return undefined;
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(12);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt32LE(0),
		offsetY: data.readInt32LE(4),
		bitsPerPixel: BITS_32,
	};
}

/** `PgdTgaFormat.ReadMetaData`: the head of a picture of the third kind of the engine, of a TGA of it. */
export function readPgdTgaLayout(data: Buffer): Pgd00Layout | undefined {
	if (data.length < HEAD_PGD_TGA) return undefined;
	const offsetX = data.readInt32LE(0);
	const offsetY = data.readInt32LE(4);
	if (Math.abs(offsetX) > 0x2000 || Math.abs(offsetY) > 0x2000)
		return undefined;
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(12);
	if (0 === width || 0 === height) return undefined;
	if (width !== data.readUInt16LE(0x24) || height !== data.readUInt16LE(0x26)) {
		return undefined;
	}
	const tga = readTgaLayout(data.subarray(0x18));
	if (!tga) return undefined;
	return {
		width: tga.width,
		height: tga.height,
		offsetX,
		offsetY,
		bitsPerPixel: tga.bitsPerPixel,
	};
}

/**
 * `PgdGeFormat.ReadMetaData`: the head of a picture of the fourth kind of the engine. The reference
 * stands of no walk of the places of the file of the mark of it alone: the mark stands of the picture
 * of the engine of the kind of the file of it.
 */
export function readPgdGeLayout(data: Buffer): PgdGeLayout | undefined {
	if (data.length < HEAD_GE) return undefined;
	if (!startsWith(data, MARK_GE)) return undefined;
	const width = data.readUInt32LE(0x0c);
	const height = data.readUInt32LE(0x10);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt32LE(4),
		offsetY: data.readInt32LE(8),
		bitsPerPixel: BITS_32,
		method: data.readUInt16LE(0x1c),
	};
}

/** `Pgd3Format.ReadMetaData`: the head of a picture of the places of the picture of the engine. */
export function readPgd3Layout(data: Buffer): Pgd3Layout | undefined {
	if (data.length < HEAD_PGD3) return undefined;
	if (!startsWith(data, MARK_PGD3) && !startsWith(data, MARK_PGD2))
		return undefined;
	const name = data.subarray(0x0e, 0x22);
	const end = name.indexOf(0);
	const baseName = name.toString("latin1", 0, end < 0 ? name.length : end);
	if (0 === baseName.length) return undefined;
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(0xa);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: data.readUInt16LE(4),
		offsetY: data.readUInt16LE(6),
		bitsPerPixel: data.readUInt16LE(0x0c),
		baseName,
	};
}

/**
 * `Pgd11Format.Read`: the places of the file of the picture of the first kind of the engine, of the
 * four places of the file of a colour to a place of the picture of it.
 */
export function unpackPgd11Pixels(data: Buffer): Buffer {
	const reader = new PgdReader(data, DATA_11C);
	const planes = reader.unpack(LOOK_BEHIND_11C);
	const count = planes.length / SEGMENTS;
	const pixels = Buffer.alloc(planes.length, 0);
	let blue = 0;
	let green = count;
	let red = 2 * count;
	let alpha = 3 * count;
	let at = 0;
	while (at < pixels.length) {
		pixels[at] = planes[blue] ?? 0;
		pixels[at + 1] = planes[green] ?? 0;
		pixels[at + 2] = planes[red] ?? 0;
		pixels[at + 3] = planes[alpha] ?? 0;
		at += SEGMENTS;
		blue += 1;
		green += 1;
		red += 1;
		alpha += 1;
	}
	return pixels;
}

/** `Pgd00Format.Read`: the picture of the second kind of the engine, of a TGA of the walk of it. */
export function unpackPgd00Picture(data: Buffer): Buffer {
	const reader = new PgdReader(data, DATA_00C);
	return renderTgaImage(reader.unpack(LOOK_BEHIND_00C));
}

/** `PgdTgaFormat.Read`: the picture of the third kind of the engine, of the TGA behind the head of it. */
export function unpackPgdTgaPicture(data: Buffer): Buffer {
	return renderTgaImage(data.subarray(0x18));
}

/** `PgdReader.PostProcess1`: the places of the file of the picture of the first walk of the engine. */
function postProcess1(input: Buffer): PgdPixels {
	const count = input.length / SEGMENTS;
	const pixels = Buffer.alloc(input.length, 0);
	const alpha = 0;
	const red = count;
	const green = 2 * count;
	const blue = 3 * count;
	let at = 0;
	for (let i = 0; i < count; i += 1) {
		pixels[at] = input[blue + i] ?? 0;
		pixels[at + 1] = input[green + i] ?? 0;
		pixels[at + 2] = input[red + i] ?? 0;
		pixels[at + 3] = input[alpha + i] ?? 0;
		at += SEGMENTS;
	}
	return { format: "bgra32", data: pixels };
}

function clamp(value: number): number {
	if (value > CLAMP_HIGH) return CLAMP_HIGH;
	if (value < 0) return 0;
	return value;
}

/** `PgdReader.PostProcess2`: the places of the file of the picture of the second walk of the engine. */
function postProcess2(input: Buffer, width: number, height: number): PgdPixels {
	const stride = width * 3;
	const segment = Math.trunc((width * height) / SEGMENTS);
	let first = 0;
	let second = segment;
	let third = 2 * segment;
	const pixels = Buffer.alloc(stride * height, 0);
	let dst = 0;
	const points = [0, 1, width, width + 1];
	for (let y = Math.trunc(height / 2); y > 0; y -= 1) {
		for (let x = Math.trunc(width / 2); x > 0; x -= 1) {
			const i0 = ((input[first] ?? 0) << 24) >> 24;
			const i1 = ((input[second] ?? 0) << 24) >> 24;
			first += 1;
			second += 1;
			const blue = 226 * i0;
			const green = -43 * i0 - 89 * i1;
			const red = 179 * i1;
			for (const offset of points) {
				const base = (input[third + offset] ?? 0) << 7;
				const at = dst + 3 * offset;
				pixels[at] = clamp((base + blue) >> 7);
				pixels[at + 1] = clamp((base + green) >> 7);
				pixels[at + 2] = clamp((base + red) >> 7);
			}
			third += 2;
			dst += 6;
		}
		third += width;
		dst += stride;
	}
	return { format: "bgr24", data: pixels };
}

/** `PgdReader.PostProcess3`: the places of the file of the picture of the third walk of the engine. */
function postProcess3(input: Buffer): {
	pixels: PgdPixels;
	width: number;
	height: number;
} {
	if (input.length < 8) {
		throw invalidPicture(
			"A picture of the engine of no places of the file of the head of it",
		);
	}
	const bpp = input.readUInt16LE(2);
	if (BITS_32 !== bpp && BITS_24 !== bpp) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"A picture of the engine of no places of the file of a colour of the picture of it",
		);
	}
	const width = input.readUInt16LE(4);
	const height = input.readUInt16LE(6);
	return {
		pixels: postProcessPal(input, 8, bpp / 8, width, height),
		width,
		height,
	};
}

/** `PgdReader.PostProcessPal`: the places of the file of a picture of the engine of the rows of it. */
export function postProcessPal(
	input: Buffer,
	from: number,
	placeSize: number,
	width: number,
	height: number,
): PgdPixels {
	const stride = width * placeSize;
	const pixels = Buffer.alloc(height * stride, 0);
	let control = from;
	let src = from + height;
	let dst = 0;
	for (let row = 0; row < height; row += 1) {
		const kind = input[control] ?? 0;
		control += 1;
		if (0 !== (kind & 1)) {
			let previous = dst;
			for (let i = 0; i < placeSize; i += 1) {
				pixels[dst] = input[src] ?? 0;
				dst += 1;
				src += 1;
			}
			let left = stride - placeSize;
			while (left > 0) {
				pixels[dst] = ((pixels[previous] ?? 0) - (input[src] ?? 0)) & BYTE;
				dst += 1;
				previous += 1;
				src += 1;
				left -= 1;
			}
		} else if (0 !== (kind & 2)) {
			let above = dst - stride;
			let left = stride;
			while (left > 0) {
				pixels[dst] = ((pixels[above] ?? 0) - (input[src] ?? 0)) & BYTE;
				dst += 1;
				above += 1;
				src += 1;
				left -= 1;
			}
		} else {
			for (let i = 0; i < placeSize; i += 1) {
				pixels[dst] = input[src] ?? 0;
				dst += 1;
				src += 1;
			}
			let above = dst - stride;
			let left = stride - placeSize;
			while (left > 0) {
				const mean =
					((pixels[above] ?? 0) + (pixels[dst - placeSize] ?? 0)) >> 1;
				pixels[dst] = (mean - (input[src] ?? 0)) & BYTE;
				dst += 1;
				above += 1;
				src += 1;
				left -= 1;
			}
		}
	}
	return { format: 4 === placeSize ? "bgra32" : "bgr24", data: pixels };
}

/**
 * `PgdGeFormat.Read`: the places of the file of the picture of the fourth kind of the engine, of a walk
 * of the three of it.
 */
export function unpackPgdGePixels(
	data: Buffer,
	layout: PgdGeLayout,
): PgdPixels {
	const reader = new PgdReader(data, DATA_GE);
	const unpacked = reader.unpackGePre();
	if (1 === layout.method) return postProcess1(unpacked);
	if (2 === layout.method)
		return postProcess2(unpacked, layout.width, layout.height);
	if (3 === layout.method) return postProcess3(unpacked).pixels;
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		"A picture of the engine of no places of the file of the walk of it",
	);
}

/** The picture of the engine, handed over as the places of the file of a BMP of it. */
export function pgdPixelsToBmp(
	width: number,
	height: number,
	pixels: PgdPixels,
): Buffer {
	return "bgra32" === pixels.format
		? writeBmp32(width, height, pixels.data, false)
		: writeBmp24(width, height, pixels.data, false);
}

/** `Pgd3Format.Read`'s reader: the places of the file of the picture of the walk of the picture of it. */
export function unpackPgd3Pixels(data: Buffer, layout: Pgd3Layout): PgdPixels {
	const reader = new PgdReader(data, DATA_PGD3);
	const unpacked = reader.unpackGePre();
	return postProcessPal(
		unpacked,
		0,
		layout.bitsPerPixel / 8,
		layout.width,
		layout.height,
	);
}

/**
 * `Pgd3Format.Read`: the places of the file of the picture of the engine, of the places of the picture
 * before the walk of it of the places of the picture of the file of it.
 */
export function composePgd3(
	base: PgdPixels,
	baseWidth: number,
	overlay: PgdPixels,
	layout: Pgd3Layout,
): PgdPixels {
	const overlayBpp = layout.bitsPerPixel / 8;
	const placeSize = "bgra32" === base.format ? 4 : 3;
	if (
		layout.offsetX + layout.width > baseWidth ||
		overlayBpp * layout.width * layout.height > overlay.data.length
	) {
		throw invalidPicture(
			"A picture of the engine of the places of the file of the picture of it",
		);
	}
	const image = Buffer.from(base.data);
	const applyAlpha = 4 === overlayBpp && 4 === placeSize;
	let dst = (layout.offsetY * baseWidth + layout.offsetX) * placeSize;
	const gap = (baseWidth - layout.width) * placeSize;
	let src = 0;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			image[dst] = (image[dst] ?? 0) ^ (overlay.data[src] ?? 0);
			image[dst + 1] = (image[dst + 1] ?? 0) ^ (overlay.data[src + 1] ?? 0);
			image[dst + 2] = (image[dst + 2] ?? 0) ^ (overlay.data[src + 2] ?? 0);
			if (applyAlpha) {
				image[dst + 3] = (image[dst + 3] ?? 0) ^ (overlay.data[src + 3] ?? 0);
			}
			dst += placeSize;
			src += overlayBpp;
		}
		dst += gap;
	}
	return { format: base.format, data: image };
}

/** The picture before the walk of a picture of the engine, of the places of the file of the file of it. */
export async function readPgd3Baseline(
	baseName: string,
	sourcePath: string,
): Promise<Buffer> {
	if (
		baseName.startsWith("/") ||
		baseName.startsWith("\\") ||
		/^[A-Za-z]:/.test(baseName) ||
		baseName.split(/[/\\]/).includes("..")
	) {
		throw new GarbroError(
			"UNSAFE_PATH",
			"A picture of the engine of the places of the file of the picture outside the file of it",
		);
	}
	const file = join(dirname(sourcePath), baseName);
	try {
		return await readFile(file);
	} catch {
		throw new GarbroError(
			"IO_ERROR",
			`A picture of the engine of no places of the file of the picture of it: ${file}`,
		);
	}
}

function entryOf(
	sourcePath: string,
	size: bigint,
	width: number,
	height: number,
	bitsPerPixel: number,
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
			offset: 0n,
			size,
			compressed: true,
			metadata: { type: "image", width, height, bitsPerPixel },
		}),
		sizeKnown: false,
	};
}

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Softpal/ImagePGD.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
];

function descriptorOf(id: string, name: string): FormatDescriptor {
	return {
		id,
		name,
		extensions: ["pgd"],
		capabilities: {
			detect: true,
			list: true,
			extract: true,
			create: false,
			encryption: false,
		},
		attribution: ATTRIBUTION,
	};
}

export const pgd11ImageDescriptor = descriptorOf(
	"softpal-pgd11-image",
	"Amuse Craft 11_C picture",
);

export const pgd00ImageDescriptor = descriptorOf(
	"softpal-pgd00-image",
	"Amuse Craft 00_C picture",
);

export const pgdTgaImageDescriptor = descriptorOf(
	"softpal-pgd-tga-image",
	"Amuse Craft TGA picture",
);

export const pgdGeImageDescriptor = descriptorOf(
	"softpal-pgd-ge-image",
	"Amuse Craft GE picture",
);

export const pgd3ImageDescriptor = descriptorOf(
	"softpal-pgd3-image",
	"Amuse Craft incremental picture",
);

export const pgd11ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgd11ImageDescriptor,
	detection: {
		signatures: [{ bytes: new Uint8Array(MARK_11C) }],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_11C)) return false;
		try {
			return readPgd11Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgd11Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		return {
			entries: [
				entryOf(
					sourcePath,
					source.size,
					layout.width,
					layout.height,
					layout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		return Readable.from([unpackPgd11PixelsBmp(data)]);
	},
});

/** The picture of the first kind of the engine, handed over as the places of the file of a BMP of it. */
function unpackPgd11PixelsBmp(data: Buffer): Buffer {
	const layout = readPgd11Layout(data);
	if (!layout) throw invalidPicture("Not a picture of the engine");
	return writeBmp32(
		layout.width,
		layout.height,
		unpackPgd11Pixels(data),
		false,
	);
}

export const pgd00ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgd00ImageDescriptor,
	detection: {
		signatures: [],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_00C)) return false;
		try {
			return readPgd00Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgd00Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		return {
			entries: [
				entryOf(
					sourcePath,
					source.size,
					layout.width,
					layout.height,
					layout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		return Readable.from([unpackPgd00Picture(await readStored(source))]);
	},
});

export const pgdTgaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgdTgaImageDescriptor,
	detection: {
		signatures: [],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_PGD_TGA)) return false;
		try {
			return readPgdTgaLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgdTgaLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		return {
			entries: [
				entryOf(
					sourcePath,
					source.size,
					layout.width,
					layout.height,
					layout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		return Readable.from([unpackPgdTgaPicture(await readStored(source))]);
	},
});

export const pgdGeImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgdGeImageDescriptor,
	detection: {
		signatures: [{ bytes: new Uint8Array(MARK_GE) }],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_GE)) return false;
		try {
			return readPgdGeLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgdGeLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		return {
			entries: [
				entryOf(
					sourcePath,
					source.size,
					layout.width,
					layout.height,
					layout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPgdGeLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		const pixels = unpackPgdGePixels(data, layout);
		return Readable.from([pgdPixelsToBmp(layout.width, layout.height, pixels)]);
	},
});

export const pgd3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgd3ImageDescriptor,
	detection: {
		signatures: [
			{ bytes: new Uint8Array(MARK_PGD3) },
			{ bytes: new Uint8Array(MARK_PGD2) },
		],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_PGD3)) return false;
		try {
			return readPgd3Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgd3Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		const base = await readPgd3Baseline(layout.baseName, sourcePath);
		const baseLayout = readPgdGeLayout(base);
		if (!baseLayout) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the picture of it",
			);
		}
		return {
			entries: [
				entryOf(
					sourcePath,
					source.size,
					baseLayout.width,
					baseLayout.height,
					baseLayout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: baseLayout.width,
				height: baseLayout.height,
				bitsPerPixel: baseLayout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPgd3Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		const base = await readPgd3Baseline(layout.baseName, sourcePath);
		const baseLayout = readPgdGeLayout(base);
		if (!baseLayout) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the picture of it",
			);
		}
		const composite = composePgd3(
			unpackPgdGePixels(base, baseLayout),
			baseLayout.width,
			unpackPgd3Pixels(data, layout),
			layout,
		);
		return Readable.from([
			pgdPixelsToBmp(baseLayout.width, baseLayout.height, composite),
		]);
	},
});
