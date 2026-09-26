// Port of GARbro "ArcFormats/rUGP/ImageRIP.cs" (tag "RIP", class `RipFormat`, and the objects `CRip` and
// `CRip007` behind it), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the newer engine is an object of the same graph the archive of the engine carries: the file
// begins with the mark of an object (`ObjectSignature`) and the class behind that mark is `CRip` or `CRip007`.
// The head of the class names the places of the picture, the flags of the walk of it, and the count of the
// places of the run behind them; the run itself stands of one of four walks:
//
//   * `flags & 0xFF` of 1: a run of places of a picture of eight places of a grey (a run of a count of places
//     of one colour and then the colour of the run behind that count), of one place a picture.
//   * `flags & 0xFF` of 2: a walk over the **bits** of the run, of the kind `(flags >> 16) & 0xFF`:
//     a walk of the places of a colour of the picture of the engine (`ReadLong`), and two of them behind it.
//   * `flags & 0xFF` of 3: a walk of a picture of thirty two places, of a place of the colour and a place of
//     the alpha, of the kind 2 of the flags.
//
// Two places of the reference stand as `NotImplementedException` and are refused here as well rather than
// guessed at: the kind 2 of the bit walks of `flags & 0xFF` of 2 (`UncompressRgb2`), and the whole of the
// walks of the class `CRip007` (`UncompressRgb` and the alpha walk of it behind the counts of
// `CompressInfo`), whose places stand of a head of their own.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32, writeBmp8 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { RIO_OBJECT_SIGNATURE, RioClassReader, RioStream } from "./rio-core.js";

/**
 * `CRip007.tblQuantTransfer`: the six tables of the places of a colour of the walk of the class, of a
 * place of a byte a place. They stand here as the runs of places they are, read out of the file of the
 * reference rather than written by hand.
 */
const QUANT_ROWS = [
	"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f",
	"0001020406090c0f1316191c1f23272b3034383c4044484c5054585c6064686c707172737475767778797a7b7c7d7e7f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102020303040404050505060606070707070808080909090a0a0a0b0b0b0c0c0c0c0d0d0d0d0e0e0e0e0f0f0f0f0f101010101111111112121212131313131414141415151515161616161717171718181818191919191a1a1a1a1b1b1b1b1c1c1c1c1d1d1d1d1e1e1e1e1f1f1f1f202122232425262728292a2b2c2d2e2f",
	"00010204080c1014181b1e22262a2e32363a3e42464b50555a5f64696e73787d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001020203030303040404040505050506060606070707070808080909090a0a0a0a0b0b0b0b0c0c0c0c0d0d0d0d0e0e0e0e0f0f0f0f101010101111111112121212131313131414141414151515151516161616161717171717181818181819191919191a1a1a1a1a1b1b1b1b1b1c1c1c1c1c1d1d1d1d1d1e1e1e1e1e1f1f1f",
	"000103070c10151a20252a30363c42485054585c6064686c7074787b7c7d7e7f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001010202020203030303030404040405050505050606060606070707070707080808080809090909090a0a0a0a0a0a0b0b0b0b0b0b0c0c0c0c0c0c0d0d0d0d0d0d0e0e0e0e0e0e0f0f0f0f0f0f0f0f101010101111111112121212131313131414141415151515161616161717171718181818191919191a1a1a1b1c1d1e1f",
	"000103070d131a21282f363e464e565e686a6c6e7072747678797a7b7c7d7e7f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001010202020203030303030304040404040405050505050505060606060606060707070707070708080808080808090909090909090a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f1010111112121313141415151616171718191a1b1c1d1e1f",
	"0001040a11182028323c46505a646e7800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000101010202020202020303030303030304040404040404050505050505050506060606060606060707070707070707070708080808080808080808090909090909090909090a0a0a0a0a0a0a0a0a0a0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f",
] as const;

/** The six tables, of a place of a byte a place. */
export const RIP_QUANT_TRANSFER: readonly Uint8Array[] = QUANT_ROWS.map((row) =>
	Uint8Array.from(Buffer.from(row, "hex")),
);

