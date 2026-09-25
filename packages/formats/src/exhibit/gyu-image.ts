// Port of GARbro "ArcFormats/ExHibit/ImageGYU.cs" (tag "GYU", class GyuFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The image is obfuscated with a key that the
// reference asks the user for when the file carries none (key 0).

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MersenneTwister, inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";

const SIGNATURE = 0x1a555947; // 'GYU\x1a' read as a little endian word
const MARK = Buffer.from([0x47, 0x59, 0x55, 0x1a]);
const HEAD_SIZE = 0x24;
const MAX_COLORS = 0x100;
/** The key that tells the picture stands unobfuscated. */
const NO_KEY = 0xffffffff;
const RAW_MODE = 0x0100;
const GYU_MODE = 0x0800;

export interface GyuLayout {
	flags: number;
	compressionMode: number;
	key: number;
	bitsPerPixel: number;
	width: number;
	height: number;
	dataSize: number;
	alphaSize: number;
	paletteSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GyuFormat.ReadMetaData`: the head of the picture, from the fourth byte on. */
export function readGyuLayout(data: Buffer): GyuLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (SIGNATURE !== data.readUInt32LE(0)) return undefined;
	return {
		flags: data.readUInt16LE(4),
		compressionMode: data.readUInt16LE(6),
		key: data.readUInt32LE(8),
		bitsPerPixel: data.readInt32LE(0xc),
		width: data.readUInt32LE(0x10),
		height: data.readUInt32LE(0x14),
		dataSize: data.readInt32LE(0x18),
		alphaSize: data.readInt32LE(0x1c),
		paletteSize: data.readInt32LE(0x20),
	};
}

/** `GyuReader.Deobfuscate`: ten swaps of two places, named by the twister the key seeds. */
function deobfuscate(data: Buffer, key: number): void {
	const twister = new MersenneTwister(key);
	for (let at = 0; at < 10; at += 1) {
		const first = twister.rand() % data.length;
		const second = twister.rand() % data.length;
		const place = data[first] ?? 0;
		data[first] = data[second] ?? 0;
		data[second] = place;
	}
}

/**
 * `GyuReader.UnpackGyu`: runs over a stream of bytes and bits that stand of the same places. A byte read
 * between two runs of bits comes from behind the byte the bits came from.
 */
function unpackGyuRuns(packed: Buffer, output: Buffer): boolean {
	let at = 4; // the reference reads the packed places from the fifth one on
	let destination = 0;
	let cache = 0;
	let cached = 0;

	const nextByte = (): number => {
		const value = packed[at] ?? 0;
		at += 1;
		return value;
	};
	const nextBit = (): number => {
		if (0 === cached) {
			cache = nextByte();
			cached = 8;
		}
		cached -= 1;
		return (cache >> cached) & 1;
	};
	const nextBits = (count: number): number => {
		let value = 0;
		for (let bit = 0; bit < count; bit += 1) value = (value << 1) | nextBit();
		return value;
	};

	if (0 === output.length) return true;
	output[destination] = nextByte();
	destination += 1;
	while (destination < output.length) {
		if (1 === nextBit()) {
			output[destination] = nextByte();
			destination += 1;
			continue;
		}
		let count: number;
		let offset: number;
		if (1 === nextBit()) {
			count = (nextByte() << 8) | nextByte();
			offset = (-1 << 13) | (count >>> 3);
			count &= 7;
			if (0 !== count) {
				count += 1;
			} else {
				count = nextByte();
				if (0 === count) break;
			}
		} else {
			count = 1 + nextBits(2);
			offset = (-1 << 8) | nextByte();
		}
		count += 1;
		copyOverlapped(output, destination + offset, destination, count);
		destination += count;
	}
	return true;
}

/** The rows of a picture, drawn together from the padded stride of the stored places. */
function unpadRows(
	packed: Buffer,
	stride: number,
	width: number,
	height: number,
	bytesPerPixel: number,
): Buffer {
	const tight: Buffer = Buffer.alloc(width * bytesPerPixel * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		packed.copy(
			tight,
			row * width * bytesPerPixel,
			row * stride,
			row * stride + width * bytesPerPixel,
		);
	}
	return tight;
}

/** `GyuReader`: the places of the picture, the walks of its colours and the alpha behind them. */
export function unpackGyuPicture(data: Buffer, layout: GyuLayout): Buffer {
	if (0 === layout.width || 0 === layout.height) {
		throw invalidPicture("The picture stands of no places of its own");
	}
	const stride = ((layout.width * layout.bitsPerPixel) / 8 + 3) & ~3;
	if (
		0 === layout.alphaSize &&
		8 !== layout.bitsPerPixel &&
		24 !== layout.bitsPerPixel &&
		32 !== layout.bitsPerPixel
	) {
		throw invalidPicture(
			"The picture stands of a depth of places this project does not read",
		);
	}
	if (8 === layout.bitsPerPixel && 0 === layout.paletteSize) {
		throw invalidPicture(
			"The picture stands of eight places to a place and of no colours of its own",
		);
	}
	if (layout.paletteSize > MAX_COLORS) {
		throw invalidPicture(
			"The picture stands of more colours than a picture of this project may",
		);
	}
	let at = HEAD_SIZE;
	const palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
	if (0 !== layout.paletteSize) {
		const places = layout.paletteSize * 4;
		if (at + places > data.length)
			throw invalidPicture(
				"The colours of the picture stand short of the file",
			);
		data.copy(palette, 0, at, at + places);
		at += places;
	}
	if (layout.dataSize < 0 || at + layout.dataSize > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	const packed: Buffer = Buffer.from(data.subarray(at, at + layout.dataSize));
	at += layout.dataSize;
	if (NO_KEY !== layout.key) deobfuscate(packed, layout.key);

	const outputSize = stride * layout.height;
	let picture: Buffer;
	if (RAW_MODE === layout.compressionMode) {
		if (packed.length !== outputSize) {
			throw invalidPicture(
				"The places of the picture stand of another count than its head names",
			);
		}
		picture = packed;
	} else if (GYU_MODE === layout.compressionMode) {
		picture = Buffer.alloc(outputSize, 0x00);
		unpackGyuRuns(packed, picture);
	} else {
		picture = inflateLzssAll(packed, {});
		if (picture.length !== outputSize) {
			throw invalidPicture(
				"The places of the picture stand of fewer walks than its head names",
			);
		}
	}

	if (0 === layout.alphaSize) {
		if (8 === layout.bitsPerPixel) {
			// The rows of an eight place picture stand of the stride of the walks of it already.
			return writeBmp8Palette(
				layout.width,
				layout.height,
				picture,
				palette,
				true,
			);
		}
		if (24 === layout.bitsPerPixel) {
			return writeBmp24(
				layout.width,
				layout.height,
				unpadRows(picture, stride, layout.width, layout.height, 3),
				true,
			);
		}
		return writeBmp32(
			layout.width,
			layout.height,
			unpadRows(picture, stride, layout.width, layout.height, 4),
			true,
		);
	}

	// `GyuReader.ReadAlpha`: the alpha stands behind the places of the colours, either as it reads or as
	// the walks of the engine stand of it, and every place of it stands behind a place of the picture.
	const alphaStride = (layout.width + 3) & ~3;
	const alphaLength = alphaStride * layout.height;
	let alpha: Buffer;
	if (layout.alphaSize === alphaLength) {
		if (at + alphaLength > data.length)
			throw invalidPicture("The alpha of the picture stands short of the file");
		alpha = data.subarray(at, at + alphaLength);
	} else {
		alpha = inflateLzssAll(data.subarray(at), {});
		if (alpha.length < alphaLength)
			throw invalidPicture("The alpha of the picture stands short of the file");
	}
	const extend = 3 !== layout.flags;
	const pixels: Buffer = Buffer.alloc(layout.width * 4 * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		let source = row * stride;
		let destination = row * layout.width * 4;
		for (let column = 0; column < layout.width; column += 1) {
			if (8 === layout.bitsPerPixel) {
				const color = picture[source] ?? 0;
				source += 1;
				pixels[destination] = palette[color * 4] ?? 0;
				pixels[destination + 1] = palette[color * 4 + 1] ?? 0;
				pixels[destination + 2] = palette[color * 4 + 2] ?? 0;
			} else {
				pixels[destination] = picture[source] ?? 0;
				pixels[destination + 1] = picture[source + 1] ?? 0;
				pixels[destination + 2] = picture[source + 2] ?? 0;
				source += 3;
			}
			let value = alpha[row * alphaStride + column] ?? 0;
			if (extend) value = value >= 0x10 ? 0xff : value * 0x10;
			pixels[destination + 3] = value;
			destination += 4;
		}
	}
	return writeBmp32(layout.width, layout.height, pixels, true);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const exhibitGyuImageDescriptor: FormatDescriptor = {
	id: "exhibit-gyu-image",
	name: "ExHIBIT engine image",
	extensions: ["gyu", "lvg"],
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
			source: "ArcFormats/ExHibit/ImageGYU.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const exhibitGyuImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: exhibitGyuImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return SIGNATURE === (await readStored(source)).readUInt32LE(0);
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGyuLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the ExHIBIT engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				encrypted: NO_KEY !== layout.key,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					compressionMode: layout.compressionMode,
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
		const layout = readGyuLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the ExHIBIT engine");
		if (0 === layout.key) {
			// The reference asks the user for the key of the game the picture stands of.
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"The picture carries no key of its own and this project has none to stand of",
			);
		}
		return Readable.from([unpackGyuPicture(data, layout)]);
	},
});
