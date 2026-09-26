// The picture of the LiveMaker engine (`GAL`), of the reference `ArcFormats/LiveMaker/ImageGAL.cs`
// (`GalFormat`, `GalReader` and its `Frame` and `Layer`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A picture of the engine stands of a head of two shapes - the word `Gale`, the letters of the version and
// the count of the places of the head of it, and then the head itself - and then the counts of a picture of
// the engine: the name of it, the count of the names of the places of a picture of it, the head of a frame
// and the places of every count of the places of the picture. A frame of the versions of the engine of the
// count of one hundred and three and above stands of the counts of the walk of the places of the picture
// itself: a count of no name at all, a count of the places of the counts of the walk of a picture of the
// engine, or a place of a count of the places of the picture within the frame. The places of the picture
// stand of the walk of the engine of the count of the places of the picture of the engine itself, of the
// generator of the counts of the engine (`TpRandom`), which stands of the key of the game; the reference
// stands of no key at all where no key stands in its own counts, and this port stands of no key at all.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { TpRandom } from "./vf.js";

/** 'Gale', the word every picture of the engine begins with. */
const SIGNATURE = Buffer.from("Gale", "latin1");
const GREETING_SIZE = 11;
const HEAD_SIZE_MIN = 0x28;
const HEAD_SIZE_MAX = 0x100;
const OLD_HEAD_SIZE = 0x10;
const VERSION_MIN = 100;
const VERSION_MAX = 107;
/** The version from which the places of a picture of the engine stand of the walk of the engine itself. */
const WALK_VERSION = 103;
/** The version from which every count of the places of a picture of the engine stands of its own count. */
const LOCK_VERSION = 107;
const COMPRESSION_ZLIB = 0;
const COMPRESSION_RAW = 1;
const COMPRESSION_JPEG = 2;
const PALETTE_ENTRY = 4;
const LAYER_COUNT_LIMIT = 0x100;
const BLOCK_COUNT_LIMIT = 0x40000;
const PLACES_LIMIT = 0x10000000;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** A walk of a buffer that stands of no place behind its end. */
class Reader {
	readonly #data: Buffer;
	#at = 0;

	constructor(data: Buffer, at = 0) {
		this.#data = data;
		this.#at = at;
	}

	get position(): number {
		return this.#at;
	}

	set position(at: number) {
		this.#at = at;
	}

	get size(): number {
		return this.#data.length;
	}

