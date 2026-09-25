// Format reference: GARbro "Legacy/Nekotaro/ImageGCmp.cs", classes `GCmpFormat`, `GCmpDecoder` and
// the `DefaultPalette` beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp1, writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { GCMP_PALETTE } from "./gcmp-palette.js";

const HEAD_SIZE = 0x10;
const DATA_AT = 0x10;
const BITS_24 = 24;
const BITS_8 = 8;
const BITS_1 = 1;
const BYTE = 0xff;
const NIBBLE = 0x0f;
/** The letters `GCmp` of the head of the picture of the engine. */
const MARK = [0x47, 0x43, 0x6d, 0x70];
/** The places of the file of the frame of the walk of the twenty four places of a colour of it. */
const FRAME_PLACES = 128;
const FRAME_BYTES = FRAME_PLACES * 3;
const FRAME_LAST = 127;
/** The places of the file of the frame of the walk of the eight places of the colour of it. */
const FRAME8_NEW = 14;
const FRAME8 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0xff];
const RUN_SMALL = 0x10;
const RUN_MEDIUM = 0x120;
const RUN_LARGE = 0x10130;
const RUN_AT = 10;
const RUN_AT_MEDIUM = 11;
const RUN_AT_LARGE = 12;
const RUN_AT_EXTRA_SMALL = 13;
const RUN_AT_EXTRA_MEDIUM = 14;
const RUN_AT_EXTRA_LARGE = 15;
const RUN_SHORT = 13;
const RUN_BASE_SMALL = 11;
const RUN_BASE_MEDIUM = 267;
const RUN_BASE_LARGE = 65803;
const MAX_SIDE = 0x10000;

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

/** The head of a picture of the engine, of the walk of the places of the file of it. */
export interface GcmpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** `format > 0`: the places of the file of the picture stand of the walk of the engine. */
	compressed: boolean;
}

/** `GCmpFormat.ReadMetaData`: the head of a picture of the engine. */
export function readGcmpLayout(data: Buffer): GcmpLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!MARK.every((value, index) => data[index] === value)) return undefined;
	const format = ((data[12] ?? 0) << 24) >> 24;
	const bitsPerPixel = Math.abs(format);
	if (
		BITS_24 !== bitsPerPixel &&
		BITS_8 !== bitsPerPixel &&
		BITS_1 !== bitsPerPixel
	) {
		return undefined;
	}
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(10);
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return { width, height, bitsPerPixel, compressed: format > 0 };
}

/** The walk of the places of the file of a picture of the engine, of the places of the file of it. */
class Walker {
	at = DATA_AT;

	constructor(private readonly data: Buffer) {}

	/** `GCmpDecoder`'s `m_input.ReadUInt8`, of the places of the file of the walk of the engine. */
	place(): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	/** `IBinaryStream.ReadUInt16`. */
	place16(): number {
		const low = this.place();
		const high = this.place();
		return low | (high << 8);
	}

	/** `IBinaryStream.ReadInt24`: the places of the file of a colour of a place of the picture. */
	place24(): number {
		const low = this.place();
		const mid = this.place();
		const high = this.place();
		return (low | (mid << 8) | (high << 16)) >>> 0;
	}

	/** `IBinaryStream.ReadInt32`. */
	place32(): number {
		let value = 0;
		for (let at = 0; at < 4; at += 1) {
			value |= this.place() << (8 * at);
		}
		return value >>> 0;
	}
}

/**
 * `GCmpDecoder.Unpack24bpp`: the places of the file of a picture of the twenty four places of a colour
 * of the engine, of the frame of the walk of the engine of the 128 places of the file of the colour of
 * it.
 */
export function unpackGcmp24bpp(data: Buffer, layout: GcmpLayout): Buffer {
	const walker = new Walker(data);
	const count = layout.width * layout.height;
	const output = Buffer.alloc(count * 3 + 1, 0);
	const frame = new Uint8Array(FRAME_BYTES);
	let dst = 0;
	let left = count;
	let chunk = 0;
	while (left > 0) {
		let pixel: number;
		let places: number;
		let times: number;
		if (chunk !== 0) {
			pixel = walker.place24();
			times = 1;
			places = FRAME_LAST;
			chunk -= 1;
		} else {
			times = walker.place();
			const low = times & 0x1f;
			if (0 !== (times & 0x80)) {
				times = (times >> 5) & 3;
				if (times !== 0) {
					places = low;
				} else {
					times = low << 1;
					places = walker.place();
					if (0 !== (places & 0x80)) times += 1;
					places &= 0x7f;
				}
				if (0 === times) times = walker.place32();
				if (places >= FRAME_PLACES) {
					throw invalidPicture(
						"A picture of the engine of the places of the frame of the walk of it",
					);
				}
				const at = 3 * places;
				pixel =
					(frame[at] ?? 0) |
					((frame[at + 1] ?? 0) << 8) |
					((frame[at + 2] ?? 0) << 16);
			} else {
				if (1 === times) {
					chunk = walker.place() - 1;
				} else if (0 === times) {
					times = walker.place32();
				}
				pixel = walker.place24();
				places = FRAME_LAST;
			}
		}
		if (times > left) times = left;
		left -= times;
		output[dst] = pixel & BYTE;
		output[dst + 1] = (pixel >> 8) & BYTE;
		output[dst + 2] = (pixel >> 16) & BYTE;
		dst += 3;
		const repeat = times - 1;
		if (repeat > 0) {
			const placesToCopy = repeat * 3;
			copyOverlapped(output, dst - 3, dst, placesToCopy);
			dst += placesToCopy;
		}
		if (places !== 0) {
			frame.copyWithin(3, 0, 3 * places);
		}
		frame[0] = pixel & BYTE;
		frame[1] = (pixel >> 8) & BYTE;
		frame[2] = (pixel >> 16) & BYTE;
	}
	return output.subarray(0, count * 3);
}

