// Format reference: GARBro "ArcFormats/Eushully/ImageGP.cs", class `GpFormat` with the `GpReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head: two places of the picture, two of the way its elements stand, then its depth and its places. */
const HEAD_SIZE = 0xd;
const ALPHA_FIELD = 0;
const METHOD_FIELD = 1;
const ELEMENT_SIZE_FIELD = 2;
const ELEMENTS_PER_SLICE_FIELD = 3;
const BITS_FIELD = 4;
const PALETTE_SIZE_FIELD = 5;
const WIDTH_FIELD = 9;
const HEIGHT_FIELD = 0xb;
const PLACE_SIZE = 3;
const MAX_ELEMENT_SIZE = 4;
const BITS_24 = 24;
const BITS_32 = 32;
const INDEXED_PALETTE_SIZE = 0x100;
const LIMIT = 256 * 1024 * 1024;
/** The ways a picture of this engine is drawn. */
const METHOD_PLAIN = 0;
const METHOD_PALETTE = 1;
/** The highest place of a slice names the colour behind the places of it. */
const SLICE_BEHIND = 0x8000;
const ALPHA_MASK = 0x7f;
const ALPHA_PLACE = 3;
const PIXEL_SIZE = 4;

export interface GpLayout {
	width: number;
	height: number;
	method: number;
	bitsPerPixel: number;
	elementSize: number;
	elementsPerSlice: number;
	paletteSize: number;
	hasAlpha: boolean;
}