	readU8(): number | undefined {
		if (this.#at + 1 > this.#data.length) return undefined;
		const value = this.#data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	readU32(): number | undefined {
		if (this.#at + 4 > this.#data.length) return undefined;
		const value = this.#data.readUInt32LE(this.#at);
		this.#at += 4;
		return value;
	}

	readI32(): number | undefined {
		if (this.#at + 4 > this.#data.length) return undefined;
		const value = this.#data.readInt32LE(this.#at);
		this.#at += 4;
		return value;
	}

	bytes(count: number): Buffer | undefined {
		if (count < 0 || this.#at + count > this.#data.length) return undefined;
		const value = this.#data.subarray(this.#at, this.#at + count);
		this.#at += count;
		return value;
	}

	skip(count: number): boolean {
		if (count < 0 || this.#at + count > this.#data.length) return false;
		this.#at += count;
		return true;
	}
}

/** The counts of the head of a picture of the engine, of the places of the picture of it behind them. */
export interface GalHeader {
	version: number;
	/** The place of the counts of the picture itself: the name of it and the places of the picture. */
	dataOffset: number;
	shuffled: boolean;
	compression: number;
	blockWidth: number;
	blockHeight: number;
	/** The counts of the head of a picture of the engine of the walk of the places of it, where it has one. */
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	frameCount?: number;
}

/**
 * The counts of the walk of the places of a picture of the engine: GARbro `GalReader.RandomSequence`, which
 * stands of `TpRandom` of the seed and names the places of the counts one by one.
 */
export function readGalSequence(
	count: number,
	seed: number,
): number[] | undefined {
	if (count < 0 || count > BLOCK_COUNT_LIMIT) return undefined;
	const random = new TpRandom(seed);
	const order: number[] = [];
	for (let index = 0; index < count; index += 1) order.push(index);
	const sequence: number[] = [];
	while (order.length > 0) {
		const at = random.getRand32() % order.length;
		sequence.push(order[at] ?? 0);
		order.splice(at, 1);
	}
	return sequence;
}

/** Reads the head of a picture of the engine: the word of it and the counts of the head of it. */
export function readGalHeader(data: Buffer): GalHeader | undefined {
	if (data.length < GREETING_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const version =
		(data[4] ?? 0) * 100 + (data[5] ?? 0) * 10 + (data[6] ?? 0) - 0x14d0;
	if (version < VERSION_MIN || version > VERSION_MAX) return undefined;
	if (version > 102) {
		const headerSize = data.readInt32LE(7);
		if (headerSize < HEAD_SIZE_MIN || headerSize > HEAD_SIZE_MAX)
			return undefined;
		const reader = new Reader(data, GREETING_SIZE);
		const head = reader.bytes(headerSize);
		if (!head) return undefined;
		if (version !== head.readInt32LE(0)) return undefined;
		const width = head.readUInt32LE(4);
		const height = head.readUInt32LE(8);
		const bitsPerPixel = head.readInt32LE(0xc);
		const frameCount = head.readInt32LE(0x10);
		if (width <= 0 || height <= 0) return undefined;
		return {
			version,
			dataOffset: GREETING_SIZE + headerSize,
			shuffled: 0 !== (head[0x15] ?? 0),
			compression: head[0x16] ?? 0,
			blockWidth: head.readInt32LE(0x1c),
			blockHeight: head.readInt32LE(0x20),
			width,
			height,
			bitsPerPixel,
			frameCount,
		};
	}
	// The head of the older versions of the engine stands of the counts of the picture of the engine alone:
	// the places of the picture stand of the count of the places of the head of it and of the counts of the
	// walk of the engine of the older kind, which the places of the picture of the engine name themselves.
	return {
		version,
		dataOffset: OLD_HEAD_SIZE,
		shuffled: false,
		compression: COMPRESSION_RAW,
		blockWidth: 0,
		blockHeight: 0,
	};
}

/** A count of the places of a picture of a frame of the engine. */
export interface GalLayer {
	pixels: Buffer;
	alpha?: Buffer;
}

/** A frame of a picture of the engine: the counts of the picture of it and its counts of the places. */
export interface GalFrame {
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
	alphaStride: number;
	palette?: Buffer;
	layers: GalLayer[];
	/** The place of the counts of the places of the picture: the name of every count and the places. */
	placedAt: number;
}

function frameStride(
	width: number,
	bitsPerPixel: number,
): { stride: number; alphaStride: number } {
	let stride = Math.trunc((width * bitsPerPixel + 7) / 8);
	const alphaStride = (width + 3) & ~3;
	if (bitsPerPixel >= 8) stride = (stride + 3) & ~3;
	return { stride, alphaStride };
}

/** The counts of the places of a picture of the engine of a count of the engine itself. */
async function readGalPlaces(
	frame: GalFrame,
	packed: Buffer,
	isAlpha: boolean,
	layers: readonly GalLayer[],
	header: GalHeader,
): Promise<Buffer | undefined> {
	const bpp = isAlpha ? 8 : frame.bitsPerPixel;
	const stride = isAlpha ? frame.alphaStride : frame.stride;
	// The counts of the walk of the engine of the places of the picture of the engine of no count of the
	// places of a block of the walk of the engine itself stand of the counts of the places of the picture
	// alone.
	if (header.blockWidth <= 0 || header.blockHeight <= 0)
		return readGalRaw(frame, packed, isAlpha, header);
	if (frame.width * frame.height > PLACES_LIMIT) return undefined;
	const pixels = Buffer.alloc(stride * frame.height);
	const blocksW = Math.trunc(
		(frame.width + header.blockWidth - 1) / header.blockWidth,
	);
	const blocksH = Math.trunc(
		(frame.height + header.blockHeight - 1) / header.blockHeight,
	);
	const blockCount = blocksW * blocksH;
	if (blockCount > BLOCK_COUNT_LIMIT) return undefined;
	const refs: number[] = [];
	for (let index = 0; index < blockCount; index += 1) {
		if (8 * (index + 1) > packed.length) return undefined;
		refs.push(packed.readInt32LE(8 * index), packed.readInt32LE(8 * index + 4));
	}
	if (header.shuffled) {
		const sequence = readGalSequence(blockCount, 0);
		if (!sequence) return undefined;
		const copy = [...refs];
		let src = 0;
		for (const at of sequence) {
			refs[at * 2] = copy[src] ?? 0;
			refs[at * 2 + 1] = copy[src + 1] ?? 0;
			src += 2;
		}
	}
	let packedAt = 8 * blockCount;
	let i = 0;
	for (let y = 0; y < frame.height; y += header.blockHeight) {
		const height = Math.min(header.blockHeight, frame.height - y);
		for (let x = 0; x < frame.width; x += header.blockWidth) {
			const dst = y * stride + Math.trunc((x * bpp + 7) / 8);
			const width = Math.min(header.blockWidth, frame.width - x);
			const chunk = Math.trunc((width * bpp + 7) / 8);
			const first = refs[i] ?? 0;
			const second = refs[i + 1] ?? 0;
			if (-1 === first) {
				for (let j = 0; j < height; j += 1) {
					if (packedAt + chunk > packed.length) return undefined;
					packed.copy(pixels, dst + j * stride, packedAt, packedAt + chunk);
					packedAt += chunk;
				}
			} else if (-2 === first) {
				const srcX = header.blockWidth * (second % blocksW);
				const srcY = header.blockHeight * Math.trunc(second / blocksW);
				const src = srcY * stride + Math.trunc((srcX * bpp + 7) / 8);
				for (let j = 0; j < height; j += 1) {
					pixels.copy(
						pixels,
						dst + j * stride,
						src + j * stride,
						src + j * stride + chunk,
					);
				}
			} else {
				// The reference stands of the places of a picture of the engine of the count of the places
				// of a frame of it and of the count of the places of that frame: only the first frame of a
				// picture of the engine stands walked, so the count of the places of the frame stands of no
				// count but the first.
				if (0 !== first || second < 0 || second >= layers.length)
					return undefined;
				const layer = layers[second];
				if (!layer) return undefined;
				const source = isAlpha ? layer.alpha : layer.pixels;
				if (!source) return undefined;
				for (let j = 0; j < height; j += 1) {
					source.copy(
						pixels,
						dst + j * stride,
						dst + j * stride,
						dst + j * stride + chunk,
					);
				}
			}
			i += 2;
		}
	}
	return pixels;
}

/** The counts of the places of a picture of the engine of no counts of the walk of the engine itself. */
function readGalRaw(
	frame: GalFrame,
	packed: Buffer,
	isAlpha: boolean,
	header: GalHeader,
): Buffer | undefined {
	const stride = isAlpha ? frame.alphaStride : frame.stride;
	if (frame.width * frame.height > PLACES_LIMIT) return undefined;
	const pixels = Buffer.alloc(stride * frame.height);
	if (header.shuffled) {
		const sequence = readGalSequence(frame.height, 0);
		if (!sequence) return undefined;
		let at = 0;
		for (const dst of sequence) {
			if (at + stride > packed.length) return undefined;
			packed.copy(pixels, dst * stride, at, at + stride);
			at += stride;
		}
	} else {
		if (pixels.length > packed.length) return undefined;
		packed.copy(pixels, 0, 0, pixels.length);
	}
	return pixels;
}

/** The counts of the places of a picture of the engine of one count of the walk of the places of it. */
async function unpackGalLayer(
	frame: GalFrame,
	header: GalHeader,
	packed: Buffer,
	length: number,
	isAlpha: boolean,
	layers: readonly GalLayer[],
): Promise<Buffer | undefined> {
	if (header.version < WALK_VERSION)
		return packed.length === 0 ? Buffer.alloc(0) : packed;
	if (length < 0 || length > packed.length) return undefined;
	const region = packed.subarray(0, length);
	if (
		COMPRESSION_ZLIB === header.compression ||
		(COMPRESSION_JPEG === header.compression && isAlpha)
	) {
		return await readGalPlaces(
			frame,
			await inflateZlibBuffer(region),
			isAlpha,
			layers,
			header,
		);
	}
	if (COMPRESSION_JPEG === header.compression) {
		// The reference hands the count of the places of the picture to the decoder of pictures of the
		// place of the counts of the walk of the engine itself (`JpegBitmapDecoder`), which this port has
		// not taken.
		throw unsupportedPicture(
			"The places of a picture of the engine of the kind of the engine itself",
		);
	}
	return await readGalPlaces(frame, region, isAlpha, layers, header);
}

/** Reads the frame of a picture of the engine and the counts of the places of it. */
/** The counts of the frame of a picture of the engine, of the places of the count of it. */
export interface GalFrameHead {
	frame: GalFrame;
	layerCount: number;
}

/**
 * Reads the counts of the frame of a picture of the engine and of the counts of the places of it. The
 * places of the counts themselves stand behind the counts of the frame, at the place of the walk of them.
 */
export function readGalFrameHead(
	data: Buffer,
	header: GalHeader,
): GalFrameHead | undefined {
	const reader = new Reader(data, header.dataOffset);
	const nameLength = reader.readU32();
	if (undefined === nameLength || !reader.skip(nameLength)) return undefined;
	if (undefined === reader.readU32()) return undefined;
	if (!reader.skip(9)) return undefined;
	const layerCount = reader.readI32();
	if (
		undefined === layerCount ||
		layerCount < 1 ||
		layerCount > LAYER_COUNT_LIMIT
	)
		return undefined;
	const width = reader.readI32();
	const height = reader.readI32();
	const bitsPerPixel = reader.readI32();
	if (undefined === width || undefined === height || undefined === bitsPerPixel)
		return undefined;
	if (width <= 0 || height <= 0 || bitsPerPixel <= 0) return undefined;
	if (width * height > PLACES_LIMIT) return undefined;
	let palette: Buffer | undefined;
	if (bitsPerPixel <= 8) {
		palette = reader.bytes(PALETTE_ENTRY * (1 << bitsPerPixel));
		if (!palette) return undefined;
	}
	const { stride, alphaStride } = frameStride(width, bitsPerPixel);
	const frame: GalFrame = {
		width,
		height,
		bitsPerPixel,
		stride,
		alphaStride,
		layers: [],
		placedAt: reader.position,
	};
	if (palette) frame.palette = palette;
	return { frame, layerCount };
}

/** Reads the counts of the places of a picture of the engine and the places of them. */
export async function readGalLayers(
	data: Buffer,
	header: GalHeader,
	head: GalFrameHead,
): Promise<GalFrame | undefined> {
	const frame = head.frame;
	const reader = new Reader(data, frame.placedAt);
	for (let index = 0; index < head.layerCount; index += 1) {
		// The places of the count of the places of a picture of the engine: the places of it within the
		// picture, the counts of the walk of the engine of it and the name of it.
		if (!reader.skip(8)) return undefined;
		if (undefined === reader.readU8()) return undefined;
		if (!reader.skip(4)) return undefined;
		if (undefined === reader.readI32()) return undefined;
		if (undefined === reader.readU8()) return undefined;
		const layerName = reader.readU32();
		if (undefined === layerName || !reader.skip(layerName)) return undefined;
		if (header.version >= LOCK_VERSION && undefined === reader.readU8())
			return undefined;
		const layerSize = reader.readI32();
		if (undefined === layerSize || layerSize < 0) return undefined;
		const at = reader.position;
		if (at + layerSize > data.length) return undefined;
		const pixels = await unpackGalLayer(
			frame,
			header,
			data.subarray(at, at + layerSize),
			layerSize,
			false,
			frame.layers,
		);
		if (!pixels) return undefined;
		reader.position = at + layerSize;
		const layer: GalLayer = { pixels };
		const alphaSize = reader.readI32();
		if (undefined === alphaSize || alphaSize < 0) return undefined;
		if (0 !== alphaSize) {
			const alphaAt = reader.position;
			if (alphaAt + alphaSize > data.length) return undefined;
			const alpha = await unpackGalLayer(
				frame,
				header,
				data.subarray(alphaAt, alphaAt + alphaSize),
				alphaSize,
				true,
				frame.layers,
			);
			if (!alpha) return undefined;
			reader.position = alphaAt + alphaSize;
			layer.alpha = alpha;
		}
		frame.layers.push(layer);
	}
	return frame;
}

/** Reads a picture of the engine, of the counts of the frame of it and of the places of it. */
export async function readGalFrame(
	data: Buffer,
	header: GalHeader,
): Promise<GalFrame | undefined> {
	const head = readGalFrameHead(data, header);
	if (!head) return undefined;
	return await readGalLayers(data, header, head);
}

/** The places of a picture of the engine, of the counts of the frame of it. */
export interface GalPicture {
	width: number;
	height: number;
	/** The places of the picture, of the count of the places of a colour of the walk of the engine of it. */
	pixels: Buffer;
	palette?: Buffer;
}

/** The places of a picture of the engine of one count of the places of the walk of the engine of it. */
export function flattenGal(frame: GalFrame): GalPicture {
	const layer = frame.layers[0];
	if (!layer)
		throw invalidPicture(
			"The picture of the engine stands of no count of places",
		);
	const output = Buffer.alloc(frame.width * frame.height * 4);
	const alphaPlane = layer.alpha;
	if (!alphaPlane) {
		switch (frame.bitsPerPixel) {
			case 4: {
				const pixels = Buffer.alloc(frame.width * frame.height);
				for (let y = 0; y < frame.height; y += 1) {
					for (let x = 0; x < frame.width; x += 1) {
						const place = layer.pixels[y * frame.stride + (x >> 1)] ?? 0;
						pixels[y * frame.width + x] =
							0 === (x & 1) ? place & 0x0f : place >> 4;
					}
				}
				const picture: GalPicture = {
					width: frame.width,
					height: frame.height,
					pixels,
				};
				if (frame.palette) picture.palette = frame.palette;
				return picture;
			}
			case 8: {
				const pixels = Buffer.alloc(frame.width * frame.height);
				for (let y = 0; y < frame.height; y += 1) {
					layer.pixels.copy(
						pixels,
						y * frame.width,
						y * frame.stride,
						y * frame.stride + frame.width,
					);
				}
				const picture: GalPicture = {
					width: frame.width,
					height: frame.height,
					pixels,
				};
				if (frame.palette) picture.palette = frame.palette;
				return picture;
			}
			case 16: {
				// The reference hands the places of a picture of a count of sixteen places of a colour of
				// the walk of the engine to its own walk of the places of the picture, which stands of the
				// places of the counts of the engine of the picture of the engine itself.
				for (let y = 0; y < frame.height; y += 1) {
					for (let x = 0; x < frame.width; x += 1) {
						const place = layer.pixels.readUInt16LE(y * frame.stride + x * 2);
						const at = (y * frame.width + x) * 3;
						output[at] = ((place & 0x001f) * 0xff) / 0x001f;
						output[at + 1] = ((place & 0x07e0) * 0xff) / 0x07e0;
						output[at + 2] = ((place & 0xf800) * 0xff) / 0xf800;
					}
				}
				return {
					width: frame.width,
					height: frame.height,
					pixels: output.subarray(0, frame.width * frame.height * 3),
				};
			}
			case 24: {
				for (let y = 0; y < frame.height; y += 1) {
					layer.pixels.copy(
						output,
						y * frame.width * 3,
						y * frame.stride,
						y * frame.stride + frame.width * 3,
					);
				}
				return {
					width: frame.width,
					height: frame.height,
					pixels: output.subarray(0, frame.width * frame.height * 3),
				};
			}
			case 32: {
				for (let y = 0; y < frame.height; y += 1) {
					layer.pixels.copy(
						output,
						y * frame.width * 4,
						y * frame.stride,
						y * frame.stride + frame.width * 4,
					);
				}
				// The reference hands the places of the picture of the engine to its own walk of the places
				// of the picture as places of a colour of the walk of the engine of no count of the places
				// of the picture at all, which stand of the count of the places of the picture of the
				// engine: this port stands of the places of the picture of the engine of the count of the
				// walk of the engine of the places of the picture of it.
				for (let at = 3; at < output.length; at += 4) output[at] = 0xff;
				return { width: frame.width, height: frame.height, pixels: output };
			}
			default:
				throw unsupportedPicture(
					`The places of a picture of the engine of the count of ${frame.bitsPerPixel} places`,
				);
		}
	}
	for (let y = 0; y < frame.height; y += 1) {
		for (let x = 0; x < frame.width; x += 1) {
			const dst = y * frame.width * 4 + x * 4;
			const alpha = alphaPlane[y * frame.alphaStride + x] ?? 0;
			if (4 === frame.bitsPerPixel || 8 === frame.bitsPerPixel) {
				const place =
					layer.pixels[
						y * frame.stride + (x >> (4 === frame.bitsPerPixel ? 1 : 0))
					] ?? 0;
				const index =
					4 === frame.bitsPerPixel
						? 0 === (x & 1)
							? place & 0x0f
							: place >> 4
						: place;
				const entry = frame.palette
					? frame.palette.subarray(
							index * PALETTE_ENTRY,
							(index + 1) * PALETTE_ENTRY,
						)
					: Buffer.alloc(PALETTE_ENTRY);
				output[dst] = entry[0] ?? 0;
				output[dst + 1] = entry[1] ?? 0;
				output[dst + 2] = entry[2] ?? 0;
				output[dst + 3] = alpha;
			} else if (16 === frame.bitsPerPixel) {
				const place = layer.pixels.readUInt16LE(y * frame.stride + x * 2);
				output[dst] = ((place & 0x001f) * 0xff) / 0x001f;
				output[dst + 1] = ((place & 0x07e0) * 0xff) / 0x07e0;
				output[dst + 2] = ((place & 0xf800) * 0xff) / 0xf800;
				output[dst + 3] = alpha;
			} else if (24 === frame.bitsPerPixel) {
				const src = y * frame.stride + x * 3;
				output[dst] = layer.pixels[src] ?? 0;
				output[dst + 1] = layer.pixels[src + 1] ?? 0;
				output[dst + 2] = layer.pixels[src + 2] ?? 0;
				output[dst + 3] = alpha;
			} else if (32 === frame.bitsPerPixel) {
				const src = y * frame.stride + x * 4;
				output[dst] = layer.pixels[src] ?? 0;
				output[dst + 1] = layer.pixels[src + 1] ?? 0;
				output[dst + 2] = layer.pixels[src + 2] ?? 0;
				output[dst + 3] = alpha;
			} else {
				throw unsupportedPicture(
					`The places of a picture of the engine of the count of ${frame.bitsPerPixel} places`,
				);
			}
		}
	}
	return { width: frame.width, height: frame.height, pixels: output };
}

/**
 * The counts of the head of a picture of the engine and of the frame of it. The reference reads the same
 * counts before it stands of the places of the picture, so this walk stands of the places of the picture of
 * the engine of no count of the places at all: a picture whose counts of the places stand of a kind of the
 * walk of the engine this port has not taken stands detected all the same.
 */
export function readGalPicture(
	data: Buffer,
): { header: GalHeader; head: GalFrameHead } | undefined {
	const header = readGalHeader(data);
	if (!header) return undefined;
	const head = readGalFrameHead(data, header);
	if (!head) return undefined;
	return { header, head };
}

function galBitmap(picture: GalPicture): Buffer {
	if (
		picture.palette &&
		picture.pixels.length === picture.width * picture.height
	)
		return writeBmp8Palette(
			picture.width,
			picture.height,
			picture.pixels,
			picture.palette,
		);
	if (picture.pixels.length === picture.width * picture.height * 3)
		return writeBmp24(picture.width, picture.height, picture.pixels);
	return writeBmp32(picture.width, picture.height, picture.pixels);
}

export const livemakerGalImageDescriptor: FormatDescriptor = {
	id: "livemaker-gal-image",
	name: "LiveMaker image",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/LiveMaker/ImageGAL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const livemakerGalImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: livemakerGalImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(GREETING_SIZE)) return false;
		try {
			return readGalPicture(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const picture = readGalPicture(await readStored(source));
		if (!picture) throw invalidPicture("Not a picture of the LiveMaker engine");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const frame = picture.head.frame;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: frame.width,
					height: frame.height,
					bitsPerPixel: frame.bitsPerPixel,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: frame.width,
				height: frame.height,
				bitsPerPixel: frame.bitsPerPixel,
				version: picture.header.version,
				layers: picture.head.layerCount,
				shuffled: picture.header.shuffled,
				compression: picture.header.compression,
			},
		};
	},
	async openEntry(source: ByteSource): Promise<Readable> {
		const data = await readStored(source);
		const picture = readGalPicture(data);
		if (!picture) throw invalidPicture("Not a picture of the LiveMaker engine");
		const frame = await readGalLayers(data, picture.header, picture.head);
		if (!frame) throw invalidPicture("Not a picture of the LiveMaker engine");
		return Readable.from([galBitmap(flattenGal(frame))]);
	},
});
