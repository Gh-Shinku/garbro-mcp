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

const SIGNATURE = Buffer.from("a4cbf629", "hex");
/** The two classes of the picture of the engine. */
const CLASS_RIP = "CRip";
const CLASS_RIP007 = "CRip007";
/** The places of the head of an object of the class `CRip`, and of the class `CRip007`. */
const RIP_PLACES = 0x14;
const RIP007_PLACES = 8;
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
		if (objectAt + RIP007_PLACES > data.length) return undefined;
		const width = data.readUInt16LE(objectAt + 4);
		const height = data.readUInt16LE(objectAt + 6);
		if (0 === width || 0 === height) return undefined;
		return {
			className,
			objectAt,
			width,
			height,
			placeWidth: width,
			placeHeight: height,
			offsetX: 0,
			offsetY: 0,
			kind: 0,
			subKind: 0,
			bitsPerPixel: 32,
			runAt: objectAt,
			runSize: 0,
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

/**
 * `CRip.Uncompress`: the places of the picture, of the kind of the walk of it. The walks of the class
 * `CRip007` and the kind 2 of the bit walks of the class `CRip` stand unported, and are refused here.
 */
export function unpackRip(object: RipObject, run: Buffer): Buffer {
	if (CLASS_RIP007 === object.className) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"rUGP picture of the class CRip007 stands unported",
		);
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
		return writeBmp32(
			object.placeWidth,
			object.placeHeight,
			unpackRipRgba(run, object.placeWidth, object.placeHeight),
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
		if (CLASS_RIP === object.className) {
			const run = data.subarray(object.runAt, object.runAt + object.runSize);
			return Readable.from([unpackRip(object, run)]);
		}
		// The walk of the class `CRip007` stands unported, and `unpackRip` refuses it.
		return Readable.from([unpackRip(object, data)]);
	},
});
