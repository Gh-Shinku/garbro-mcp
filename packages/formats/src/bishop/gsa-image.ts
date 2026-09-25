// Format reference: GARBro "ArcFormats/Bishop/ImageGSA.cs", class `GsaFormat` with the `GsaReader` beside it.
// The bits of the picture are read by GARbro's own "ArcFormats/BitStream.cs", an `LsbBitStream`: the lowest bit
// of a byte comes first and the bytes stand one behind the other. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The picture writes a word of its own, and its head stands far behind it. */
const MARK = Buffer.from([0x8c, 0x8e, 0x42, 0x4d]);
const TYPE_FIELD = 0xc0;
const WIDTH_FIELD = 0xc4;
const HEIGHT_FIELD = 0xc8;
const OFFSET_X_FIELD = 0xcc;
const OFFSET_Y_FIELD = 0xd0;
const HEAD_SIZE = 0xd8;
/** The deepest place of the picture is read as six or five bits, which are spread over the whole of a byte. */
const DEEPEST_TYPE = 0x80;
/** Two of the ways a picture of this engine is drawn stand of its own. */
const TYPE_PLAIN = 3;
const TYPE_PLAIN_DEEP = 0x83;
const BITS_PER_PLACE = 8;
const DEEP_SHIFT_FIRST = 3;
const DEEP_SHIFT_REST = 2;
const BLOCK = 2;
const WAY_SIZE = 3;
const PIXEL_SIZE_PLAIN = 3;
const PIXEL_SIZE_DEEP = 4;
const ALPHA_PLACE = 3;
const PLACE_ALIGN = 3;
const FULL_ALPHA = 0xff;
const LIMIT = 256 * 1024 * 1024;
/** The pictures of a base picture of this engine name the parts of it, which stand beside it. */
const PART_NAME = /\.g[01s]\d$/i;

