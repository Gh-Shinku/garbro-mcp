// Format reference: GARbro "Legacy/SplushWave/ImageSWG.cs", classes `SwgFormat`, `SwgMetaData` and the
// reader inside the format (a Splush Wave picture of a palette or of three or four planes, every plane of
// which may stand as it is or be walked along with a control byte a run). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'SWG', the word the reference registers. */
const SIGNATURE = Buffer.from("SWG", "latin1");
const HEADER_SIZE = 0x30;
const DATA_OFFSET_FIELD = 0x10;
const PALETTE_OFFSET_FIELD = 0x14;
const WIDTH_FIELD = 0x20;
const HEIGHT_FIELD = 0x22;
const DEPTH_FIELD = 0x28;
const COMPRESSED_FIELD = 0x2f;
/** The places the head gives stand eight bytes behind the head itself. */
const HEADER_BIAS = 0x10;
/** How many planes the walk reads beyond the two of a colour. */
const PLANE_BIAS = 2;
/** Which byte of a pixel a plane writes: the third, the second, the first and then the fourth. */
const PLANE_MAP = [2, 1, 0, 3];
/** The control byte that says a byte stands for the pixel it is written at. */
const CONTROL_SINGLE = 0x00;
/** The control byte from which a run stands for the same byte over and over. */
const CONTROL_REPEAT = 0x81;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface SwgLayout {
	width: number;
	height: number;
	/** The number of planes beyond the two of a colour the walk reads. */
	depth: number;
	bitsPerPixel: number;
	/** The place of the colour map, nought where the picture has none. */
	paletteOffset: number;
	dataOffset: number;
	isCompressed: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `SwgFormat.ReadMetaData`: the file begins with the word `SWG`, the place of the pixels stands at `0x10` and
 * the place of the colour map at `0x14`, both eight bytes behind what they name, the width and the height
 * stand at `0x20` and `0x22`, the number of planes beyond the two of a colour at `0x28`, and a byte at `0x2F`
 * says whether the pixels are walked along. A picture with a colour map is of eight bits a pixel, one of two
 * planes beyond the two of a colour is of thirty two, and every other one of twenty four.
 */
export function readSwgLayout(
	data: Buffer,
	fileLength = data.length,
): SwgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const storedPaletteOffset = data.readUInt32LE(PALETTE_OFFSET_FIELD);
	const paletteOffset =
		storedPaletteOffset !== 0 ? storedPaletteOffset + HEADER_BIAS : 0;
	const depth = data[DEPTH_FIELD] ?? 0;
	const bitsPerPixel = paletteOffset !== 0 ? 8 : depth === 2 ? 32 : 24;
	const stride = width * (bitsPerPixel >> 3);
	if (stride * height > LIMIT) return undefined;
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD) + HEADER_BIAS;
	if (dataOffset > fileLength || dataOffset < HEADER_SIZE) return undefined;
	if (paletteOffset !== 0 && paletteOffset + 0x400 > fileLength) {
		return undefined;
	}
	return {
		width,
		height,
		depth,
		bitsPerPixel,
		paletteOffset,
		dataOffset,
		isCompressed: (data[COMPRESSED_FIELD] ?? 0) !== 0,
	};
}

/** The colour map, an entry of four bytes a colour where the reference reads one. */
export function readSwgPalette(stored: Buffer, layout: SwgLayout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (0 === layout.paletteOffset) return palette;
	stored.copy(
		palette,
		0,
		layout.paletteOffset,
		Math.min(layout.paletteOffset + 0x400, stored.length),
	);
	return palette;
}

/** Where the walk of a row stands, which the reference keeps in the stream itself. */
export class SwgCursor {
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

	get remaining(): number {
		return this.#data.length - this.#position;
	}

