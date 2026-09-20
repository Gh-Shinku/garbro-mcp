import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, toBgra32, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'PDT\0', the word the reference registers. */
const SIGNATURE = Buffer.from("PDT\x00", "latin1");
/** The word behind it says which shape of the container stands there. */
const ROOT_FIELD = 0x04;
const ROOT_VALUE = 0x118;
/** Every picture of the container carries its own head: the size it gives, the size it stands in, where its
 * places and its walk stand, and its name. */
const PICTURE_SIZE_FIELD = 0x08;
const PACKED_SIZE_FIELD = 0x0c;
const DATA_OFFSET_FIELD = 0x10;
const BITS_OFFSET_FIELD = 0x14;
const NAME_FIELD = 0x18;
const NAME_LIMIT = 0x100;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface PdtBmpPicture {
	bmp: Buffer;
	/** How many bytes of the file the picture stands in. */
	packedSize: number;
	/** The name the picture carries. */
	name: string;
}

export interface PdtBmpLayout {
	colour: PdtBmpPicture;
	alpha?: PdtBmpPicture;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function readName(data: Buffer, at: number): string {
	let end = at;
	const limit = Math.min(data.length, at + NAME_LIMIT);
	while (end < limit && 0 !== (data[end] ?? 0)) end += 1;
	return data.toString("latin1", at, end);
}

interface PdtBitReader {
	data: Buffer;
	position: number;
	current: number;
	count: number;
}

function nextBit(reader: PdtBitReader): number {
	if (0 === reader.count) {
		if (reader.position + 4 > reader.data.length) {
			throw invalidPicture("UK2 bitmap is cut short of its walk");
		}
		reader.current = reader.data.readUInt32LE(reader.position);
		reader.position += 4;
		reader.count = 31;
	} else {
		reader.count -= 1;
	}
	const bit = reader.current >>> 31;
	reader.current = (reader.current << 1) >>> 0;
	return bit;
}

function readInteger(reader: PdtBitReader): number {
	let ones = 0;
	while (0 !== nextBit(reader)) ones += 1;
	let value = 0;
	for (let place = ones; place > 0; place -= 1) {
		value = (value << 1) | nextBit(reader);
	}
	return value + (1 << ones);
}

/**
 * `PdtBmpDecoder.UnpackBits`: what the bits of a picture say is which way the bytes behind them stand. Where no
 * place stands in front of a byte of the walk the byte behind it stands for itself, and where places stand
 * there, there are three ways the places below name: a copy of what already stands in the picture, standing as
 * far behind the place at hand as the first integer says and as many bytes long as the second; a run of copies
 * of the byte before the place at hand, the second integer saying how many of them stand there and the third
 * how far apart they stand; or the byte before the place at hand itself.
 */
export function unpackPdtBits(
	data: Buffer,
	at: number,
	bits: Buffer,
	size: number,
): Buffer {
	const reader: PdtBitReader = {
		data: bits,
		position: 0,
		current: 0,
		count: 0,
	};
	const output: Buffer = Buffer.alloc(size, 0x00);
	let cursor = at;
	let dst = 0;
	let last = 0;
	while (dst < size) {
		let control = 0;
		while (0 !== nextBit(reader)) {
			control += 1;
			if (control > 3) {
				throw invalidPicture("UK2 bitmap walks beyond the ways of its walk");
			}
		}
		if (0 === control) {
			if (cursor >= data.length) {
				throw invalidPicture("UK2 bitmap is cut short of its places");
			}
			last = data[cursor] ?? 0;
			cursor += 1;
			output[dst] = last;
			dst += 1;
		} else if (1 === control) {
			const offset = readInteger(reader);
			const count = readInteger(reader);
			if (!copyOverlapped(output, dst - offset, dst, count)) {
				throw invalidPicture("UK2 bitmap walks beyond its own places");
			}
			dst += count;
		} else if (2 === control) {
			const count = readInteger(reader);
			const step = readInteger(reader);
			let position = 0;
			for (let walked = 0; walked < step; walked += count) {
				if (!copyOverlapped(output, dst - count, dst + position, count)) {
					throw invalidPicture("UK2 bitmap walks beyond its own places");
				}
				position += count * count;
			}
			dst += count * step;
		} else {
			output[dst] = last;
			dst += 1;
		}
	}
	return output;
}

/** `PdtBmpDecoder.UnpackBitmap`: the head of a picture, the bytes of its walk and what that walk gives. */
function readPdtBmpPicture(
	data: Buffer,
	offset: number,
	fileLength: number,
): PdtBmpPicture | undefined {
	if (offset < 0 || offset + NAME_FIELD > fileLength) return undefined;
	const size = data.readInt32LE(offset + PICTURE_SIZE_FIELD);
	const packedSize = data.readInt32LE(offset + PACKED_SIZE_FIELD);
	if (size <= 0 || size > LIMIT || packedSize <= 0) return undefined;
	const dataOffset = data.readUInt32LE(offset + DATA_OFFSET_FIELD) + offset;
	const bitsOffset = data.readUInt32LE(offset + BITS_OFFSET_FIELD) + offset;
	if (bitsOffset < offset || dataOffset < bitsOffset) return undefined;
	if (dataOffset > fileLength) return undefined;
	const bitsLength = dataOffset - bitsOffset;
	if (bitsOffset + bitsLength > fileLength) return undefined;
	// The reference holds four bytes more than the walk stands in, which its own walk reads a word at a time.
	const bits: Buffer = Buffer.alloc(bitsLength + 4, 0x00);
	data.copy(bits, 0, bitsOffset, bitsOffset + bitsLength);
	return {
		bmp: unpackPdtBits(data, dataOffset, bits, size),
		packedSize,
		name: readName(data, offset + NAME_FIELD),
	};
}

export function readPdtBmpLayout(
	data: Buffer,
	fileLength = data.length,
): PdtBmpLayout | undefined {
	if (data.length < ROOT_FIELD + 4) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data.readInt32LE(ROOT_FIELD) !== ROOT_VALUE) return undefined;
	const colour = readPdtBmpPicture(data, 0, fileLength);
	if (!colour) return undefined;
	const layout: PdtBmpLayout = { colour };
	const at = colour.packedSize;
	if (at + 4 <= fileLength && data.subarray(at, at + 4).equals(SIGNATURE)) {
		const alpha = readPdtBmpPicture(data, at, fileLength);
		if (alpha) layout.alpha = alpha;
	}
	return layout;
}

