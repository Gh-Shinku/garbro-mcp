// Format reference: GARbro "Legacy/Grocer/ImagePIC.cs", classes `PicFormat` and `PicReader` (a Grocer
// picture: four planes walked a row at a time into a buffer that also holds the rows behind, where a step of
// the walk may take its bytes from the row at hand or from the rows behind, and the places of the four planes
// then stand together in every colour of the picture). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The first byte of the file, which is the word the reference registers. */
const SIGNATURE_BYTE = 0x01;
/** The word the reference tells a picture of this engine by, which stands in the head. */
const MARK = Buffer.from("Actor98", "latin1");
const MARK_FIELD = 0x10;
/** The width and the height of the picture. */
const WIDTH_FIELD = 0x53;
const HEIGHT_FIELD = 0x55;
/** The colours of the picture and the head of the walk behind them. */
const PALETTE_FIELD = 0x21;
const PALETTE_COLORS = 16;
const HEADER_SIZE = 0x57;
/** The widest picture the reference reads. */
const MAXIMUM_WIDTH = 640;
/** The row the walk of a row stands at, and how wide a plane of it is. */
const ROW_FIELD = 0x280;
const PLANE_WIDTH = 0x50;
/** How wide the buffer the walk stands in is. */
const BUFFER_SIZE = 0x3c0;
/** Where the walk begins to shift the rows behind it. */
const SHIFT_FIELD = 0x140;
const SHIFT_SIZE = 0x280;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrocerPicLayout {
	width: number;
	height: number;
	/** How many bytes stand in a row of a plane. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PicFormat.ReadMetaData`: the word `Actor98` stands at `0x10` of the head, the width of the picture stands
 * in the places of the bits at `0x53` — eight places for every byte — and its height stands at `0x55`. A
 * picture of more than six hundred and forty places of width is turned away.
 */
export function readGrocerPicLayout(
	data: Buffer,
	fileLength = data.length,
): GrocerPicLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if ((data[0] ?? 0) !== SIGNATURE_BYTE) return undefined;
	if (!data.subarray(MARK_FIELD, MARK_FIELD + MARK.length).equals(MARK)) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD) << 3;
	if (width > MAXIMUM_WIDTH) return undefined;
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width * height > LIMIT) return undefined;
	return { width, height, stride: width >> 3 };
}

/**
 * `PicReader.ReadPalette`: sixteen colours stand from `0x21`, three bytes apiece — the green of the colour
 * first, then its red and its blue — every byte standing for a colour of four places, which is thirty four
 * places of a colour of eight bits.
 */
export function readPicPalette(data: Buffer): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let entry = 0; entry < PALETTE_COLORS; entry += 1) {
		const at = PALETTE_FIELD + entry * 3;
		const green = (data[at] ?? 0) * 0x11;
		const red = (data[at + 1] ?? 0) * 0x11;
		const blue = (data[at + 2] ?? 0) * 0x11;
		// A bitmap holds its colours blue first, then green and red.
		palette[entry * 4] = blue & 0xff;
		palette[entry * 4 + 1] = green & 0xff;
		palette[entry * 4 + 2] = red & 0xff;
	}
	return palette;
}

function readPicByte(data: Buffer, cursor: { position: number }): number {
	if (cursor.position >= data.length) {
		throw invalidPicture("Grocer picture is cut short of its walk");
	}
	const value = data[cursor.position] ?? 0;
	cursor.position += 1;
	return value;
}

function copyWithinBuffer(
	buffer: Uint8Array,
	source: number,
	target: number,
	count: number,
): void {
	if (source < 0 || target < 0 || count < 0) {
		throw invalidPicture("Grocer picture walks beyond its own buffer");
	}
	if (source + count > buffer.length || target + count > buffer.length) {
		throw invalidPicture("Grocer picture walks beyond its own buffer");
	}
	buffer.copyWithin(target, source, source + count);
}

