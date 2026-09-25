// Format reference: GARbro "Legacy/Mink/ImageFD.cs", classes `FdFormat` and the `FdReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head stands of the four words of the marks of the picture and of the places of it. */
const HEAD_SIZE = 16;
/** The picture opens with `FD`, the case of the second letter standing of either way. */
const FIRST_LETTER = 0x46;
const SECOND_LETTER = 0x44;
const LETTER_MASK = 0x5f;
const BITS_FIELD = 2;
const FLAG_FIELD = 3;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const BITS_24 = 24;
const BITS_32 = 32;
const PLACE_SIZE = 4;
/** The places of the picture a walk of it stands of, in the order of the colours of the reference. */
const OFFSETS_X = [
	-1, 0, 1, -1, 0, -2, 0, -3, 0, -4, 0, -5, 0, -6, 0, -7, 0, -8,
] as const;
const OFFSETS_Y = [
	0, -1, -1, -1, -2, 0, -3, 0, -4, 0, -5, 0, -6, 0, -7, 0, -8, 0,
] as const;
const OFFSET_COUNT = 18;
/**
 * The walk of the places of the file stands of the numbers of the controls of it, and the numbers of the
 * controls stand of the walk of them: the reference writes the second of those as its own list.
 */
const CONTROL_MAP = [
	2, 1, 0, 3, 4, 5, 10, 11, 12, 13, 14, 15, 22, 23, 24, 25, 26, 27, 28, 29, 6,
	8, 7, 9, 16, 17, 18, 19, 20, 21, 30, 31, 32, 33, 34, 35, 36, 37,
] as const;
const CONTROL_COUNT = 38;
const LIMIT = 256 * 1024 * 1024;

export interface FdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flag: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `FdFormat.ReadMetaData`: the head of the picture, which opens with `FD` of either case. */
export function readFdLayout(data: Buffer): FdLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (FIRST_LETTER !== data[0]) return undefined;
	if (SECOND_LETTER !== ((data[1] ?? 0) & LETTER_MASK)) return undefined;
	const flag = data[FLAG_FIELD] ?? 0;
	if (flag > 1) return undefined;
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (BITS_24 !== bitsPerPixel && BITS_32 !== bitsPerPixel) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT) return undefined;
	return { width, height, bitsPerPixel, flag };
}

/** The three heads the reference registers as its signatures; the fourth of them stands of no bits. */
export function fdSignatures(): readonly { bytes: Uint8Array }[] {
	return [
		{ bytes: Uint8Array.from([FIRST_LETTER, 0x64, 0x18, 0x00]) },
		{ bytes: Uint8Array.from([FIRST_LETTER, SECOND_LETTER, 0x18, 0x00]) },
		{ bytes: Uint8Array.from([FIRST_LETTER, 0x64, 0x20, 0x00]) },
	];
}

/** A byte as the reference keeps it, as a place of eight bits, the top of them the sign. */
function signedByte(value: number): number {
	const byte = value & 0xff;
	return byte >= 0x80 ? byte - 0x100 : byte;
}

/**
 * `FdReader`'s own static walk: the numbers of the controls of the file, one for each place of a walk of
 * the picture. The number of a control stands of the walk of the places of the file, and the number of
 * the control of the last of them is its own.
 */
function buildControlTable(): Uint8Array {
	const table = new Uint8Array(CONTROL_COUNT);
	for (let at = 0; at < CONTROL_COUNT; at += 1) {
		if (1 === at) table[1] = CONTROL_COUNT;
		else table[CONTROL_MAP[at] ?? 0] = at;
	}
	return table;
}

interface FdFlowMaps {
	one: Uint8Array;
	two: Uint8Array;
	three: Uint8Array;
	four: Uint8Array;
	five: Uint8Array;
}

/**
 * `FdReader`'s own static walk: the five walks of the numbers of a byte of the stream. The walks stand of
 * the counts of the places of the eight bits of a byte before the first of them stands, of the counts of
 * the places behind it, and of the counts of the places of the value itself.
 */
function buildFlowMaps(): FdFlowMaps {
	const one = new Uint8Array(256);
	const two = new Uint8Array(256);
	const three = new Uint8Array(256);
	const four = new Uint8Array(256);
	const five = new Uint8Array(256);
	for (let at = 0; at < 256; at += 1) {
		let value = signedByte(at);
		let count = 0;
		if (at > 0) {
			while (value < 0) {
				value = signedByte(value << 1);
				count += 1;
			}
			value = signedByte(value << 1);
			if (0 === value) count -= 1;
		}
		one[at] = value & 0xff;
		three[at] = count + 1;
		value = signedByte(at);
		count = 0;
		if (at > 0) {
			while (value < 0) {
				value = signedByte(value << 1);
				count += 1;
			}
			value = signedByte(value << 1);
		}
		four[at] = count;
		two[at] = (value + (1 << count)) & 0xff;
		value = signedByte(at);
		count = 0;
		while (0 !== (value & 0x7f)) {
			value = signedByte(value << 1);
			count += 1;
		}
		five[at] = count;
	}
	return { one, two, three, four, five };
}