export function decodePdtBmp(layout: PdtBmpLayout): Buffer {
	const colour = readBmpImage(layout.colour.bmp);
	const places = colour ? toBgra32(colour, true) : undefined;
	if (!colour || !places) {
		throw invalidPicture("UK2 bitmap holds no bitmap");
	}
	if (!layout.alpha) {
		return writeBmp32(colour.width, colour.height, places);
	}
	const alphaImage = readBmpImage(layout.alpha.bmp);
	const shape = alphaImage ? toBgra32(alphaImage, true) : undefined;
	if (!alphaImage || !shape) {
		throw invalidPicture("UK2 bitmap holds no picture of its shapes");
	}
	const width = Math.min(colour.width, alphaImage.width);
	const height = Math.min(colour.height, alphaImage.height);
	for (let row = 0; row < colour.height; row += 1) {
		for (let column = 0; column < colour.width; column += 1) {
			const at = (row * colour.width + column) * 4;
			let value = 0;
			if (row < height && column < width) {
				value = shape[(row * alphaImage.width + column) * 4] ?? 0;
			}
			places[at + 3] = value;
		}
	}
	return writeBmp32(colour.width, colour.height, places);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aypioPdtBmpImageDescriptor: FormatDescriptor = {
	id: "aypio-pdt-bmp-image",
	name: "UK2 engine compressed bitmap",
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
			source: "Legacy/AyPio/PdtBitmap.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aypioPdtBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aypioPdtBmpImageDescriptor,
	// The reference registers the word `PDT\0` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(ROOT_FIELD + 4)) return false;
		try {
			const wanted = Number(
				source.size < BigInt(0x1000) ? source.size : BigInt(0x1000),
			);
			const header = Buffer.from(await source.readAt(0n, wanted));
			return readPdtBmpLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPdtBmpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine bitmap");
		const colour = readBmpImage(layout.colour.bmp);
		if (!colour) throw invalidPicture("UK2 bitmap holds no bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.colour.packedSize),
				size: source.size - BigInt(layout.colour.packedSize),
				compressed: true,
				metadata: {
					type: "image",
					width: colour.width,
					height: colour.height,
					bitsPerPixel: 32,
					hasAlpha: layout.alpha !== undefined,
				},
			}),
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 32 },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPdtBmpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine bitmap");
		return Readable.from([decodePdtBmp(layout)]);
	},
});