const SIGNATURE = Buffer.from("a4cbf629", "hex");
/** The two classes of the picture of the engine. */
const CLASS_RIP = "CRip";
const CLASS_RIP007 = "CRip007";
/** The places of the head of an object of either class of the picture (the counts and the flags). */
const RIP_PLACES = 0x14;
/** The kinds of the walk of a picture of the class `CRip`. */
const KIND_RUN = 1;
const KIND_BITS = 2;
const KIND_ALPHA = 3;
/** The count of the places of a colour of the picture of the engine. */
const PLACES_PER_COLOUR = 4;

export interface RipObject {
	readonly className: string;
	readonly objectAt: number;
	/** The counts of the picture of the head of the class. */
	readonly width: number;
	readonly height: number;
	/** The counts of the places of the picture of the walk of the class (`m_w` and `m_h`). */
	readonly placeWidth: number;
	readonly placeHeight: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly kind: number;
	readonly subKind: number;
	readonly bitsPerPixel: number;
	/** The places of the run of the walk, which stand behind the head of the class. */
	readonly runAt: number;
	readonly runSize: number;
	/** The seven places of the walk of the class `CRip007`, of a place of a byte a place. */
	readonly compressInfo?: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `RipFormat.ReadMetaData` and the head of `CRip.Deserialize`: the mark of an object of the engine, the class
 * of the picture behind it, and the head of that class. The places of the picture stand of the kind of the
 * walk of it: the counts of the places of a picture of the kind 3 stand of the second pair of the counts.
 */
export function readRipObject(data: Buffer): RipObject | undefined {
	if (
		data.length < RIP_PLACES ||
		data.readUInt32LE(0) !== RIO_OBJECT_SIGNATURE
	) {
		return undefined;
	}
	const stream = new RioStream(data);
	const reader = new RioClassReader();
	const walked = reader.loadRioTypeCore(stream);
	const className = walked?.className;
	if (className !== CLASS_RIP && className !== CLASS_RIP007) return undefined;
	const objectAt = stream.position;
	if (CLASS_RIP007 === className) {
		if (objectAt + RIP_PLACES + 7 + 8 > data.length) return undefined;
		const width = data.readUInt16LE(objectAt + 4);
		const height = data.readUInt16LE(objectAt + 6);
		if (0 === width || 0 === height) return undefined;
		const offsetX = data.readUInt16LE(objectAt + 8);
		const offsetY = data.readUInt16LE(objectAt + 10);
		const placeWidth = data.readUInt16LE(objectAt + 12);
		const placeHeight = data.readUInt16LE(objectAt + 14);
		const flags = data.readUInt32LE(objectAt + 16);
		if (0 === placeWidth || 0 === placeHeight) return undefined;
		const compressInfo = data.subarray(
			objectAt + RIP_PLACES,
			objectAt + RIP_PLACES + 7,
		);
		const runSize = data.readInt32LE(objectAt + RIP_PLACES + 7);
		const runAt = objectAt + RIP_PLACES + 7 + 8;
		if (runSize < 0 || runAt + runSize > data.length) return undefined;
		return {
			className,
			objectAt,
			width,
			height,
			placeWidth,
			placeHeight,
			offsetX,
			offsetY,
			kind: flags & 0xff,
			subKind: (flags >>> 16) & 0xff,
			bitsPerPixel: 32,
			runAt,
			runSize,
			compressInfo: Buffer.from(compressInfo),
		};
	}
	if (objectAt + RIP_PLACES > data.length) return undefined;
	const offsetX = data.readUInt16LE(objectAt + 4);
	const offsetY = data.readUInt16LE(objectAt + 6);
	const width1 = data.readUInt16LE(objectAt + 8);
	const height1 = data.readUInt16LE(objectAt + 10);
	const width2 = data.readUInt16LE(objectAt + 12);
	const height2 = data.readUInt16LE(objectAt + 14);
	const flags = data.readUInt32LE(objectAt + 16);
	const kind = flags & 0xff;
	if (kind < KIND_RUN || kind > KIND_ALPHA) return undefined;
	const width = KIND_ALPHA === kind ? width2 : width1;
	const height = KIND_ALPHA === kind ? height2 : height1;
	if (0 === width || 0 === height) return undefined;
	const runSize = data.readInt32LE(objectAt + 0x14);
	const runAt = objectAt + 0x1c;
	if (runSize < 0 || runAt + runSize > data.length) return undefined;
	return {
		className,
		objectAt,
		width,
		height,
		placeWidth: width1,
		placeHeight: height1,
		offsetX,
		offsetY,
		kind,
		subKind: (flags >>> 16) & 0xff,
		bitsPerPixel: KIND_RUN === kind ? 8 : 32,
		runAt,
		runSize,
	};
}

/** `CRip.UncompressSia`: a run of a count of places of one colour, of the colour behind the count. */
export function unpackRipRun(
	run: Buffer,
	width: number,
	height: number,
): Buffer {
	const output = Buffer.alloc(width * height, 0x00);
	let at = 0;
	for (let y = 0; y < height; y += 1) {
		let colour = 0;
		let left = width;
		let to = y * width;
		while (left > 0) {
			if (at >= run.length) {
				throw invalidPicture("Purple picture stands short of its places");
			}
			const count = run[at++] ?? 0;
			if (count > 0) {
				left -= count;
				for (let place = 0; place < count; place += 1) {
					if (to < output.length) output[to++] = colour;
				}
			}
			if (left > 0 && at < run.length) colour = run[at++] ?? 0;
		}
	}
	return output;
}

/** The bit stream of the walk of the engine: a place of a bit, of the highest place of a place first. */
class RipBits {
	readonly #reader: MsbBitReader;

