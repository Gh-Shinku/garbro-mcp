// Format reference: GARbro "ArcFormats/GameSystem/ImageCHR.cs", classes `ChrFormat`, `ChrMetaData` and
// `ChrReader` (a 'Game System' character picture of runs of four byte pixels, with a frame drawn over it).
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

const HEADER_SIZE = 0x18;
const DATA_OFFSET = 0x20;
const RGB_SIZE_FIELD = 0x04;
const WIDTH_FIELD = 0x08;
const HEIGHT_FIELD = 0x0c;
const OFFSET_X_FIELD = 0x10;
const OFFSET_Y_FIELD = 0x14;
const MAXIMUM_DIMENSION = 0x8000;
/** The four byte pixel every branch of the walk writes. */
const PIXEL_SIZE = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface ChrLayout {
	width: number;
	height: number;
	/** The row of the picture, which is the width in four byte pixels. */
	stride: number;
	/** Where the ran rows end, and where a frame drawn over them may stand. */
	rgbSize: number;
	offsetX: number;
	offsetY: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `ChrFormat.ReadMetaData`: the word at nought has to be the **length of the file itself**, the size of the
 * ran rows stands at four and has to be larger than the head, the width and the height stand at eight and
 * twelve and are kept within `0x8000` together with their offsets, and the offsets themselves stand at
 * sixteen and twenty. The depth is always reported as thirty two bits.
 */
export function readChrLayout(
	data: Buffer,
	fileLength = data.length,
): ChrLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.readUInt32LE(0) !== fileLength) return undefined;
	const rgbSize = data.readInt32LE(RGB_SIZE_FIELD);
	if (rgbSize <= DATA_OFFSET || rgbSize > fileLength) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const offsetX = data.readInt32LE(OFFSET_X_FIELD);
	const offsetY = data.readInt32LE(OFFSET_Y_FIELD);
	if (
		width === 0 ||
		width > MAXIMUM_DIMENSION ||
		height === 0 ||
		height > MAXIMUM_DIMENSION ||
		offsetX < 0 ||
		offsetX + width > MAXIMUM_DIMENSION ||
		offsetY < 0 ||
		offsetY + height > MAXIMUM_DIMENSION
	) {
		return undefined;
	}
	const stride = width * PIXEL_SIZE;
	if (stride * height > LIMIT) return undefined;
	return { width, height, stride, rgbSize, offsetX, offsetY };
}

/** A cursor over the stream with the reads the walk and the frame need. */
class ChrCursor {
	readonly #data: Buffer;
	#position: number;

	constructor(data: Buffer, position: number) {
		this.#data = data;
		this.#position = position;
	}

	get position(): number {
		return this.#position;
	}

	set position(value: number) {
		this.#position = value;
	}

