// Format reference: GARbro "ArcFormats/CsWare/ImageGDT.cs", classes `GdtFormat`, `GdtMetaData` and
// `GdtReader` (AGS engine image format). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `DA1`, the word the reference registers the format under, and the header that follows it. */
const SIGNATURE: Buffer = Buffer.from("DA1", "latin1");
const HEADER_SIZE = 16;
/** The two places are single bytes counted in eights; the two lengths are words at other offsets. */
const OFFSET_X_FIELD = 8;
const OFFSET_Y_FIELD = 0xa;
const WIDTH_FIELD = 9;
const HEIGHT_FIELD = 0xc;
const FLAGS_FIELD = 0xf;
/** Four planes of one bit, four bits to a pixel, and sixteen colours in the map. */
const PLANE_COUNT = 4;
const COLOUR_COUNT = 16;
const BITS_PER_PIXEL = 4;
/** The flags: a colour map is stored, and the planes are unpacked two rows at a time. */
const PALETTE_FLAG = 0x80;
const DOUBLE_FLAG = 0x40;
const MAXIMUM_PLANE_BYTES = 256 * 1024 * 1024;

export interface GdtLayout {
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	flags: number;
	hasPalette: boolean;
	isDouble: boolean;
	/** The bytes a plane holds, which is a row of the picture counted in eights. */
	stride: number;
	/** The bytes the flattened picture holds, which is the width counted in halves. */
	outputStride: number;
}