export interface GsaLayout {
	type: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

export interface GsaPicture {
	pixels: Buffer;
	stride: number;
	pixelSize: number;
	format: "bgr24" | "bgra32";
}

export interface GsaPart {
	path: string;
	overlay: GsaPicture;
	layout: GsaLayout;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GsaFormat.ReadMetaData`: the picture writes its own word, then its head stands far behind it. */
export function readGsaLayout(data: Buffer): GsaLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const type = data.readInt32LE(TYPE_FIELD);
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return {
		type,
		width,
		height,
		offsetX: data.readInt32LE(OFFSET_X_FIELD),
		offsetY: data.readInt32LE(OFFSET_Y_FIELD),
	};
}

/** The bits of a picture, of which the lowest stands first and the bytes one behind the other. */
class GsaBits {
	private readonly data: Buffer;
	private position = HEAD_SIZE;
	private byte = 0;
	private left = 0;

	constructor(data: Buffer) {
		this.data = data;
	}

	private nextBit(): number {
		if (0 === this.left) {
			if (this.position >= this.data.length) {
				throw invalidPicture("The picture ends inside the bits of its own");
			}
			this.byte = this.data[this.position] ?? 0;
			this.position += 1;
			this.left = BITS_PER_PLACE;
		}
		const bit = this.byte & 1;
		this.byte >>= 1;
		this.left -= 1;
		return bit;
	}

	bits(count: number): number {
		let value = 0;
		for (let at = 0; at < count; at += 1) value |= this.nextBit() << at;
		return value;
	}
}

/**
 * `GsaReader.Unpack`: a picture of this engine is drawn as blocks of two places by two, every plane of it one
 * behind the other, and of every block the bits name one of eight ways: the block beside it, a run of its own
 * added to that block, a run of its own added to the block two rows above, or the places themselves.
 */
export function unpackGsaPicture(data: Buffer, layout: GsaLayout): GsaPicture {
	const plain = TYPE_PLAIN === layout.type || TYPE_PLAIN_DEEP === layout.type;
	const pixelSize = plain ? PIXEL_SIZE_PLAIN : PIXEL_SIZE_DEEP;
	const stride = plain
		? (layout.width * PIXEL_SIZE_PLAIN + PLACE_ALIGN) & ~PLACE_ALIGN
		: layout.width * PIXEL_SIZE_DEEP;
	const reserved = (layout.height + 1) & ~1;
	if (stride * reserved > LIMIT) {
		throw invalidPicture(
			"The picture of this engine stands larger than this project draws",
		);
	}
	const pixels = Buffer.alloc(stride * reserved, 0x00);
	const bits = new GsaBits(data);

	const at = (row: number, column: number): number => {
		const place = row * stride + column * pixelSize;
		if (place < 0 || place + pixelSize > pixels.length) {
			throw invalidPicture("A block of the picture stands outside it");
		}
		return place;
	};
	const copy = (dst: number, source: number): void => {
		if (source < 0) {
			throw invalidPicture(
				"A block of the picture stands before the picture itself",
			);
		}
		for (let place = 0; place < BLOCK; place += 1) {
			for (let row = 0; row < BLOCK; row += 1) {
				const from = source + place * pixelSize + row * stride;
				const to = dst + place * pixelSize + row * stride;
				pixels.copy(pixels, to, from, from + pixelSize);
			}
		}
	};
	const add = (dst: number, source: number, values: number[]): void => {
		for (let place = 0; place < BLOCK; place += 1) {
			for (let row = 0; row < BLOCK; row += 1) {
				const to = dst + place * pixelSize + row * stride;
				const from = source + place * pixelSize + row * stride;
				pixels[to] =
					((values[place + row * BLOCK] ?? 0) + (pixels[from] ?? 0)) & 0xff;
			}
		}
	};
	const put = (dst: number, values: number[]): void => {
		for (let place = 0; place < BLOCK; place += 1) {
			for (let row = 0; row < BLOCK; row += 1) {
				pixels[dst + place * pixelSize + row * stride] =
					values[place + row * BLOCK] ?? 0;
			}
		}
	};
	const plane = (byte: number): void => {
		for (let row = 0; row < layout.height; row += BLOCK) {
			for (let column = 0; column < layout.width; column += BLOCK) {
				const dst = at(row, column) + byte;
				const way = bits.bits(WAY_SIZE);
				switch (way) {
					case 0:
						copy(dst, at(row, column - BLOCK) + byte);
						break;
					case 1:
						add(dst, at(row, column - BLOCK) + byte, [
							bits.bits(1),
							bits.bits(1),
							bits.bits(1),
							bits.bits(1),
						]);
						break;
					case 2:
						add(dst, at(row, column - BLOCK) + byte, [
							0xff + bits.bits(2),
							0xff + bits.bits(2),
							0xff + bits.bits(2),
							0xff + bits.bits(2),
						]);
						break;
					case 3:
						add(dst, at(row, column - BLOCK) + byte, [
							0xfd + bits.bits(3),
							0xfd + bits.bits(3),
							0xfd + bits.bits(3),
							0xfd + bits.bits(3),
						]);
						break;
					case 4:
						add(dst, at(row - BLOCK, column) + byte, [
							0xf9 + bits.bits(4),
							0xf9 + bits.bits(4),
							0xf9 + bits.bits(4),
							0xf9 + bits.bits(4),
						]);
						break;
					default:
						// The ways of six, of seven and of eight bits stand for the places themselves.
						put(dst, [
							bits.bits(way + 1),
							bits.bits(way + 1),
							bits.bits(way + 1),
							bits.bits(way + 1),
						]);
						break;
				}
			}
		}
	};

	if (!plain) plane(ALPHA_PLACE);
	for (let byte = 0; byte < PIXEL_SIZE_PLAIN; byte += 1) plane(byte);
	if (0 !== (layout.type & DEEPEST_TYPE)) {
		for (let row = 0; row < layout.height; row += 1) {
			for (let column = 0; column < layout.width; column += 1) {
				const dst = row * stride + column * pixelSize;
				pixels[dst] = ((pixels[dst] ?? 0) << DEEP_SHIFT_FIRST) & 0xff;
				pixels[dst + 1] = ((pixels[dst + 1] ?? 0) << DEEP_SHIFT_REST) & 0xff;
				pixels[dst + 2] = ((pixels[dst + 2] ?? 0) << DEEP_SHIFT_REST) & 0xff;
			}
		}
	}
	return { pixels, stride, pixelSize, format: plain ? "bgr24" : "bgra32" };
}

/**
 * `GsaFormat.TryBlendImage`: a part of a picture of this engine is drawn over the picture it belongs to, the
 * places of it standing where the head of the part names them and every place of it by as much as its own
 * alpha channel names.
 */
export function blendGsaPictures(
	base: GsaPicture,
	overlay: GsaPicture,
	layout: GsaLayout,
): GsaPicture {
	let x = layout.offsetX;
	let y = layout.offsetY;
	let width = layout.width;
	let height = layout.height;
	if (x < 0) {
		width += x;
		x = 0;
	}
	if (y < 0) {
		height += y;
		y = 0;
	}
	const baseWidth = (base.stride / base.pixelSize) | 0;
	const baseHeight = (base.pixels.length / base.stride) | 0;
	if (x + width > baseWidth) width = baseWidth - x;
	if (y + height > baseHeight) height = baseHeight - y;
	if (width <= 0 || height <= 0) return base;
	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			const source = row * overlay.stride + column * overlay.pixelSize;
			const dst = (y + row) * base.stride + (x + column) * base.pixelSize;
			const alpha = overlay.pixels[source + ALPHA_PLACE] ?? 0;
			if (0 === alpha) continue;
			if (FULL_ALPHA === alpha) {
				overlay.pixels.copy(base.pixels, dst, source, source + base.pixelSize);
				continue;
			}
			for (let byte = 0; byte < PIXEL_SIZE_PLAIN; byte += 1) {
				base.pixels[dst + byte] =
					(((overlay.pixels[source + byte] ?? 0) * alpha +
						(base.pixels[dst + byte] ?? 0) * (FULL_ALPHA - alpha)) /
						FULL_ALPHA) |
					0;
			}
		}
	}
	return base;
}

/** The places of a picture, as a bitmap keeps them: the rows of it stand as they are, without their own fill. */
export function packGsaRows(picture: GsaPicture, layout: GsaLayout): Buffer {
	const packed = layout.width * picture.pixelSize;
	if (packed === picture.stride) return picture.pixels;
	const output = Buffer.alloc(packed * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		picture.pixels.copy(
			output,
			row * packed,
			row * picture.stride,
			row * picture.stride + packed,
		);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `GsaFormat.Read`: a part of a picture, drawn over the picture it belongs to when that one stands beside it. */
export async function readGsaPart(
	data: Buffer,
	layout: GsaLayout,
	sourcePath: string,
): Promise<GsaPicture> {
	const overlay = unpackGsaPicture(data, layout);
	if (!PART_NAME.test(sourcePath.replace(/^.*[/\\]/, ""))) return overlay;
	const basePath = join(
		dirname(sourcePath),
		changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "GSA"),
	);
	let base: Buffer;
	try {
		base = await readFile(basePath);
	} catch {
		return overlay;
	}
	const baseLayout = readGsaLayout(base);
	if (!baseLayout) return overlay;
	try {
		return blendGsaPictures(
			unpackGsaPicture(base, baseLayout),
			overlay,
			layout,
		);
	} catch {
		return overlay;
	}
}

export const gsaImageDescriptor: FormatDescriptor = {
	id: "bishop-gsa-image",
	name: "Bishop image",
	extensions: [
		"gsa",
		...Array.from(
			{ length: 12 },
			(_, at) => `g${String(at + 1).padStart(2, "0")}`,
		),
		...Array.from({ length: 9 }, (_, at) => `gs${at + 1}`),
	],
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
			source: "ArcFormats/Bishop/ImageGSA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gsaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsaImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		const head = await source.readAt(0n, MARK.length);
		return head.equals(MARK);
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readGsaLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Bishop engine");
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
					bitsPerPixel: 24 === (3 === layout.type ? 3 : 4) * 8 ? 24 : 32,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				pictureType: layout.type,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath?: string) {
		const data = await readStored(source);
		const layout = readGsaLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Bishop engine");
		const picture = await readGsaPart(
			data,
			layout,
			sourcePath ?? "picture.gsa",
		);
		const pixels = packGsaRows(picture, layout);
		// The reference turns the picture about as it hands it over, so the row its walk draws first is what a
		// reader shows at the top of the picture.
		if ("bgr24" === picture.format) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, true),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