const CONTROL_TABLE = buildControlTable();
const FLOW = buildFlowMaps();

/**
 * `FdReader.ReadNext`: the number of the next control, read from the bits of the stream one run at a time.
 * The place of the last byte read stands of the walks of the reference: `m_cur_bits` here, and the words
 * of it are signed where the reference holds them as such.
 */
class FdReader {
	bits = 0x80;
	private at: number;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	/** One byte of the stream; the reference reads past the end of a short file without a word of its own. */
	byte(): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				"The walk of the places of the picture stands past the end of the file of it",
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	readNext(): number {
		let shift = FLOW.three[this.bits] ?? 0;
		this.bits = FLOW.one[this.bits] ?? 0;
		if (0 === this.bits) {
			do {
				this.bits = this.byte();
				shift += FLOW.four[this.bits] ?? 0;
			} while (0 === FLOW.two[this.bits]);
			this.bits = FLOW.two[this.bits] ?? 0;
		}
		let value = this.bits + 256;
		const limit = FLOW.five[this.bits] ?? 0;
		if (shift > limit) {
			value = ((value << limit) & ~0xff) | 0;
			value = (value + this.byte()) | 0;
			shift -= limit + 1;
			if (shift >= 8) {
				let count = shift >> 3;
				shift -= count << 3;
				do {
					value = (value + this.byte()) | 0;
					value = (value << 8) | 0;
					count -= 1;
				} while (count > 0);
			}
			value = (value << 1) | 1 | 0;
			shift &= 0xff;
		}
		value = (value << shift) | 0;
		this.bits = value & 0xff;
		return value >> 8;
	}
}

/** The walk of the places of a picture stands of the numbers of its controls and of no others. */
function controlOf(ctl: number): number {
	const at = ctl - 2;
	if (at < 0 || at >= CONTROL_COUNT) {
		throw invalidPicture(
			"The walk of the places of the picture names no control of the file",
		);
	}
	return CONTROL_TABLE[at] ?? 0;
}

/** The places of the picture the walk of it stands of; the reference reads past a short picture. */
function placeOf(places: Uint32Array, at: number): number {
	if (at < 0 || at >= places.length) {
		throw invalidPicture(
			"The walk of the places of the picture stands past the places of it",
		);
	}
	return places[at] ?? 0;
}

/**
 * `FdReader.UnpackRgb`: the places of the colours of the picture. A control stands of a place of its own
 * (the first two of them, read one place at a time from three bytes of the stream), of a place read from
 * the place before it or from the place above it (the numbers of the controls behind those two stand of
 * the walks of the colours of it), or of a run of places read from the places of the picture itself.
 */
function unpackFdRgb(
	places: Uint32Array,
	layout: FdLayout,
	reader: FdReader,
): void {
	const offsets = new Int32Array(OFFSET_COUNT);
	for (let at = 0; at < OFFSET_COUNT; at += 1) {
		offsets[at] = (OFFSETS_X[at] ?? 0) + layout.width * (OFFSETS_Y[at] ?? 0);
	}
	let dst = 0;
	reader.bits = 0x80;
	while (dst < places.length) {
		const code = controlOf(reader.readNext());
		if (code < 20) {
			if (code < 2) {
				const was = reader.bits;
				let pixel = (reader.byte() << 24) >>> 0;
				pixel = (pixel + (reader.byte() << 16)) >>> 0;
				pixel = (pixel + (reader.byte() << 8)) >>> 0;
				pixel = (pixel ^ 0x80000080) >>> 0;
				pixel = pixel >>> (FLOW.five[was] ?? 0);
				places[dst] = ((pixel >>> 8) ^ ((was << 16) >>> 0)) >>> 0;
				dst += 1;
				reader.bits = pixel & 0xff;
			} else {
				let pixel = placeOf(places, dst + (offsets[code - 2] ?? 0)) | 0;
				const r = reader.readNext();
				pixel = (pixel + (((r - 2) << 15) ^ -((r & 1) << 15))) | 0;
				const g = reader.readNext();
				pixel = (pixel + (((g - 2) << 7) ^ -((g & 1) << 7))) | 0;
				const b = reader.readNext();
				places[dst] = ((((b - 2) ^ -(b & 1)) >> 1) + pixel) >>> 0;
				dst += 1;
			}
		} else {
			const y = reader.readNext();
			const x = reader.readNext();
			let src =
				dst +
				(((y & 1) - 1) ^ (x - 2)) -
				layout.width * ((y >> 1) + (y & 1) - 1);
			let count = reader.readNext() - 1;
			if (CONTROL_COUNT === code) {
				while (count > 0 && dst < places.length) {
					places[dst] = placeOf(places, src);
					dst += 1;
					src += 1;
					count -= 1;
				}
			} else {
				const offset = offsets[code - 20] ?? 0;
				while (count > 0 && dst < places.length) {
					places[dst] =
						(placeOf(places, src) +
							placeOf(places, dst + offset) -
							placeOf(places, src + offset)) >>>
						0;
					dst += 1;
					src += 1;
					count -= 1;
				}
			}
		}
	}
}