	byte(): number {
		if (this.#position >= this.#data.length) {
			throw invalidPicture("Splush Wave picture is cut short of its pixels");
		}
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	read(count: number): Buffer {
		if (this.#position + count > this.#data.length) {
			throw invalidPicture("Splush Wave picture is cut short of its pixels");
		}
		const bytes = this.#data.subarray(this.#position, this.#position + count);
		this.#position += count;
		return bytes;
	}
}

/**
 * `DecompressRow`: the row of one plane is a walk of runs, every one behind a control byte. A control byte of
 * nought is a byte that stands for the pixel it is written at, one below `0x81` is as many bytes as the byte
 * itself says plus one, each of them standing for a pixel of its own, and one of `0x81` and above is a single
 * byte that stands for as many pixels as reach up to `0x101`. What the reference counts along the row is the
 * size of the walk rather than the pixels it writes.
 */
export function decompressSwgRow(
	cursor: SwgCursor,
	rowSize: number,
	output: Buffer,
	dst: number,
	step: number,
): void {
	let walked = 0;
	while (walked < rowSize) {
		const control = cursor.byte();
		if (CONTROL_SINGLE === control) {
			const value = cursor.byte();
			walked += 2;
			if (dst >= output.length) {
				throw invalidPicture("Splush Wave picture writes past its own plane");
			}
			output[dst] = value;
			dst += step;
		} else if (control < CONTROL_REPEAT) {
			const count = control + 1;
			walked += count + 1;
			for (let index = 0; index < count; index += 1) {
				const value = cursor.byte();
				if (dst >= output.length) {
					throw invalidPicture("Splush Wave picture writes past its own plane");
				}
				output[dst] = value;
				dst += step;
			}
		} else {
			const value = cursor.byte();
			walked += 2;
			const count = 0x101 - control;
			for (let index = 0; index < count; index += 1) {
				if (dst >= output.length) {
					throw invalidPicture("Splush Wave picture writes past its own plane");
				}
				output[dst] = value;
				dst += step;
			}
		}
	}
}

/**
 * The walk of the whole picture: what stands at the pixels is read twice over, once as a word of two bytes
 * that says how they are walked and, where that says nothing of the kind, once more four bytes in, where the
 * same word stands again — the second being the shape of a picture that carries a size of its own in front of
 * it. A walk of nought reads every plane as it stands, a byte a pixel in turn, and a walk of one reads a word
 * of two bytes for every row of every plane and then the rows themselves, from the last of a plane to the
 * first, every plane writing the byte of the pixel the map above says.
 */
export function unpackSwg(stored: Buffer, layout: SwgLayout): Buffer {
	const channels = layout.depth + PLANE_BIAS;
	const stride = layout.width * (layout.bitsPerPixel >> 3);
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const cursor = new SwgCursor(stored, layout.dataOffset);
	let high = cursor.byte();
	let low = cursor.byte();
	if (0 !== high || 1 !== low) {
		cursor.position = layout.dataOffset;
		let empty = 0;
		for (let plane = 0; plane < channels; plane += 1) {
			if (0 === cursor.byte()) empty += 1;
		}
		if (empty !== channels) {
			throw invalidPicture(
				"Splush Wave picture is walked along in a way it does not know",
			);
		}
		cursor.position = layout.dataOffset + 4;
		high = cursor.byte();
		low = cursor.byte();
	}
	const method = low | (high << 8);
	if (0 === method) {
		// Every plane stands as it is, a byte a pixel in turn.
		for (let plane = 0; plane < channels; plane += 1) {
			let position = plane;
			for (let count = layout.height * layout.width; count > 0; count -= 1) {
				const value = cursor.byte();
				if (position < output.length) output[position] = value;
				position += channels;
			}
		}
		return output;
	}
	if (1 !== method) {
		throw invalidPicture(
			"Splush Wave picture is walked along in a way it does not know",
		);
	}
	const rowSizes = cursor.read(2 * layout.height * channels);
	let control = 0;
	for (let plane = 0; plane < channels; plane += 1) {
		for (let row = layout.height - 1; row >= 0; row -= 1) {
			const dst = stride * row + (PLANE_MAP[plane] ?? 0);
			const rowSize =
				((rowSizes[control] ?? 0) << 8) | (rowSizes[control + 1] ?? 0);
			control += 2;
			decompressSwgRow(cursor, rowSize, output, dst, channels);
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const splushWaveSwgImageDescriptor: FormatDescriptor = {
	id: "splush-wave-swg-image",
	name: "Splush Wave Graphics format",
	extensions: ["swg"],
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
			source: "Legacy/SplushWave/ImageSWG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const splushWaveSwgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: splushWaveSwgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readSwgLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readSwgLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Splush Wave picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: layout.isCompressed,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					depth: layout.depth,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.isCompressed ? "planes" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readSwgLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Splush Wave picture");
		}
		const stride = layout.width * (layout.bitsPerPixel >> 3);
		const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
		if (layout.isCompressed) {
			unpackSwg(stored, layout).copy(pixels);
		} else {
			// What the reference reads and does not get stands as nought, as its own walk of the stream
			// would leave it.
			stored.copy(
				pixels,
				0,
				layout.dataOffset,
				Math.min(layout.dataOffset + pixels.length, stored.length),
			);
		}
		const { width, height, bitsPerPixel } = layout;
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (8 === bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(
					width,
					height,
					pixels,
					readSwgPalette(stored, layout),
					true,
				),
			]);
		}
		if (32 === bitsPerPixel) {
			return Readable.from([writeBmp32(width, height, pixels, true)]);
		}
		return Readable.from([writeBmp24(width, height, pixels, true)]);
	},
});