/**
 * `PicReader.Unpack`: a row of the picture is walked four planes at a time, and every step of the walk gives a
 * byte, or a count of bytes, of a plane of that row. A byte above nought and below six names a step that
 * takes its bytes from elsewhere: one byte to stand for all of them, the plane of the rows behind, the first
 * plane of the row at hand, or the plane behind or the one behind that of the row at hand. A byte of six
 * stands in front of the byte it gives, and any other byte stands for itself. The places of the four planes
 * of a row then stand together in every colour of the picture — the first plane in the lowest place of a
 * colour and the fourth in the highest — and the rows behind shift along so that the walk of the next row
 * finds them.
 */
export function decodePic(data: Buffer, layout: GrocerPicLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	const buffer = new Uint8Array(BUFFER_SIZE);
	const cursor = { position: HEADER_SIZE };
	let output = 0;
	for (let row = 0; row < layout.height; row += 1) {
		for (let plane = 0; plane < 4; plane += 1) {
			let x = 0;
			while (x < layout.stride) {
				let value = readPicByte(data, cursor);
				if (value > 0 && value < 6) {
					const count = readPicByte(data, cursor);
					const target = plane * PLANE_WIDTH + x + ROW_FIELD;
					if (1 === value) {
						value = readPicByte(data, cursor);
						for (let index = 0; index < count; index += 1) {
							if (target + index >= buffer.length) {
								throw invalidPicture(
									"Grocer picture walks beyond its own buffer",
								);
							}
							buffer[target + index] = value;
						}
					} else if (2 === value) {
						copyWithinBuffer(buffer, plane * PLANE_WIDTH + x, target, count);
					} else if (3 === value) {
						copyWithinBuffer(buffer, x + ROW_FIELD, target, count);
					} else if (4 === value) {
						copyWithinBuffer(
							buffer,
							x + ROW_FIELD + PLANE_WIDTH,
							target,
							count,
						);
					} else {
						copyWithinBuffer(
							buffer,
							x + ROW_FIELD + PLANE_WIDTH * 2,
							target,
							count,
						);
					}
					x += count;
				} else {
					if (6 === value) value = readPicByte(data, cursor);
					const target = plane * PLANE_WIDTH + x + ROW_FIELD;
					if (target >= buffer.length) {
						throw invalidPicture("Grocer picture walks beyond its own buffer");
					}
					buffer[target] = value;
					x += 1;
				}
			}
		}
		for (let x = 0; x < layout.stride; x += 1) {
			let mask = 0x80;
			for (let index = 0; index < 8; index += 1) {
				let colour = 0;
				if (0 !== ((buffer[ROW_FIELD + x] ?? 0) & mask)) colour |= 0x01;
				if (0 !== ((buffer[ROW_FIELD + PLANE_WIDTH + x] ?? 0) & mask)) {
					colour |= 0x02;
				}
				if (0 !== ((buffer[ROW_FIELD + PLANE_WIDTH * 2 + x] ?? 0) & mask)) {
					colour |= 0x04;
				}
				if (0 !== ((buffer[ROW_FIELD + PLANE_WIDTH * 3 + x] ?? 0) & mask)) {
					colour |= 0x08;
				}
				pixels[output + (x << 3) + index] = colour;
				mask >>= 1;
			}
		}
		buffer.copyWithin(0, SHIFT_FIELD, SHIFT_FIELD + SHIFT_SIZE);
		output += layout.width;
	}
	return writeBmp8Palette(
		layout.width,
		layout.height,
		pixels,
		readPicPalette(data),
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const grocerPicImageDescriptor: FormatDescriptor = {
	id: "grocer-pic-image",
	name: "Grocer image format",
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
			source: "Legacy/Grocer/ImagePIC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const grocerPicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: grocerPicImageDescriptor,
	// The reference registers the word one, a single byte, and no name.
	detection: { signatures: [{ bytes: new Uint8Array([SIGNATURE_BYTE]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readGrocerPicLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGrocerPicLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Grocer picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
				},
			}),
			// The planes are walked out and gathered into a bitmap of eight bits with sixteen colours.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 4 },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGrocerPicLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Grocer picture");
		return Readable.from([decodePic(stored, layout)]);
	},
});
