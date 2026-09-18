// Format reference: GARbro "Legacy/Unknown/ImageCTF.cs", classes `CtfFormat`, `CtfMetaData` and `CtfReader`
// (an unnamed engine's picture of three or four planes, behind the engine's own LZSS and a run walk).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'CTFF', the word the reference registers. */
const SIGNATURE = Buffer.from("CTFF", "latin1");
const HEADER_SIZE = 0x28;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x06;
const UNPACKED_SIZE_FIELD = 0x0c;
const RED_OFFSET_FIELD = 0x10;
const GREEN_OFFSET_FIELD = 0x14;
const BLUE_OFFSET_FIELD = 0x18;
const ALPHA_OFFSET_FIELD = 0x1c;
const DEPTH_FIELD = 0x20;
const COMPRESSED_FIELD = 0x22;
const DEPTH = 24;
/** The stream of the engine's own LZSS stands here, and the run walk's own head behind it. */
const STREAM_OFFSET = 0x48;
const RUN_HEADER_SIZE = 0x18;
const COUNT_LIMIT_FIELD = 5;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CtfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The row of the picture, which is the width in bytes rounded up to four. */
	stride: number;
	unpackedSize: number;
	redOffset: number;
	greenOffset: number;
	blueOffset: number;
	alphaOffset: number;
	compressed: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CtfFormat.ReadMetaData`: the word `CTFF`, the width and the height at four and six as words, the size of
 * the planes at twelve, the places of the red, the green, the blue and the alpha plane from sixteen, and the
 * depth at `0x20` — which has to be twenty four bits, whether the alpha plane stands behind it or not. A
 * place of the alpha plane that is not nought is what makes the picture thirty two bits a pixel, and the
 * byte at `0x22` says whether the stream was packed, which the reference notes and then does not use: it
 * always reads an LZSS stream.
 */
export function readCtfLayout(
	data: Buffer,
	fileLength = data.length,
): CtfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if ((data[DEPTH_FIELD] ?? 0) !== DEPTH) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	const redOffset = data.readInt32LE(RED_OFFSET_FIELD);
	const greenOffset = data.readInt32LE(GREEN_OFFSET_FIELD);
	const blueOffset = data.readInt32LE(BLUE_OFFSET_FIELD);
	const alphaOffset = data.readInt32LE(ALPHA_OFFSET_FIELD);
	const bitsPerPixel = 0 === alphaOffset ? DEPTH : 32;
	const stride = ((width * (bitsPerPixel >> 3) + 3) & ~3) >>> 0;
	const plane = width * height;
	if (
		unpackedSize <= 0 ||
		unpackedSize > LIMIT ||
		stride * height > LIMIT ||
		STREAM_OFFSET >= fileLength
	) {
		return undefined;
	}
	const offsets = [redOffset, greenOffset, blueOffset];
	if (0 !== alphaOffset) offsets.push(alphaOffset);
	if (offsets.some((offset) => offset < 0)) return undefined;
	// Every plane the walk reads has to stand inside the planes the head declares.
	const last = offsets.reduce((best, offset) => Math.max(best, offset), 0);
	if (last + plane > unpackedSize) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		stride,
		unpackedSize,
		redOffset,
		greenOffset,
		blueOffset,
		alphaOffset,
		compressed: (data[COMPRESSED_FIELD] ?? 0) === 0xff,
	};
}

/** A cursor over the unfolded planes, with a peek that answers nothing where they end. */
class PlaneCursor {
	readonly #data: Buffer;
	#position: number;

	constructor(data: Buffer, position: number) {
		this.#data = data;
		this.#position = position;
	}

	readByte(): number | undefined {
		if (this.#position >= this.#data.length) return undefined;
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	peekByte(): number | undefined {
		return this.#data[this.#position];
	}
}

/**
 * `CtfReader.UnpackRle`: behind a head of twenty four bytes — whose sixth byte is the count a run has to
 * reach before a byte behind it may say how much longer it is — a run of a byte stands as the byte itself,
 * as many times as follow it up to that count. When the count is reached, another byte says how much longer
 * the run is: below `0x80` it says so itself, and above it two bytes say so together, in the shape
 * `((ctl & 0x7F) << 8) + lo + 0x80`.
 */
export function unpackCtfRle(channels: Buffer, output: Buffer): void {
	if (channels.length < RUN_HEADER_SIZE) {
		throw invalidPicture("'Unknown' picture is cut short of its own head");
	}
	const limit = channels[COUNT_LIMIT_FIELD] ?? 0;
	const cursor = new PlaneCursor(channels, RUN_HEADER_SIZE);
	let dst = 0;
	for (;;) {
		const value = cursor.readByte();
		if (value === undefined) break;
		let count = 1;
		while (count < limit) {
			if (cursor.peekByte() !== value) break;
			count += 1;
			cursor.readByte();
		}
		if (count === limit) {
			const control = cursor.readByte();
			if (control === undefined) {
				throw invalidPicture("'Unknown' picture is cut short of its runs");
			}
			if (control > 0x7f) {
				const low = cursor.readByte();
				if (low === undefined) {
					throw invalidPicture("'Unknown' picture is cut short of its runs");
				}
				count += low + ((control & 0x7f) << 8) + 128;
			} else {
				count += control;
			}
		}
		if (dst + count > output.length) {
			throw invalidPicture("'Unknown' picture writes past its own planes");
		}
		output.fill(value, dst, dst + count);
		dst += count;
	}
}

/**
 * `CtfReader.Unpack`: the planes are unfolded from the engine's own LZSS and then from the run walk, and the
 * three or four planes are woven together a pixel at a time — blue, green, red and, where there is one, the
 * alpha of that pixel. The rows are handed out top down, which is what `ImageData.Create` means, with the
 * padding of the reader's own rows.
 */
export function unpackCtf(stored: Buffer, layout: CtfLayout): Buffer {
	const packed = stored.subarray(STREAM_OFFSET);
	const channels = inflateLzssAll(packed, {
		maxOutputLength: layout.unpackedSize + LIMIT,
	});
	const planes: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
	unpackCtfRle(channels, planes);
	const output: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const pixelSize = layout.bitsPerPixel >> 3;
	const width = layout.width;
	let dst = 0;
	let red = layout.redOffset;
	let green = layout.greenOffset;
	let blue = layout.blueOffset;
	let alpha = layout.alphaOffset;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			output[dst] = planes[blue] ?? 0;
			output[dst + 1] = planes[green] ?? 0;
			output[dst + 2] = planes[red] ?? 0;
			if (0 !== layout.alphaOffset) output[dst + 3] = planes[alpha] ?? 0;
			dst += pixelSize;
			red += 1;
			green += 1;
			blue += 1;
			alpha += 1;
		}
		dst += layout.stride - width * pixelSize;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const unknownCtfImageDescriptor: FormatDescriptor = {
	id: "unknown-ctf-image",
	name: "'Unknown' image format",
	extensions: [],
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
			source: "Legacy/Unknown/ImageCTF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unknownCtfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unknownCtfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
				return false;
			}
			if ((header[DEPTH_FIELD] ?? 0) !== DEPTH) return false;
			const width = header.readUInt16LE(WIDTH_FIELD);
			const height = header.readUInt16LE(HEIGHT_FIELD);
			const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
			if (width === 0 || height === 0) return false;
			if (unpackedSize <= 0 || unpackedSize > LIMIT) return false;
			return BigInt(STREAM_OFFSET) < source.size;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCtfLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an 'Unknown' picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(STREAM_OFFSET),
				size: source.size - BigInt(STREAM_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					unpackedSize: layout.unpackedSize,
				},
			}),
			// The pixels are unfolded from the LZSS stream and the run walk and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss+rle",
				packed: layout.compressed,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCtfLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an 'Unknown' picture");
		}
		const pixels = unpackCtf(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