	readByte(): number {
		if (this.#position >= this.#data.length) {
			throw invalidPicture("'Game System' picture is cut short of its rows");
		}
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	readInt16(): number {
		const low = this.readByte();
		const high = this.readByte();
		return (high << 8) | low;
	}

	readInt32(): number {
		const low = this.readByte();
		const b1 = this.readByte();
		const b2 = this.readByte();
		const b3 = this.readByte();
		return (b3 << 24) | (b2 << 16) | (b1 << 8) | low | 0;
	}

	/** The three bytes of a pixel's colour, of which a stream that ends sooner gives what it holds. */
	readColour(output: Buffer, at: number): void {
		const available = Math.min(3, this.#data.length - this.#position);
		for (let index = 0; index < available; index += 1) {
			output[at + index] = this.#data[this.#position + index] ?? 0;
		}
		this.#position += available;
	}
}

/**
 * `ChrReader.UnpackRgb`: a row at a time, a byte a step. A byte below `0x7F` is one pixel that stands
 * itself, with the fourth byte the byte's own value doubled — the reference hands out the complement of
 * `0xFE - 2 * ctl`, which is `2 * ctl + 1` — a byte below `0x9F` is a pixel that stands and is then repeated
 * as many times as the byte says, `0xFF` ends the row, and anything else skips as many pixels as the byte
 * says, leaving the zeros the picture was made of.
 */
export function unpackChrRgb(
	cursor: ChrCursor,
	output: Buffer,
	layout: ChrLayout,
): void {
	let row = 0;
	for (let y = 0; y < layout.height; y += 1) {
		let dst = row;
		for (;;) {
			const control = cursor.readByte();
			if (control < 0x7f) {
				if (dst + PIXEL_SIZE > output.length) {
					throw invalidPicture("'Game System' picture writes past its own end");
				}
				cursor.readColour(output, dst);
				output[dst + 3] = (2 * control + 1) & 0xff;
				dst += PIXEL_SIZE;
			} else if (control < 0x9f) {
				let count = control - 0x7e;
				count *= PIXEL_SIZE;
				if (dst + count > output.length) {
					throw invalidPicture("'Game System' picture writes past its own end");
				}
				cursor.readColour(output, dst);
				output[dst + 3] = 0xff;
				for (let index = 0; index < count - PIXEL_SIZE; index += 1) {
					output[dst + PIXEL_SIZE + index] = output[dst + index] ?? 0;
				}
				dst += count;
			} else if (0xff === control) {
				break;
			} else {
				dst += (control - 0x9e) * PIXEL_SIZE;
			}
		}
		row += layout.stride;
	}
}

/**
 * `ChrReader.ReadOverlay`: where the ran rows end before the file does, a frame may be drawn over them. Its
 * own size stands behind a word that is not read, then the count of frames; the first frame carries its own
 * place and measurements, which are counted from the picture's own offsets and from its **bottom** edge, and
 * its pixels then stand as they are, three bytes and a fourth that is stretched over the whole byte from the
 * `0x80` the frame holds.
 */
export function readChrOverlay(
	cursor: ChrCursor,
	output: Buffer,
	layout: ChrLayout,
): void {
	cursor.readInt32();
	const frameCount = cursor.readInt32();
	if (frameCount <= 0) return;
	const x = cursor.readInt16() - layout.offsetX;
	const frameY = cursor.readInt16();
	const width = cursor.readInt16();
	const height = cursor.readInt16();
	const y = layout.height + layout.offsetY - frameY - height;
	if (x < 0 || y < 0) return;
	let outputRow = y * layout.stride + x * PIXEL_SIZE;
	for (let row = 0; row < height; row += 1) {
		let dst = outputRow;
		for (let column = 0; column < width; column += 1) {
			if (dst + PIXEL_SIZE > output.length) {
				throw invalidPicture("'Game System' picture writes past its own end");
			}
			cursor.readColour(output, dst);
			output[dst + 3] = Math.trunc((cursor.readByte() * 0xff) / 0x80) & 0xff;
			dst += PIXEL_SIZE;
		}
		outputRow += layout.stride;
	}
}

/**
 * `ChrReader.Unpack`: the ran rows first, and then, where the file holds more than they need, the frame that
 * is drawn over them.
 */
export function unpackChr(stored: Buffer, layout: ChrLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const cursor = new ChrCursor(stored, DATA_OFFSET);
	unpackChrRgb(cursor, output, layout);
	if (layout.rgbSize < stored.length) {
		cursor.position = layout.rgbSize;
		const overlayLength = cursor.readInt32();
		if (overlayLength > 0) readChrOverlay(cursor, output, layout);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameSystemChrImageDescriptor: FormatDescriptor = {
	id: "game-system-chr-image",
	name: "'Game System' character image format",
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
			source: "ArcFormats/GameSystem/ImageCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameSystemChrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameSystemChrImageDescriptor,
	// The word at nought is the length of the file itself, so no signature can tell this format from others.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readChrLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readChrLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a 'Game System' picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(DATA_OFFSET),
				size: BigInt(layout.rgbSize - DATA_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 32,
					rgbSize: layout.rgbSize,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The pixels are unfolded from the runs and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readChrLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a 'Game System' picture");
		}
		const pixels = unpackChr(stored, layout);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
