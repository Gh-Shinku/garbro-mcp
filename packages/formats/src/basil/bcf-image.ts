// Format reference: GARbro "ArcFormats/Basil/ImageBCF.cs", classes `BcfFormat`, `BcfMetaData` and
// `BcfReader` (a BasiL picture of a colour plane behind the engine's own LZ, and an alpha plane behind a
// second one of its own). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'BCF' with a nought behind it, which is the word the reference registers. */
const SIGNATURE = Buffer.from([0x42, 0x43, 0x46, 0x00]);
const HEADER_SIZE = 0x20;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x06;
const STRIDE_FIELD = 0x08;
const DATA_SHIFT_FIELD = 0x0c;
const ALPHA_SHIFT_FIELD = 0x0d;
const DATA_OFFSET_FIELD = 0x10;
const DATA_BITS_OFFSET_FIELD = 0x14;
const ALPHA_OFFSET_FIELD = 0x18;
const ALPHA_BITS_OFFSET_FIELD = 0x1c;
/** `BcfReader.ShiftTable`, the steps a reference's count and place are told apart by. */
const SHIFT_TABLE = [3, 4, 5, 6, 7] as const;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface BcfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The row of the colour plane, which may be wider than the picture. */
	stride: number;
	dataShift: number;
	alphaShift: number;
	dataOffset: number;
	dataBitsOffset: number;
	alphaOffset: number;
	alphaBitsOffset: number;
	/** Where the bits of the colour plane end, which is where the alpha plane begins, or the file's end. */
	dataBitsEnd: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BcfFormat.ReadMetaData`: the width and the height stand at four and six as words, the row of the colour
 * plane at eight as a word, the steps of the two bit streams at twelve and thirteen as bytes, and the four
 * places — of the colour data, of its bits, of the alpha plane and of its bits — stand from sixteen as
 * words. A picture has an alpha plane exactly when its own place is not nought, so the depth is twenty four
 * bits without one and thirty two with it.
 */
export function readBcfLayout(
	data: Buffer,
	fileLength = data.length,
): BcfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const stride = data.readInt32LE(STRIDE_FIELD);
	if (stride < width * 3 || stride * height > LIMIT) return undefined;
	const dataShift = data[DATA_SHIFT_FIELD] ?? 0;
	const alphaShift = data[ALPHA_SHIFT_FIELD] ?? 0;
	if (dataShift >= SHIFT_TABLE.length || alphaShift >= SHIFT_TABLE.length) {
		return undefined;
	}
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	const dataBitsOffset = data.readUInt32LE(DATA_BITS_OFFSET_FIELD);
	const alphaOffset = data.readUInt32LE(ALPHA_OFFSET_FIELD);
	const alphaBitsOffset = data.readUInt32LE(ALPHA_BITS_OFFSET_FIELD);
	const bitsEnd = 0 === alphaOffset ? fileLength : alphaOffset;
	if (dataBitsOffset >= bitsEnd || dataOffset >= fileLength) return undefined;
	if (0 !== alphaOffset) {
		if (alphaOffset >= fileLength || alphaBitsOffset >= fileLength) {
			return undefined;
		}
		if (width * height > LIMIT) return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel: 0 === alphaOffset ? 24 : 32,
		stride,
		dataShift,
		alphaShift,
		dataOffset,
		dataBitsOffset,
		alphaOffset,
		alphaBitsOffset,
		dataBitsEnd: 0 === alphaOffset ? fileLength : alphaOffset,
	};
}

/**
 * `BcfReader.LzUnpack`: a bit a step of the walk. A clear bit is a byte that stands itself; a set one is a
 * reference of two bytes, whose lowest bits count the bytes it takes and whose rest counts the places behind
 * the walk it takes them from, both starting from one. A reference reaches back a byte at a time, so it may
 * take from its own output. A reference that reaches before the start or past the end of what it writes, and
 * a stream that ends inside either walk, are refused rather than left to the reference's own arrays (a
 * documented deviation in the message only).
 */
export function lzUnpackBcf(
	stored: Buffer,
	bits: Buffer,
	dataOffset: number,
	shift: number,
	output: Buffer,
): void {
	let position = dataOffset;
	const readByte = (): number => {
		if (position >= stored.length) {
			throw invalidPicture("BasiL picture is cut short of its stream");
		}
		const value = stored[position] ?? 0;
		position += 1;
		return value;
	};
	const readUInt16 = (): number => {
		const low = readByte();
		const high = readByte();
		return (high << 8) | low;
	};
	const step = SHIFT_TABLE[shift] ?? 3;
	let dst = 0;
	let bitSource = 0;
	let mask = 1;
	while (dst < output.length) {
		if (bitSource >= bits.length) {
			throw invalidPicture("BasiL picture is cut short of its bits");
		}
		if (0 !== (mask & (bits[bitSource] ?? 0))) {
			const value = readUInt16();
			const count = (value & ((1 << step) - 1)) + 3;
			const offset = (value >> step) + 1;
			if (dst - offset < 0) {
				throw invalidPicture("BasiL picture reaches before its own start");
			}
			if (dst + count > output.length) {
				throw invalidPicture("BasiL picture writes past its own end");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = output[dst - offset + index] ?? 0;
			}
			dst += count;
		} else {
			output[dst] = readByte();
			dst += 1;
		}
		mask = (mask << 1) & 0xff;
		if (0 === mask) {
			bitSource += 1;
			mask = 1;
		}
	}
}

/**
 * `BcfReader.Unpack`: the colour plane is unfolded from its own stream of bits and data, of the size the row
 * the head declares holds for every row. An alpha plane is then unfolded the same way, of exactly a byte a
 * pixel, and the two are woven together a pixel at a time — the colour's three bytes and then the alpha of
 * that pixel — into rows of four bytes a pixel. The rows are handed out **bottom up**, which is what
 * `ImageData.CreateFlipped` means.
 */
export function unpackBcf(
	stored: Buffer,
	layout: BcfLayout,
): { pixels: Buffer; stride: number } {
	const colour: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	lzUnpackBcf(
		stored,
		stored.subarray(layout.dataBitsOffset, layout.dataBitsEnd),
		layout.dataOffset,
		layout.dataShift,
		colour,
	);
	if (0 === layout.alphaOffset)
		return { pixels: colour, stride: layout.stride };
	const alpha: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	lzUnpackBcf(
		stored,
		stored.subarray(layout.alphaBitsOffset),
		layout.alphaOffset,
		layout.alphaShift,
		alpha,
	);
	const stride = 4 * layout.width;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let source = 0;
	let alphaSource = 0;
	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			pixels[dst] = colour[source] ?? 0;
			pixels[dst + 1] = colour[source + 1] ?? 0;
			pixels[dst + 2] = colour[source + 2] ?? 0;
			pixels[dst + 3] = alpha[alphaSource] ?? 0;
			dst += 4;
			source += 3;
			alphaSource += 1;
		}
		source += layout.stride - layout.width * 3;
	}
	return { pixels, stride };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const basilBcfImageDescriptor: FormatDescriptor = {
	id: "basil-bcf-image",
	name: "BasiL image format",
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
			source: "ArcFormats/Basil/ImageBCF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const basilBcfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: basilBcfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
				return false;
			}
			const width = header.readUInt16LE(WIDTH_FIELD);
			const height = header.readUInt16LE(HEIGHT_FIELD);
			const stride = header.readInt32LE(STRIDE_FIELD);
			if (width === 0 || height === 0 || stride < width * 3) return false;
			if (
				(header[DATA_SHIFT_FIELD] ?? 0) >= SHIFT_TABLE.length ||
				(header[ALPHA_SHIFT_FIELD] ?? 0) >= SHIFT_TABLE.length
			) {
				return false;
			}
			const dataOffset = header.readUInt32LE(DATA_OFFSET_FIELD);
			const dataBitsOffset = header.readUInt32LE(DATA_BITS_OFFSET_FIELD);
			const alphaOffset = header.readUInt32LE(ALPHA_OFFSET_FIELD);
			const bitsEnd = 0 === alphaOffset ? Number(source.size) : alphaOffset;
			return (
				stride * height <= LIMIT &&
				dataOffset < Number(source.size) &&
				dataBitsOffset < bitsEnd
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBcfLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a BasiL picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.stride * layout.height),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					stride: layout.stride,
				},
			}),
			// The pixels are unfolded from the two streams and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lz",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBcfLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a BasiL picture");
		}
		const picture = unpackBcf(stored, layout);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (24 === layout.bitsPerPixel) {
			const tight: Buffer = Buffer.alloc(
				layout.height * layout.width * 3,
				0x00,
			);
			for (let row = 0; row < layout.height; row += 1) {
				picture.pixels.copy(
					tight,
					row * layout.width * 3,
					row * picture.stride,
					row * picture.stride + layout.width * 3,
				);
			}
			return Readable.from([
				writeBmp24(layout.width, layout.height, tight, true),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, picture.pixels, true),
		]);
	},
});