	constructor(data: Buffer) {
		this.#reader = new MsbBitReader(data);
	}

	/** `GetNextBit`, of the places of the reference: a stream that ends stands of `-1`. */
	nextBit(): number {
		return this.#reader.tryReadBits(1);
	}

	/** `GetBits`, of a stream that ends rather than of a walk that stands. */
	bits(count: number): number {
		const value = this.#reader.tryReadBits(count);
		if (value === -1) {
			throw invalidPicture("Purple picture stands short of its places");
		}
		return value;
	}
}

/** `CRip.ReadLong`: a place of a colour of the picture, of the place of the one in front of it. */
function readLong(input: RipBits, previous: number): number {
	const prev = previous & 0xfc;
	if (prev >> 2 === 0) {
		if (input.nextBit() === 0) return prev;
		if (input.nextBit() === 0) return input.bits(6) << 2;
		if (input.nextBit() === 0) return 4;
		if (input.nextBit() === 0) return 8;
		return 12;
	}
	if (prev >> 2 === 1) {
		if (input.nextBit() === 0) return input.nextBit() << 2;
		if (input.nextBit() === 0) return input.bits(6) << 2;
		if (input.nextBit() === 0) return 8;
		if (input.nextBit() === 0) return 12;
		return 16;
	}
	if (prev >> 2 === 0x3f) {
		if (input.nextBit() === 0) return 0xfc;
		if (input.nextBit() === 0) return input.bits(6) << 2;
		if (input.nextBit() !== 0) return 0xf4 + (-input.nextBit() & 0xfc);
		return 0xf8;
	}
	if (input.nextBit() === 0) {
		if (input.nextBit() === 0) return prev;
		return input.bits(6) << 2;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() !== 0 ? prev - 4 : prev + 4;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() !== 0 ? prev - 8 : prev + 8;
	}
	switch (input.bits(2)) {
		case 0:
			return Math.min(prev + 16, 0xfc);
		case 1:
			return Math.max(prev - 16, 0);
		case 2:
			return Math.min(prev + 24, 0xfc);
		default:
			return Math.max(prev - 24, 0);
	}
}

/** `CRip.ReadShort`: the same of a place of a green, of two places. */
function readShort(input: RipBits, previous: number): number {
	const prev = previous & 0xfe;
	if (input.nextBit() === 0) {
		if (input.nextBit() === 0) return prev;
		return input.bits(6) << 2;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() === 0 ? prev + 2 : prev - 2;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() === 0 ? prev + 4 : prev - 4;
	}
	switch (input.bits(2)) {
		case 0:
			return Math.min(prev + 8, 0xfe);
		case 1:
			return Math.max(prev - 8, 0);
		case 2:
			return Math.min(prev + 12, 0xfe);
		default:
			return Math.max(prev - 12, 0);
	}
}

/** `CRip.ReadABits`: the same of a place of an alpha, of the four places of a colour. */
function readABits(input: RipBits, previous: number): number {
	const prev = previous & 0xfc;
	if (input.nextBit() === 0) {
		if (input.nextBit() === 0) return prev;
		return input.bits(6) << 2;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() === 0 ? prev + 4 : prev - 4;
	}
	if (input.nextBit() === 0) {
		return input.nextBit() === 0 ? prev + 8 : prev - 8;
	}
	switch (input.bits(2)) {
		case 0:
			return Math.min(prev + 16, 0xfc);
		case 1:
			return Math.max(prev - 16, 0);
		case 2:
			return Math.min(prev + 24, 0xfc);
		default:
			return Math.max(prev - 24, 0);
	}
}

/** `CRip.UncompressRgb1`: a walk of a place of a colour over the bits of the run. */
function unpackRipRgb1(
	input: RipBits,
	width: number,
	height: number,
	addend: boolean,
): Buffer {
	const output = Buffer.alloc(width * height * PLACES_PER_COLOUR, 0x00);
	const stride = width * PLACES_PER_COLOUR;
	let rgb = 0;
	// The walk of the reference stands of the last row of the picture first, so the places of it are of the
	// bottom of the picture up.
	for (let row = output.length - stride; row >= 0; row -= stride) {
		let to = row;
		for (let x = 0; x < width; x += 1) {
			if (input.nextBit() !== 0) {
				const b = readLong(input, rgb) + (addend ? 3 : 0);
				const g = addend
					? readShort(input, rgb >> 8) + 1
					: readLong(input, rgb >> 8);
				const r = readLong(input, rgb >> 16) + (addend ? 3 : 0);
				rgb = ((r << 16) | (g << 8) | b) >>> 0;
			}
			output[to] = rgb & 0xff;
			output[to + 1] = (rgb >>> 8) & 0xff;
			output[to + 2] = (rgb >>> 16) & 0xff;
			to += PLACES_PER_COLOUR;
		}
	}
	return output;
}

/** `CRip.UncompressRgba`: a picture of a colour and a place of an alpha, of the runs of its own. */
function unpackRipRgba(
	run: Buffer,
	placeWidth: number,
	placeHeight: number,
): Buffer {
	if (run.length < 4)
		throw invalidPicture("Purple picture stands short of its places");
	const sizes = run.readInt32LE(0);
	if (sizes < 4 || sizes > run.length) {
		throw invalidPicture("Purple picture stands short of its places");
	}
	const input = new RipBits(run.subarray(4, sizes));
	const output = Buffer.alloc(
		placeWidth * placeHeight * PLACES_PER_COLOUR,
		0x00,
	);
	let at = sizes;
	let to = 0;
	for (let y = 0; y < placeHeight; y += 1) {
		let rgb = 0;
		let alpha = 0;
		let x = 0;
		while (x < placeWidth) {
			if (at >= run.length) {
				throw invalidPicture("Purple picture stands short of its places");
			}
			const length = run[at++] ?? 0;
			if (alpha !== 0) {
				for (let place = 0; place < length; place += 1) {
					if (input.nextBit() !== 0) {
						const b = readABits(input, rgb) + 3;
						const g = readABits(input, rgb >> 8) + 3;
						const r = readABits(input, rgb >> 16) + 3;
						rgb = ((r << 16) | (g << 8) | b) >>> 0;
					}
					if (to + 4 <= output.length) {
						output[to] = rgb & 0xff;
						output[to + 1] = (rgb >>> 8) & 0xff;
						output[to + 2] = (rgb >>> 16) & 0xff;
						output[to + 3] = alpha & 0xff;
					}
					to += PLACES_PER_COLOUR;
				}
			} else {
				to += PLACES_PER_COLOUR * length;
			}
			x += length;
			if (x >= placeWidth) break;
			const stand = input.nextBit();
			if (stand !== 0) {
				alpha = (input.bits(7) << 1) + 1;
			} else {
				alpha = input.nextBit() !== 0 ? 0xff : 0;
			}
		}
	}
	return output;
}

/** `CRip007.GetInt`: a count of the walk, of a place of a bit a place of it. */
function readRipInt(input: RipBits): number {
	let value = 1;
	let depth = 0;
	while (input.nextBit() > 0) {
		value = (value * 2) | (input.nextBit() > 0 ? 1 : 0);
		depth += 1;
		if (depth > 31) {
			throw invalidPicture("Purple picture stands of a count of no end");
		}
	}
	return value;
}

/** `CRip007.GetSigned`: the same, of a place of a sign in front of it. */
function readRipSigned(input: RipBits): number {
	const negative = input.nextBit() > 0;
	const value = readRipInt(input);
	return negative ? -value : value;
}

/**
 * `CRip007.UncompressRgb`: the places of a picture of no alpha of the class, of the tables of the places of a
 * colour. Every row of the picture stands of the row behind it (`output[dst - stride]`), which the reference
 * reads even of the first row of the picture; this port stands of a colour of nothing there.
 */
function unpackRip007Rgb(run: Buffer, object: RipObject): Buffer {
	const info = object.compressInfo ?? Buffer.alloc(7, 0x00);
	// The walk of the places of a colour of the class stands of the counts of the *picture* of the class,
	// where the walk of the places of an alpha stands of the places of it: the two counts of the head of the
	// class are not the counts of the picture.
	const width = object.width;
	const height = object.height;
	const input = new RipBits(run);
	const output = Buffer.alloc(width * height * PLACES_PER_COLOUR, 0x00);
	const stride = width * PLACES_PER_COLOUR;
	const q = info[0] ?? 0;
	const table = RIP_QUANT_TRANSFER[q] ?? RIP_QUANT_TRANSFER[0];
	const bBits = info[4] ?? 0;
	const gBits = info[5] ?? 0;
	const rBits = info[6] ?? 0;
	const isBgr676 = 6 === bBits && 7 === gBits && 6 === rBits;
	const bShift = 8 - bBits;
	const gShift = 16 - gBits;
	const rShift = 24 - rBits;
	// The places of the colour of nothing, of the walk of the reference: the places of the three counts of the
	// walk stand of the places of the colour of the head of the class, which is the count of the places of a
	// colour less the places of every count of it.
	const baseline =
		(0xff >> bBits) |
		(((0xff >> gBits) | (((0xff >> rBits) | 0xff00) << 8)) << 8);
	for (let y = 0; y < height; y += 1) {
		let packed = 0;
		let colour = 0;
		let at = y * stride;
		let x = 0;
		while (x < width) {
			let count = readRipInt(input);
			x += count;
			do {
				if (input.nextBit() > 0) {
					if (y > 0 && at + 4 <= output.length) {
						colour = output.readInt32LE(at - stride);
						if (colour !== 0) colour -= baseline;
					}
					packed = colour;
				} else {
					let g = 0;
					if (input.nextBit() > 0) g = readRipSigned(input);
					let blue = 0;
					if (input.nextBit() > 0) {
						const negative = input.nextBit() > 0;
						const value = table?.[readRipInt(input)] ?? 0;
						blue = negative ? -value : value;
					}
					let red = 0;
					if (input.nextBit() > 0) {
						const negative = input.nextBit() > 0;
						const value = table?.[readRipInt(input)] ?? 0;
						red = negative ? -value : value;
					}
					let gg = g;
					if (isBgr676) gg >>= 1;
					if (0 !== (info[3] ?? 0)) {
						// The places of a blue and of a red stand of the places of the colour in front of them:
						// the reference holds every one of them to the places of the green, of the count of the
						// places of it that stand of the colour.
						let place = ((0xff >> bShift) & (colour >>> bShift)) | 0;
						place = -place;
						let blueBase = place;
						if (gg >= place) {
							const limit = (0xff >> bShift) + place;
							blueBase = gg <= limit ? gg : limit;
						}
						blue += blueBase;
						place = ((0xff0000 >> rShift) & (colour >>> rShift)) | 0;
						place = -place;
						let redBase = place;
						if (gg >= place) {
							const limit = (0xff0000 >> rShift) + place;
							redBase = gg <= limit ? gg : limit;
						}
						red += redBase;
					} else {
						blue += gg;
						red += gg;
					}
					colour += (blue << bShift) + (red << rShift) + (g << gShift);
					packed = colour;
				}
				if (packed !== 0) packed += baseline;
				if (at + 4 <= output.length) output.writeInt32LE(packed | 0, at);
				at += PLACES_PER_COLOUR;
				count -= 1;
			} while (count > 0);
			if (x >= width) break;
			count = readRipInt(input);
			x += count;
			while (count > 0) {
				if (at + 4 <= output.length) output.writeInt32LE(packed | 0, at);
				at += PLACES_PER_COLOUR;
				count -= 1;
			}
		}
	}
	return output;
}

/** `CRip007.UncompressRgba`: the same of a picture of a place of an alpha, of the runs of it. */
function unpackRip007Rgba(run: Buffer, object: RipObject): Buffer {
	const info = object.compressInfo ?? Buffer.alloc(7, 0x00);
	const width = object.placeWidth;
	const height = object.placeHeight;
	const input = new RipBits(run);
	// The reference stands the places of this walk in the places of the picture of the class as they stand
	// of the places of the walk itself, of the places of the walk of the class as well: a picture of the
	// places of the class of the counts of it stands of the places of the picture that the walk names.
	const output = Buffer.alloc(
		object.width * object.height * PLACES_PER_COLOUR,
		0x00,
	);
	const stride = object.width * PLACES_PER_COLOUR;
	const q = info[0] ?? 0;
	const table = RIP_QUANT_TRANSFER[q] ?? RIP_QUANT_TRANSFER[0];
	const bBits = info[4] ?? 0;
	const gBits = info[5] ?? 0;
	const rBits = info[6] ?? 0;
	const bShift = 8 - bBits;
	const gShift = 16 - gBits;
	const rShift = 24 - rBits;
	const baseline =
		(0xff >> bBits) | (((0xff >> gBits) | ((0xff >> rBits) << 8)) << 8);
	const start = object.offsetY * stride + object.offsetX * PLACES_PER_COLOUR;
	const line = new Int32Array(width);
	for (let y = 0; y < height; y += 1) {
		let alpha = 0;
		let colour = 0;
		let repeatCount = 0;
		let repeat = true;
		let at = start + y * stride;
		let x = 0;
		let chunk = 0;
		while (x < width) {
			if (0 === chunk) {
				if (input.nextBit() > 0) alpha += readRipSigned(input);
				if (0 === alpha || 31 === alpha) chunk = readRipInt(input);
			}
			if (alpha !== 0) {
				if (31 === alpha) chunk -= 1;
				if (0 === repeatCount) {
					repeatCount = readRipInt(input);
					repeat = !repeat;
				}
				repeatCount -= 1;
				if (!repeat) {
					if (input.nextBit() > 0) {
						colour = line[x] ?? 0;
					} else {
						let g = 0;
						if (input.nextBit() > 0) g = readRipSigned(input);
						let blue = 0;
						if (input.nextBit() > 0) {
							const negative = input.nextBit() > 0;
							const value = table?.[readRipInt(input)] ?? 0;
							blue = negative ? -value : value;
						}
						let red = 0;
						if (input.nextBit() > 0) {
							const negative = input.nextBit() > 0;
							const value = table?.[readRipInt(input)] ?? 0;
							red = negative ? -value : value;
						}
						let place = ((0xff >> bShift) & (colour >>> bShift)) | 0;
						place = -place;
						let blueBase = place;
						if (g >= place) {
							const limit = (0xff >> bShift) + place;
							blueBase = g > limit ? limit : g;
						}
						blue += blueBase;
						place = ((0xff0000 >> rShift) & (colour >>> rShift)) | 0;
						place = -place;
						let redBase = place;
						if (g >= place) {
							const limit = (0xff0000 >> rShift) + place;
							redBase = g > limit ? limit : g;
						}
						red += redBase;
						colour += (blue << bShift) + (red << rShift) + (g << gShift);
					}
				}
				let pixel = (baseline + colour) >>> 0;
				pixel =
					31 === alpha
						? (pixel | 0xff000000) >>> 0
						: (pixel | ((alpha << 27) >>> 0)) >>> 0;
				if (at + 4 <= output.length) output.writeUInt32LE(pixel, at);
				at += PLACES_PER_COLOUR;
				if (x < line.length) line[x] = colour;
				x += 1;
			} else {
				at += PLACES_PER_COLOUR * chunk;
				x += chunk;
				chunk = 0;
			}
		}
	}
	return output;
}

/**
 * `CRip.Uncompress` and `CRip007.Uncompress`: the places of the picture, of the kind of the walk of it. The
 * kind 2 of the bit walks of the class `CRip` stands unported, and is refused here.
 */
export function unpackRip(object: RipObject, run: Buffer): Buffer {
	if (CLASS_RIP007 === object.className) {
		// The class stands of a walk of a colour and of a place of an alpha where the low place of the flags of
		// it names one, of the tables of the places of the colour behind both.
		const hasAlpha = 3 === object.kind;
		const places = hasAlpha
			? unpackRip007Rgba(run, object)
			: unpackRip007Rgb(run, object);
		return writeBmp32(object.width, object.height, places, false);
	}
	if (KIND_RUN === object.kind) {
		const places = unpackRipRun(run, object.width, object.height);
		// The palette of a picture of eight places of a grey stands of the walk of the project itself.
		return writeBmp8(object.width, object.height, places, false);
	}
	if (KIND_BITS === object.kind) {
		const input = new RipBits(run);
		if (1 === object.subKind) {
			// The walk of the reference fills the places of the picture of the last row of it up, which is the
			// turn of the walk of the bits rather than a picture of the other way: the places of every row
			// stand of the row itself, and the picture is handed out of the top of it down.
			return writeBmp32(
				object.placeWidth,
				object.placeHeight,
				unpackRipRgb1(input, object.placeWidth, object.placeHeight, false),
				false,
			);
		}
		if (3 === object.subKind) {
			return writeBmp32(
				object.placeWidth,
				object.placeHeight,
				unpackRipRgb1(input, object.placeWidth, object.placeHeight, true),
				false,
			);
		}
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`rUGP picture of the walk ${object.subKind} stands unported`,
		);
	}
	if (KIND_ALPHA === object.kind && 2 === object.subKind) {
		// The walk of the places of an alpha of the class stands of the *second* pair of the counts of the
		// head of it (the places of the walk), where the walks of the bits stand of the first pair: the
		// picture of this walk stands of the places of the walk of it, of the counts of the head behind them.
		return writeBmp32(
			object.width,
			object.height,
			unpackRipRgba(run, object.width, object.height),
			false,
		);
	}
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`rUGP picture of the walk ${object.kind}/${object.subKind} stands unported`,
	);
}