/**
 * `GCmpDecoder.Unpack8bpp`: the places of the file of a picture of the eight places of a colour of the
 * engine (or of one of them), of the frame of the walk of the engine of the fifteen places of the file
 * of the colour of it.
 */
export function unpackGcmp8bpp(
	data: Buffer,
	layout: GcmpLayout,
	stride: number,
): Buffer {
	const walker = new Walker(data);
	const count = layout.height * stride;
	if (!layout.compressed) {
		if (DATA_AT + count > data.length) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		return Buffer.from(data.subarray(DATA_AT, DATA_AT + count));
	}
	const output = Buffer.alloc(count, 0);
	const frame = Uint8Array.from(FRAME8);
	let dst = 0;
	let left = count;
	let times = count;
	let extra = count;
	while (left > 0) {
		const control = walker.place();
		const high = control >> 4;
		const low = control & NIBBLE;
		let pixel: number;
		let places: number;
		if (high !== 0) {
			places = high - 1;
			pixel = frame[places] ?? 0;
			times = low + 1;
		} else {
			times = low + 1;
			if (RUN_AT === low) {
				times = walker.place() + RUN_BASE_SMALL;
			} else if (RUN_AT_MEDIUM === low) {
				times = walker.place16() + RUN_BASE_MEDIUM;
			} else if (RUN_AT_LARGE === low) {
				times = walker.place32() + RUN_BASE_LARGE;
			} else if (RUN_AT_EXTRA_SMALL === low) {
				extra = RUN_SMALL;
				times = walker.place();
			} else if (RUN_AT_EXTRA_MEDIUM === low) {
				extra = RUN_MEDIUM;
				times = walker.place16();
			} else if (RUN_AT_EXTRA_LARGE === low) {
				extra = RUN_LARGE;
				times = walker.place32();
			}
			pixel = walker.place();
			if (low < RUN_SHORT) {
				places = FRAME8_NEW;
			} else {
				const placesPlace = pixel & NIBBLE;
				places = (pixel >> 4) - 1;
				pixel = frame[places] ?? 0;
				times = extra + 16 * times + placesPlace + 1;
			}
		}
		if (times > left) times = left;
		left -= times;
		output.fill(pixel & BYTE, dst, dst + times);
		dst += times;
		if (places >= 0) frame.copyWithin(1, 0, places);
		frame[0] = pixel & BYTE;
	}
	return output;
}

/** The places of the file of the table of the colours of the engine, of the four of a colour. */
function paletteOf(): Buffer {
	const palette: Buffer = Buffer.alloc(GCMP_PALETTE.length * 4, 0);
	for (let at = 0; at < GCMP_PALETTE.length; at += 1) {
		const colour = GCMP_PALETTE[at] ?? [0, 0, 0];
		palette[at * 4] = colour[2] ?? 0;
		palette[at * 4 + 1] = colour[1] ?? 0;
		palette[at * 4 + 2] = colour[0] ?? 0;
	}
	return palette;
}

/** `GCmpDecoder.Unpack`: the picture of the engine, handed over as the places of the file of a BMP. */
export function unpackGcmpPicture(data: Buffer, layout: GcmpLayout): Buffer {
	if (BITS_24 === layout.bitsPerPixel) {
		return writeBmp24(
			layout.width,
			layout.height,
			unpackGcmp24bpp(data, layout),
			true,
		);
	}
	const stride =
		BITS_1 === layout.bitsPerPixel ? (layout.width + 7) >> 3 : layout.width;
	const places = unpackGcmp8bpp(data, layout, stride);
	if (BITS_8 === layout.bitsPerPixel) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			places,
			paletteOf(),
			true,
		);
	}
	// `GCmpDecoder.Unpack8bpp` of the picture of one place of a colour of the engine stands of the
	// places of the file of the *two* of them alone: the places of the file of the walk of the picture
	// of the engine of the two places of the file of the colour of it.
	const places8: Buffer = Buffer.alloc(8, 0);
	places8[4] = BYTE;
	places8[5] = BYTE;
	places8[6] = BYTE;
	return writeBmp1(layout.width, layout.height, places, places8, true);
}

export const gcmpImageDescriptor: FormatDescriptor = {
	id: "nekotaro-gcmp-image",
	name: "Nekotaro Game System image",
	extensions: ["gcmp", "aig"],
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
			source: "Legacy/Nekotaro/ImageGCmp.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gcmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gcmpImageDescriptor,
	detection: {
		signatures: [{ bytes: new Uint8Array(MARK) }],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readGcmpLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readGcmpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Nekotaro engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: layout.compressed,
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGcmpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Nekotaro engine");
		return Readable.from([unpackGcmpPicture(data, layout)]);
	},
});