/** The reference's `GdtFormat.ReadMetaData`: two places, two lengths and the flags out of one header. */
export async function readGdtLayout(source: ByteSource): Promise<GdtLayout> {
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	const flags = header[FLAGS_FIELD] ?? 0;
	const width = (header[WIDTH_FIELD] ?? 0) << 3;
	return {
		offsetX: (header[OFFSET_X_FIELD] ?? 0) << 3,
		offsetY: header.readUInt16LE(OFFSET_Y_FIELD),
		width,
		height: header.readUInt16LE(HEIGHT_FIELD),
		flags,
		hasPalette: 0 !== (flags & PALETTE_FLAG),
		isDouble: 0 === (flags & DOUBLE_FLAG),
		stride: width >> 3,
		outputStride: width >> 1,
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * The stream the unpackers read. The reference asks whether a byte is there before every opcode and treats the
 * end of the file as the end of the row, and it aligns itself to a word in one place of its two row scheme.
 */
class GdtStream {
	#at: number;

	constructor(
		readonly data: Buffer,
		at = HEADER_SIZE,
	) {
		this.#at = at;
	}

	get position(): number {
		return this.#at;
	}

	atEnd(): boolean {
		return this.#at >= this.data.length;
	}

	align(): void {
		if (0 !== (this.#at & 1)) this.#at += 1;
	}

	skip(count: number): void {
		this.#at += count;
	}

	byte(): number {
		this.#need(1);
		const value = this.data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	word(): number {
		this.#need(2);
		const value = this.data.readUInt16LE(this.#at);
		this.#at += 2;
		return value;
	}

	long(): number {
		this.#need(4);
		const value = this.data.readUInt32LE(this.#at);
		this.#at += 4;
		return value;
	}

	#need(count: number): void {
		if (this.#at + count > this.data.length) {
			throw invalidPicture("Unexpected end of AGS picture");
		}
	}
}

/** One plane of the picture, with every write checked against the length the header gave it. */
class PlaneWriter {
	constructor(
		readonly plane: Buffer,
		readonly height: number,
	) {}

	#check(at: number, span: number): void {
		if (at < 0 || span < 0 || at + span > this.plane.length) {
			throw invalidPicture("AGS plane runs past its picture");
		}
	}

	fillByte(at: number, count: number, value: number): void {
		this.#check(at, count);
		this.plane.fill(value & 0xff, at, at + count);
	}

	fillWord(at: number, count: number, value: number): void {
		this.#check(at, count * 2);
		for (let i = 0; i < count; i += 1) {
			this.plane.writeUInt16LE(value & 0xffff, at + i * 2);
		}
	}

	fillLong(at: number, count: number, value: number): void {
		this.#check(at, count * 4);
		for (let i = 0; i < count; i += 1) {
			this.plane.writeUInt32LE(value >>> 0, at + i * 4);
		}
	}

	/** The reference's `Buffer.BlockCopy` out of another plane, which copies from the same place. */
	copyInto(at: number, from: Buffer, count: number): void {
		this.#check(at, count);
		if (from.length < at + count) {
			throw invalidPicture("AGS plane runs past its picture");
		}
		from.copy(this.plane, at, at, at + count);
	}

	copyBack(at: number, source: number, count: number): void {
		if (!copyOverlapped(this.plane, source, at, count)) {
			throw invalidPicture("AGS run reaches outside its plane");
		}
	}

	negate(at: number, count: number, from: Buffer): void {
		this.#check(at, count);
		if (from.length < at + count) {
			throw invalidPicture("AGS plane runs past its picture");
		}
		for (let i = 0; i < count; i += 1) {
			this.plane[at + i] = ~(from[at + i] ?? 0) & 0xff;
		}
	}

	andPlanes(at: number, count: number, first: Buffer, second: Buffer): void {
		this.#check(at, count);
		if (first.length < at + count || second.length < at + count) {
			throw invalidPicture("AGS plane runs past its picture");
		}
		for (let i = 0; i < count; i += 1) {
			this.plane[at + i] = (first[at + i] ?? 0) & (second[at + i] ?? 0);
		}
	}
}

/** A word with its bytes the other way round, which the reference asks of its big endian helper. */
function bigEndian(value: number): number {
	return (
		(((value & 0xff) << 24) |
			((value & 0xff00) << 8) |
			((value & 0xff0000) >> 8) |
			((value >>> 24) & 0xff)) >>>
		0
	);
}

/**
 * The reference's `GdtReader.Unpack8Line`: one row of a plane, one opcode to a byte. The row runs to the end of
 * the stored stream, wherever that falls.
 */
function unpackLine(
	stream: GdtStream,
	planes: Buffer[],
	writer: PlaneWriter,
	at: number,
): void {
	const lane = (index: number): Buffer => {
		const plane = planes[index];
		if (!plane) throw invalidPicture("AGS row names a plane that is not there");
		return plane;
	};
	while (!stream.atEnd()) {
		const control = stream.byte();
		if (control < 0x40) {
			// A run of one value, either black or white.
			const value = control >= 0x20 ? 0xff : 0x00;
			let count = control & 0x1f;
			if (0 === count) count = stream.byte();
			writer.fillByte(at, count, value);
			at += count;
		} else if (control < 0xa0) {
			// A run taken from one of the other planes.
			let count = control & 0x1f;
			if (0 === count) count = stream.byte();
			writer.copyInto(at, lane((control - 0x40) >> 5), count);
			at += count;
		} else if (control < 0xf0) {
			// A run repeating what the plane already holds a few bytes back, or a whole row of it.
			let count = control & 0x0f;
			if (0 === count) count = stream.byte();
			const group = control & 0xf0;
			const back =
				group < 0xb0
					? 16
					: group < 0xc0
						? 8
						: group < 0xd0
							? 4
							: group < 0xe0
								? 2
								: writer.height * 2;
			writer.copyBack(at, at - back, count);
			at += count;
		} else if (control < 0xf9) {
			// A run of bytes the stream carries as they are.
			let count = control & 0x0f;
			if (0 === count) count = stream.byte();
			for (let i = 0; i < count; i += 1) {
				const value = stream.byte();
				writer.fillByte(at + i, 1, value);
			}
			at += count;
		} else if (0xf9 === control) {
			// A gap, which stays the zeroes the plane came with.
			at += stream.byte();
		} else if (0xfa === control) {
			const count = stream.byte();
			const value = stream.byte();
			writer.fillByte(at, count, value);
			at += count;
		} else if (0xfb === control) {
			const length = stream.byte();
			writer.negate(at, length & 0x7f, lane(length >> 7));
			at += length & 0x7f;
		} else if (0xfc === control) {
			const length = stream.byte();
			if (0 !== (length & 0x80)) {
				const count = length & 0x7f;
				const value = stream.byte();
				let pixel = (value & 0x0f) | ((value & 0xf0) << 4);
				pixel |= pixel << 4;
				writer.fillWord(at, count, pixel);
				at += count * 2;
			} else {
				writer.negate(at, length, lane(2));
				at += length;
			}
		} else if (0xfd === control) {
			const length = stream.byte();
			if (0 !== (length & 0x80)) {
				const first = stream.byte();
				let value = (first & 0x0f) | (first << 4) | ((first & 0xf0) << 8);
				if (0 !== (length & 0x40)) {
					const second = stream.byte();
					value |=
						((second & 0x0f) << 16) | (second << 20) | ((second & 0xf0) << 24);
				} else {
					value |= ((value & 0x3f3f) << 18) | ((value & 0xc0c0) << 10);
				}
				const count = length & 0x3f;
				writer.fillLong(at, count, value >>> 0);
				at += count * 4;
			} else {
				writer.fillWord(at, length, stream.word());
				at += length * 2;
			}
		} else if (0xfe === control) {
			const length = stream.byte();
			const top = length & 0xc0;
			if (0 !== top) {
				const count = length & 0x3f;
				const index = top >> 6;
				writer.andPlanes(at, count, lane(index & 1), lane(index & 2));
				at += count;
			} else {
				writer.fillLong(at, length, stream.long());
				at += length * 4;
			}
		} else {
			// 0xFF, the end of the row.
			return;
		}
	}
}

/** The reference's `GdtReader.UnpackSingle`: one row of a plane at a time, down the whole picture. */
function unpackSingle(
	stream: GdtStream,
	planes: Buffer[],
	writer: PlaneWriter,
	width: number,
): void {
	let at = 0;
	for (let i = width; i > 0; i -= 1) {
		unpackLine(stream, planes, writer, at);
		at += writer.height;
	}
}

/** The places the reference repeats from in its two row scheme, which are named by the opcode. */
function doubleBack(control: number, height: number): number {
	switch (control) {
		case 0xd3:
			return 16;
		case 0xd4:
			return 12;
		case 0xd5:
			return 8;
		case 0xd6:
			return 4;
		case 0xd7:
			return 2;
		case 0xd8:
			return 1;
		case 0xd9:
			return height * 2 + 8;
		case 0xda:
			return height * 2 + 4;
		case 0xdb:
			return height * 2 + 2;
		case 0xdc:
			return height * 2 + 1;
		case 0xdd:
			return height * 2;
		case 0xde:
			return height * 2 - 1;
		case 0xdf:
			return height * 2 - 2;
		case 0xe0:
			return height * 2 - 4;
		case 0xe1:
			return height * 2 - 8;
		case 0xe2:
			return height * 4 + 8;
		case 0xe3:
			return height * 4 + 4;
		case 0xe4:
			return height * 4 + 2;
		case 0xe5:
			return height * 4 + 1;
		case 0xe6:
			return height * 4;
		case 0xe7:
			return height * 4 - 1;
		case 0xe8:
			return height * 4 - 2;
		case 0xe9:
			return height * 4 - 4;
		case 0xea:
			return height * 4 - 8;
		case 0xeb:
			return height * 6 + 4;
		case 0xec:
			return height * 6 + 2;
		case 0xed:
			return height * 6 + 1;
		case 0xee:
			return height * 6;
		case 0xef:
			return height * 6 - 1;
		case 0xf0:
			return height * 6 - 2;
		case 0xf1:
			return height * 6 - 4;
		case 0xf2:
			return height * 8;
		default:
			return 0;
	}
}

/** The reference's `GdtReader.UnpackDouble`: two rows at a time, with a scheme of its own. */
function unpackDouble(
	stream: GdtStream,
	planes: Buffer[],
	writer: PlaneWriter,
	layout: GdtLayout,
): void {
	const lane = (index: number): Buffer => {
		const plane = planes[index];
		if (!plane) throw invalidPicture("AGS run names a plane that is not there");
		return plane;
	};
	const { height } = writer;
	let at = 0;
	let width = layout.stride;
	if (0 !== (layout.offsetX & 8)) {
		unpackLine(stream, planes, writer, at);
		width -= 1;
		at += height;
	}
	stream.align();
	if (1 === width) {
		unpackLine(stream, planes, writer, at);
		return;
	}
	while (!stream.atEnd()) {
		const op = stream.byte();
		const control = stream.byte();
		if (control < 0x80) {
			// A run of words in both rows at once.
			if (0 === control) continue;
			const value = ((((op & 0x0f) << 8) | ((op & 0xf0) >> 4)) * 0x11) & 0xffff;
			writer.fillWord(at, control, value);
			writer.fillWord(at + height, control, value);
			at += control * 2;
		} else if (control < 0xc0) {
			// A run of long words in both rows at once.
			const count = control & 0x3f;
			const word = (op & 0x0f) | ((op & 0xf0) << 4);
			let value = word | ((word & 0x0303) << 18) | ((word & 0x0c0c) << 14);
			value = bigEndian((value | (value << 4)) >>> 0);
			writer.fillLong(at, count, value);
			writer.fillLong(at + height, count, value);
			at += count * 4;
		} else if (control < 0xd0) {
			// A run of bytes in both rows at once.
			const value = ((control & 0x0f) | (control << 4)) & 0xff;
			writer.fillByte(at, op, value);
			writer.fillByte(at + height, op, value);
			at += op;
		} else if (control < 0xd2) {
			// The reference reads a byte for each row and forgets to move on, so the place it writes at stays
			// where it was.
			const count = ((control & 1) << 8) | op;
			for (let i = 0; i < count; i += 1) {
				const first = stream.byte();
				const second = stream.byte();
				writer.fillByte(at, 1, first);
				writer.fillByte(at + height, 1, second);
			}
		} else if (0xd2 === control) {
			at += op;
		} else if (control < 0xf3) {
			// A run repeating what the two rows already hold, at one of the places the reference lists.
			const back = doubleBack(control, height);
			writer.copyBack(at, at - back, op);
			writer.copyBack(at + height, at + height - back, op);
			at += op;
		} else if (control < 0xfc) {
			const source = lane((control - 0xf3) % 3);
			if (control < 0xf6) {
				writer.copyInto(at, source, op);
				writer.copyInto(at + height, source, op);
				at += op;
			} else if (control > 0xf8) {
				const index = control - 0xf6;
				const first = lane(index & 1);
				const second = lane(index & 2);
				writer.andPlanes(at, op, first, second);
				writer.andPlanes(at + height, op, first, second);
				at += op;
			} else {
				writer.negate(at, op, source);
				writer.negate(at + height, op, source);
				at += op;
			}
		} else if (0xfc === control) {
			const value = stream.byte();
			writer.fillByte(at, op, value);
			writer.fillByte(at + height, op, value);
			at += op;
		} else if (0xfd === control) {
			if (op < 0x80) {
				const value = stream.word();
				writer.fillWord(at, op, value);
				writer.fillWord(at + height, op, value);
				at += op * 2;
			} else {
				const count = op & 0x7f;
				const first = stream.word();
				const second = stream.word();
				writer.fillWord(at, count, (first << 8) | (second & 0xff));
				writer.fillWord(at + height, count, (first & 0xff) | (second >> 8));
				at += count * 2;
			}
		} else if (0xfe === control) {
			// A run of long words in both rows, which are either one colour or two of them.
			const count = op & 0x3f;
			if (op < 0x80) {
				const low = stream.byte();
				const high = stream.byte();
				let value = low | (high << 16);
				value = (value & 0x0f000f) | ((value & 0xf000f0) << 4);
				value = bigEndian((value * 0x11) >>> 0);
				writer.fillLong(at, count, value);
				writer.fillLong(at + height, count, value);
			} else {
				const first = stream.long();
				const second = stream.long();
				const row0 =
					((first << 24) |
						(first & 0xff0000) |
						((second & 0xff) << 8) |
						((second & 0xff0000) >> 16)) >>>
					0;
				const row1 =
					(((first & 0xff00) << 16) |
						((first & 0xff000000) >> 8) |
						(second & 0xff00) |
						((second & 0xff000000) >> 24)) >>>
					0;
				writer.fillLong(at, count, row0);
				writer.fillLong(at + height, count, row1);
			}
			at += count * 4;
		} else {
			// 0xFF, the end of a pair of rows.
			at += height;
			width -= 2;
			if (0 === width) break;
			if (1 === width) {
				unpackLine(stream, planes, writer, at);
				break;
			}
		}
	}
}

/** The colour map of a picture, which the reference reads four bits to a channel out of a bit stream. */
function readPalette(stream: GdtStream): Buffer {
	const bits = new MsbBitReader(stream.data, stream.position);
	const palette: Buffer = Buffer.alloc(COLOUR_COUNT * 3, 0x00);
	for (let i = 0; i < COLOUR_COUNT; i += 1) {
		// The reference reads blue, then red, then green, and doubles every nibble into a byte. A stream that
		// ends first leaves that channel negative, which its cast turns into `0xEF`.
		const read = (): number => {
			const value = bits.tryReadBits(4);
			return ((value < 0 ? -1 : value) * 0x11) & 0xff;
		};
		const blue = read();
		const red = read();
		const green = read();
		palette[i * 3] = red;
		palette[i * 3 + 1] = green;
		palette[i * 3 + 2] = blue;
	}
	// The bit stream reads whole bytes, so the colour map moves the stream along by the bytes it took.
	stream.skip((COLOUR_COUNT * 3 * 4) / 8);
	return palette;
}

/** The colour map of a picture that carries none, which the reference hands out as shades of grey. */
function greyPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(COLOUR_COUNT * 3, 0x00);
	for (let i = 0; i < COLOUR_COUNT; i += 1) {
		palette[i * 3] = i * 0x11;
		palette[i * 3 + 1] = i * 0x11;
		palette[i * 3 + 2] = i * 0x11;
	}
	return palette;
}

/** The four planes of a picture: the map, the four lengths, then one row walk each. */
function unpackPlanes(stored: Buffer, layout: GdtLayout): Buffer[] {
	const stream = new GdtStream(stored);
	stream.align();
	if (layout.hasPalette) readPalette(stream);
	const packedSizes: number[] = [];
	for (let i = 0; i < PLANE_COUNT; i += 1) packedSizes.push(stream.word());
	const planeSize = layout.stride * layout.height;
	if (planeSize > MAXIMUM_PLANE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`AGS picture of ${planeSize} bytes a plane is too large`,
		);
	}
	const planes: Buffer[] = [];
	for (let i = 0; i < PLANE_COUNT; i += 1) {
		planes.push(Buffer.alloc(planeSize, 0x00));
	}
	let position = stream.position;
	for (const [index, plane] of planes.entries()) {
		const inner = new GdtStream(stored, position);
		const writer = new PlaneWriter(plane, layout.height);
		if (layout.isDouble) {
			unpackDouble(inner, planes, writer, layout);
		} else {
			unpackSingle(inner, planes, writer, layout.stride);
		}
		position += packedSizes[index] ?? 0;
	}
	return planes;
}

/** The picture the four planes hold, four bits to a pixel, which the reference calls flattening. */
function flattenPlanes(
	planes: Buffer[],
	height: number,
	outputStride: number,
): Buffer {
	const output: Buffer = Buffer.alloc(outputStride * height, 0x00);
	const planeSize = planes[0]?.length ?? 0;
	let source = 0;
	for (let x = 0; x < outputStride; x += 4) {
		let destination = x;
		for (let y = 0; y < height; y += 1) {
			if (source >= planeSize) {
				throw invalidPicture("AGS picture runs past its planes");
			}
			const bytes = planes.map((plane) => plane[source] ?? 0);
			source += 1;
			for (let j = 0; j < 8; j += 2) {
				// A plane's own bit picks the pixel within the byte, and the plane itself picks the bit within
				// the pixel, so the highest of the four planes carries the highest bit. The bit above the two
				// of them is the first pixel of the byte and the lower one the second.
				let first = 0;
				let second = 0;
				for (const [index, byte] of bytes.entries()) {
					const high = ((byte << j) & 0x80) >> 7;
					const low = ((byte << j) & 0x40) >> 6;
					first |= high << index;
					second |= low << index;
				}
				output[destination + j / 2] = (first << 4) | second;
			}
			destination += outputStride;
		}
	}
	return output;
}

export const cswareGdtImageDescriptor: FormatDescriptor = {
	id: "csware-gdt-image",
	name: "AGS engine image",
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
			source: "ArcFormats/CsWare/ImageGDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cswareGdtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cswareGdtImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		// The reference reads nothing but the header, so every file carrying its word is one of its pictures.
		return source.size >= BigInt(HEADER_SIZE);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readGdtLayout(source);
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported AGS picture size ${layout.width}x${layout.height}`,
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: BITS_PER_PIXEL,
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
							flags: layout.flags,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "ags-planes",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const layout = await readGdtLayout(source);
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported AGS picture size ${layout.width}x${layout.height}`,
			);
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const planes = unpackPlanes(stored, layout);
		const pixels = flattenPlanes(planes, layout.height, layout.outputStride);
		const palette = layout.hasPalette
			? readPalette(new GdtStream(stored))
			: greyPalette();
		return Readable.from([
			writeBmp4(layout.width, layout.height, pixels, palette),
		]);
	},
});