export const ripDescriptor: FormatDescriptor = {
	id: "rugp-rip-image",
	name: "rUGP compressed image",
	extensions: ["rip", "sia"],
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
			source: "ArcFormats/rUGP/ImageRIP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/rUGP/ArcRIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ripFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ripDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, _sourcePath: string): Promise<boolean> {
		if (source.size < 8n) return false;
		return (
			readRipObject(await source.readAt(0n, Number(source.size))) !== undefined
		);
	},
	async read(source: ByteSource, _sourcePath: string) {
		const data = await source.readAt(0n, Number(source.size));
		const object = readRipObject(data);
		if (!object) throw invalidPicture("Not a Purple picture");
		return {
			entries: [
				createFixedEntry({
					id: "0",
					path: "image.bmp",
					offset: 0n,
					size: source.size,
					metadata: {
						width: object.width,
						height: object.height,
						bitsPerPixel: object.bitsPerPixel,
						kind: object.kind,
						subKind: object.subKind,
						className: object.className,
					},
				}),
			],
			metadata: {
				width: object.width,
				height: object.height,
				bitsPerPixel: object.bitsPerPixel,
				kind: object.kind,
				subKind: object.subKind,
				className: object.className,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath: string) {
		const data = await source.readAt(0n, Number(source.size));
		const object = readRipObject(data);
		if (!object) throw invalidPicture("Not a Purple picture");
		// The run of the walk of either class stands behind the head of the object, of the counts of the
		// places of it that the head itself stands.
		const run = data.subarray(object.runAt, object.runAt + object.runSize);
		return Readable.from([unpackRip(object, run)]);
	},
});