/** `FdReader.UnpackAlpha`: the place of the alpha of each place of the picture, read as a run of its own. */
function unpackFdAlpha(places: Uint32Array, reader: FdReader): void {
	let dst = 0;
	while (dst < places.length) {
		let shift = 8 - (FLOW.five[reader.bits] ?? 0);
		let ctl: number;
		let alpha: number;
		if (shift <= 0) {
			alpha = reader.bits;
			ctl = 0;
		} else {
			ctl = reader.bits >>> shift;
			if (shift > 8) {
				let count = ((shift - 9) >> 3) + 1;
				do {
					ctl = (((ctl << 8) >>> 0) + reader.byte()) >>> 0;
					shift -= 8;
					count -= 1;
				} while (count > 0);
			}
			reader.bits = reader.byte();
			alpha = (((ctl << shift) >>> 0) + (reader.bits >>> (8 - shift))) >>> 0;
			ctl = (ctl & ~0xff) >>> 0;
			ctl =
				(ctl |
					((((reader.bits << shift) >>> 0) + (1 << (shift - 1))) & 0xff)) >>>
				0;
		}
		reader.bits = ctl & 0xff;
		let walk = FLOW.three[reader.bits] ?? 0;
		reader.bits = FLOW.one[reader.bits] ?? 0;
		if (0 === reader.bits) {
			do {
				reader.bits = reader.byte();
				walk += FLOW.four[reader.bits] ?? 0;
			} while (0 === FLOW.two[reader.bits]);
			reader.bits = FLOW.two[reader.bits] ?? 0;
		}
		const limit = FLOW.five[reader.bits] ?? 0;
		let count: number;
		let bits: number;
		if (walk <= limit) {
			count = (reader.bits + 256) >> (8 - walk);
			bits = reader.bits << walk;
		} else {
			let extra = walk - limit;
			let wide = (reader.bits + 256) >> (8 - limit);
			if (extra > 8) {
				let rounds = ((extra - 9) >>> 3) + 1;
				extra -= rounds << 3;
				do {
					wide = reader.byte() + (wide << 8);
					rounds -= 1;
				} while (rounds > 0);
			}
			reader.bits = reader.byte();
			count = (((wide << extra) >>> 0) + (reader.bits >>> (8 - extra))) >>> 0;
			bits = (reader.bits << extra) + (1 << (extra - 1));
		}
		reader.bits = bits & 0xff;
		let run = Math.min(count - 1, places.length - dst);
		const alphaBits = (alpha << 24) >>> 0;
		while (run > 0) {
			places[dst] = (((places[dst] ?? 0) & 0xffffff) | alphaBits) >>> 0;
			dst += 1;
			run -= 1;
		}
	}
}

/** `FdReader.Unpack`: the places of the picture, read as the head names them, handed over the right way up. */
export function unpackFdPicture(data: Buffer, layout: FdLayout): Buffer {
	const places = new Uint32Array(layout.width * layout.height);
	const reader = new FdReader(data, HEAD_SIZE);
	unpackFdRgb(places, layout, reader);
	if (BITS_32 === layout.bitsPerPixel) unpackFdAlpha(places, reader);
	// The reference hands the picture over as a place of four bytes to a pixel, the last of them the alpha
	// of the picture, and stands it the other way up from the places it read.
	const pixels: Buffer = Buffer.alloc(places.length * PLACE_SIZE, 0x00);
	for (let at = 0; at < places.length; at += 1) {
		pixels.writeUInt32LE(places[at] ?? 0, at * PLACE_SIZE);
	}
	return writeBmp32(layout.width, layout.height, pixels, true);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const fdImageDescriptor: FormatDescriptor = {
	id: "mink-fd-image",
	name: "Mink compressed bitmap",
	extensions: ["fd"],
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
			source: "Legacy/Mink/ImageFD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fdImageDescriptor,
	detection: { signatures: fdSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readFdLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readFdLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Mink engine");
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
					flag: layout.flag,
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readFdLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Mink engine");
		return Readable.from([unpackFdPicture(data, layout)]);
	},
});