export interface GpPicture {
	kind: "indexed8" | "bgr32" | "bgra32";
	pixels: Buffer;
	palette?: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GpFormat.ReadMetaData`: the picture writes no word of its own. Its head names whether it carries an alpha
 * channel, the way it is drawn, the places its elements stand in and how many of them a slice holds, its depth
 * and the length of its colour map, and then the places of the picture itself.
 */
export function readGpLayout(data: Buffer): GpLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const alpha = data[ALPHA_FIELD] ?? 0;
	const method = data[METHOD_FIELD] ?? 0;
	const elementSize = data[ELEMENT_SIZE_FIELD] ?? 0;
	const elementsPerSlice = data[ELEMENTS_PER_SLICE_FIELD] ?? 0;
	const bits = data[BITS_FIELD] ?? 0;
	if (alpha > 1 || method > 2) return undefined;
	if (elementSize > MAX_ELEMENT_SIZE || elementsPerSlice > MAX_ELEMENT_SIZE) {
		return undefined;
	}
	if (bits > 16 && BITS_24 !== bits && BITS_32 !== bits) return undefined;
	const paletteSize = data.readInt32LE(PALETTE_SIZE_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (paletteSize <= 0 || 0 === width || 0 === height) return undefined;
	if (paletteSize >= data.length) return undefined;
	if (bits > 0 && bits <= 8 && paletteSize > INDEXED_PALETTE_SIZE)
		return undefined;
	if (width * height > LIMIT) return undefined;
	return {
		width,
		height,
		method,
		bitsPerPixel: 0 === bits ? BITS_24 : bits,
		elementSize,
		elementsPerSlice,
		paletteSize,
		hasAlpha: 0 !== alpha,
	};
}

/** The colour map of a picture, as the reference's own viewer holds it: red, green and blue to a colour. */
function paletteOfRgb(data: Buffer, offset: number, colors: number): Buffer {
	const palette = Buffer.alloc(colors * PIXEL_SIZE, 0x00);
	for (let at = 0; at < colors; at += 1) {
		const r = data[offset + at * PLACE_SIZE] ?? 0;
		const g = data[offset + at * PLACE_SIZE + 1] ?? 0;
		const b = data[offset + at * PLACE_SIZE + 2] ?? 0;
		palette[at * PIXEL_SIZE] = b;
		palette[at * PIXEL_SIZE + 1] = g;
		palette[at * PIXEL_SIZE + 2] = r;
	}
	return palette;
}

/** The places of a picture the way they are drawn into four bytes: two of the colour map and one of nothing. */
function placeOf(
	palette: Buffer,
	color: number,
	pixels: Buffer,
	dst: number,
): void {
	const at = PLACE_SIZE * color;
	// The places of a colour map the reference reaches into stand the other way round from the ones its own
	// viewer holds: the third place of a colour comes first.
	pixels[dst] = palette[at + 2] ?? 0;
	pixels[dst + 1] = palette[at + 1] ?? 0;
	pixels[dst + 2] = palette[at] ?? 0;
	pixels[dst + 3] = 0x00;
}

/** `GpReader.ReadIndexedImage`: elements of a slice, every one of them holding as many places as it names. */
function readIndexedPicture(
	data: Buffer,
	offset: number,
	layout: GpLayout,
	palette: Buffer,
): { pixels: Buffer; end: number } {
	if (0 === layout.elementSize || 0 === layout.elementsPerSlice) {
		throw invalidPicture("The picture names no places of its own");
	}
	const mask = (1 << layout.bitsPerPixel) - 1;
	const pixels = Buffer.alloc(layout.width * layout.height * PIXEL_SIZE, 0x00);
	let at = offset;
	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		let x = 0;
		while (x < layout.width) {
			let color = 0;
			for (let part = 0; part < layout.elementSize; part += 1) {
				if (at >= data.length) {
					throw invalidPicture("The picture ends inside one of its own slices");
				}
				color = (color | ((data[at] ?? 0) << (part * 8))) >>> 0;
				at += 1;
			}
			for (
				let slice = 0;
				slice < layout.elementsPerSlice && x < layout.width;
				slice += 1
			) {
				const color_at = PLACE_SIZE * (color & mask);
				if (color_at + PLACE_SIZE > palette.length) {
					throw invalidPicture(
						"A place of the picture stands outside its colour map",
					);
				}
				color = color >>> layout.bitsPerPixel;
				placeOf(palette, color_at / PLACE_SIZE, pixels, dst);
				dst += PIXEL_SIZE;
				x += 1;
			}
		}
	}
	return { pixels, end: at };
}

/** `GpReader.UnpackV0`: the places of the picture stand as they are, three bytes to a place. */
function readPlainPicture(
	data: Buffer,
	offset: number,
	layout: GpLayout,
): { pixels: Buffer; end: number } {
	const length = layout.width * layout.height * PLACE_SIZE;
	const pixels = Buffer.alloc(layout.width * layout.height * PIXEL_SIZE, 0x00);
	let at = offset;
	let dst = 0;
	for (let source = 0; source < length; source += PLACE_SIZE) {
		if (at + PLACE_SIZE > data.length) {
			throw invalidPicture("The picture ends inside one of its own places");
		}
		const r = data[at] ?? 0;
		const g = data[at + 1] ?? 0;
		const b = data[at + 2] ?? 0;
		at += PLACE_SIZE;
		pixels[dst] = b;
		pixels[dst + 1] = g;
		pixels[dst + 2] = r;
		pixels[dst + 3] = 0x00;
		dst += PIXEL_SIZE;
	}
	return { pixels, end: at };
}

/** `GpReader.UnpackV2`: a slice names how many places stand behind it and how many are drawn in front. */
function readSlicePicture(
	data: Buffer,
	offset: number,
	layout: GpLayout,
): { pixels: Buffer; end: number } {
	if (0 === layout.elementSize || 0 === layout.elementsPerSlice) {
		throw invalidPicture("The picture names no places of its own");
	}
	const mask = (1 << layout.bitsPerPixel) - 1;
	const palette = Buffer.from(
		data.subarray(offset, offset + PLACE_SIZE * layout.paletteSize),
	);
	let at = offset + PLACE_SIZE * layout.paletteSize;
	const behind = data.readInt32LE(at) * PLACE_SIZE;
	at += 4;
	let front = data.readInt32LE(at);
	at += 4;
	if (front < 0) front += layout.paletteSize;
	front *= PLACE_SIZE;
	at += 4; // the length of the slices themselves, which the walk does not look at
	const pixels = Buffer.alloc(layout.width * layout.height * PIXEL_SIZE, 0x00);
	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		let x = 0;
		while (x < layout.width) {
			if (at + 4 > data.length) {
				throw invalidPicture("The picture ends inside one of its own slices");
			}
			let background = data.readUInt16LE(at);
			const foreground = data.readUInt16LE(at + 2);
			at += 4;
			// A slice names the colour that stands behind its places, of which there are two: the one the head
			// names, and the one a picture that carries an alpha channel names beside it.
			let color = behind;
			if (0 !== (background & SLICE_BEHIND)) {
				color = front;
				background &= ALPHA_MASK;
			}
			for (let drawn = 0; drawn < background && x < layout.width; drawn += 1) {
				placeOf(palette, color / PLACE_SIZE, pixels, dst);
				dst += PIXEL_SIZE;
				x += 1;
			}
			let drawn = 0;
			while (drawn < foreground && x < layout.width) {
				let element = 0;
				for (let part = 0; part < layout.elementSize; part += 1) {
					if (at >= data.length) {
						throw invalidPicture(
							"The picture ends inside one of its own slices",
						);
					}
					element = (element | ((data[at] ?? 0) << (part * 8))) >>> 0;
					at += 1;
				}
				for (
					let slice = 0;
					slice !== layout.elementsPerSlice &&
					x < layout.width &&
					drawn < foreground;
					slice += 1
				) {
					color = PLACE_SIZE * (element & mask);
					element = element >>> layout.bitsPerPixel;
					placeOf(palette, color / PLACE_SIZE, pixels, dst);
					dst += PIXEL_SIZE;
					x += 1;
					drawn += 1;
				}
			}
		}
	}
	return { pixels, end: at };
}

/**
 * `GpReader.Unpack`: the way the head names draws the picture, and a picture that carries an alpha channel has
 * it read out of a run of its own: the places of the picture named a length and a count of them at a time.
 */
export function unpackGpPicture(data: Buffer, layout: GpLayout): GpPicture {
	const at = HEAD_SIZE;
	const drawn =
		METHOD_PLAIN === layout.method
			? readPlainPicture(data, at, layout)
			: METHOD_PALETTE === layout.method
				? readPalettePicture(data, at, layout)
				: readSlicePicture(data, at, layout);
	// A picture of eight places to a byte and no alpha channel of its own stands as it is, the colour map of
	// the file beside it; every other way of drawing one stands four bytes to a place.
	if (
		METHOD_PALETTE === layout.method &&
		BITS_8 === layout.bitsPerPixel &&
		!layout.hasAlpha
	) {
		return { kind: "indexed8", pixels: drawn.pixels };
	}
	if (!layout.hasAlpha) {
		return { kind: "bgr32", pixels: drawn.pixels };
	}
	const alpha = readGpAlpha(data, drawn.end, layout, drawn.pixels);
	if (!alpha) return { kind: "bgr32", pixels: drawn.pixels };
	return { kind: "bgra32", pixels: drawn.pixels };
}

/** `GpReader.UnpackV1`: the colour map of the picture, then its places either as they are or by elements. */
function readPalettePicture(
	data: Buffer,
	offset: number,
	layout: GpLayout,
): { pixels: Buffer; end: number } {
	const palette = Buffer.from(
		data.subarray(offset, offset + PLACE_SIZE * layout.paletteSize),
	);
	const at = offset + PLACE_SIZE * layout.paletteSize;
	if (BITS_8 === layout.bitsPerPixel && !layout.hasAlpha) {
		const length = layout.width * layout.height;
		if (at + length > data.length) {
			throw invalidPicture("The picture ends inside one of its own places");
		}
		return {
			pixels: Buffer.from(data.subarray(at, at + length)),
			end: at + length,
		};
	}
	return readIndexedPicture(data, at, layout, palette);
}

const BITS_8 = 8;

/** `GpReader.ReadAlpha`: the alpha channel of a picture, a length and a count of its places at a time. */
function readGpAlpha(
	data: Buffer,
	offset: number,
	layout: GpLayout,
	pixels: Buffer,
): boolean {
	let at = offset;
	if (at + 8 > data.length) return false;
	const width = data.readInt32LE(at);
	const height = data.readInt32LE(at + 4);
	at += 8;
	if (width !== layout.width || height !== layout.height) return false;
	let place = ALPHA_PLACE;
	while (place < pixels.length) {
		if (at + 2 > data.length) return false;
		const alpha = data[at] ?? 0;
		const count = data[at + 1] ?? 0;
		at += 2;
		for (let drawn = 0; drawn < count && place < pixels.length; drawn += 1) {
			pixels[place] = alpha;
			place += PIXEL_SIZE;
		}
	}
	return true;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gpImageDescriptor: FormatDescriptor = {
	id: "eushully-gp-image",
	name: "Old Eushully graphic",
	extensions: ["gpcf"],
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
			source: "ArcFormats/Eushully/ImageGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gpImageDescriptor,
	// The pictures of this engine write no word of their own and carry no extension of their own either, so
	// they are told by the shape of their head alone.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readGpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readGpLayout(data);
		if (!layout)
			throw invalidPicture("Not a picture of the old Eushully engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				method: layout.method,
				hasAlpha: layout.hasAlpha,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGpLayout(data);
		if (!layout)
			throw invalidPicture("Not a picture of the old Eushully engine");
		const drawn = unpackGpPicture(data, layout);
		if ("indexed8" === drawn.kind) {
			// The colour map of the picture, as the reference's own viewer holds it.
			// A bitmap keeps a colour map of every one of its places, of which the file names only some.
			const palette = paletteOfRgb(data, HEAD_SIZE, INDEXED_PALETTE_SIZE);
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					drawn.pixels,
					palette,
					false,
				),
			]);
		}
		// The places of a picture of this engine stand four bytes to a place: two of the colour map and one
		// of nothing, or the alpha channel of a picture that carries one.
		return Readable.from([
			writeBmp32(layout.width, layout.height, drawn.pixels),
		]);
	},
});
