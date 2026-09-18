// Format reference: GARbro "Legacy/CrossNet/ImageGRB.cs", classes `GrbFormat`, `GrbMetaData` and `GrbReader`
// (a CrossNet picture of one or eight bit pixels whose references are told apart by a row code). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp1, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two words the reference registers, which are also the depths it reads. */
const SIGNATURES = [1, 8];
const HEADER_SIZE = 0x18;
const DEPTH_FIELD = 0;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const BITS_OFFSET_FIELD = 8;
const DATA_OFFSET_FIELD = 0x10;
const MIN_OFFSET = HEADER_SIZE;
const MAX_DIMENSION = 0x8000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrbLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The width rounded up to the block the reader walks, and the row it makes. */
	paddedWidth: number;
	stride: number;
	bitsOffset: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GrbFormat.ReadMetaData`: the first word is the depth, of which only one or eight bits is read, the width
 * and the height stand at four and six and must lie between one and `0x8000`, and the offsets of the control
 * bytes and of the literal pixels stand at eight and sixteen, both inside the file and behind the head. The
 * width is then rounded up — to thirty two pixels of one bit and to four pixels of eight — and the row the
 * reader walks is the rounded width, or its eighth for one bit.
 */
export function readGrbLayout(
	data: Buffer,
	fileLength = data.length,
): GrbLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	if (!SIGNATURES.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const bitsOffset = data.readUInt32LE(BITS_OFFSET_FIELD);
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	if (
		width === 0 ||
		width > MAX_DIMENSION ||
		height === 0 ||
		height > MAX_DIMENSION
	) {
		return undefined;
	}
	if (
		bitsOffset >= fileLength ||
		bitsOffset < MIN_OFFSET ||
		dataOffset >= fileLength ||
		dataOffset < MIN_OFFSET
	) {
		return undefined;
	}
	const paddedWidth =
		1 === bitsPerPixel ? (width + 0x1f) & ~0x1f : (width + 3) & ~3;
	const stride = 1 === bitsPerPixel ? paddedWidth / 8 : paddedWidth;
	const size = height * stride;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		paddedWidth,
		stride,
		bitsOffset,
		dataOffset,
	};
}

/** The four places a row code may name, built from the row the reader walks. */
function rowOffsets(stride: number): readonly (readonly number[])[] {
	return [
		[0, -1, -stride, -stride - 1],
		[0, -1, -2, -3],
		[0, -stride, -stride * 2, -stride * 3],
		[0, -stride - 1, -stride, -stride + 1],
	];
}

/**
 * `GrbReader.Unpack`: the colour map of two entries or of two hundred and fifty six stands behind the head,
 * then one byte a row, and the control bytes stand where the head says and the literal pixels where it says.
 * Every control byte carries four pixels of two bits each, read from the **highest** pair down. A pair of
 * nothing is a literal byte from the stream; every other pair names one of four places, told apart by its own
 * value and by the row's own code, and the pixel there is taken again. A place that reaches before the start
 * of the picture is refused, which the reference's own array read answers with an exception (a documented
 * deviation in the message only).
 */
export function unpackGrb(
	data: Buffer,
	layout: GrbLayout,
): { pixels: Buffer; palette: Buffer } {
	const paletteLength = (1 << layout.bitsPerPixel) * 4;
	const paletteStart = HEADER_SIZE;
	const rowsStart = paletteStart + paletteLength;
	const rowsEnd = rowsStart + layout.height;
	if (rowsEnd > data.length) {
		throw invalidPicture("CrossNet picture is cut short of its rows");
	}
	const palette = Buffer.from(data.subarray(paletteStart, rowsStart));
	const blocks = layout.stride >> 2;
	const controlsEnd = layout.bitsOffset + layout.height * blocks;
	if (controlsEnd > data.length) {
		throw invalidPicture("CrossNet picture is cut short of its control bytes");
	}
	const controls = data.subarray(layout.bitsOffset, controlsEnd);
	const output: Buffer = Buffer.alloc(layout.height * layout.stride, 0x00);
	const offsets = rowOffsets(layout.stride);
	let position = layout.dataOffset;
	let source = 0;
	let dst = 0;
	const readByte = (): number => {
		if (position >= data.length) {
			throw invalidPicture("CrossNet picture is cut short of its stream");
		}
		const value = data[position] ?? 0;
		position += 1;
		return value;
	};
	for (let y = 0; y < layout.height; y += 1) {
		const row = data[rowsStart + y] ?? 0;
		const places = offsets[row & 3] ?? offsets[0] ?? [0, 0, 0, 0];
		for (let x = 0; x < blocks; x += 1) {
			const control = controls[source + x] ?? 0;
			for (let pair = 6; pair >= 0; pair -= 2) {
				const code = (control >> pair) & 3;
				let value: number;
				if (code !== 0) {
					const at = dst + (places[code] ?? 0);
					if (at < 0 || at >= output.length) {
						throw invalidPicture(
							"CrossNet picture reads from before its own start",
						);
					}
					value = output[at] ?? 0;
				} else {
					value = readByte();
				}
				if (dst >= output.length) {
					throw invalidPicture("CrossNet picture writes past its own end");
				}
				output[dst] = value;
				dst += 1;
			}
		}
		source += blocks;
	}
	return { pixels: output, palette };
}

/** The rows of the reader's own buffer, which are padded, taken out into the tight pixels a writer wants. */
function compactRows(
	pixels: Buffer,
	height: number,
	stride: number,
	rowBytes: number,
): Buffer {
	const tight = Buffer.alloc(height * rowBytes, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(tight, row * rowBytes, row * stride, row * stride + rowBytes);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<GrbLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readGrbLayout(header, Number(source.size));
	} catch {
		return undefined;
	}
}

export const crossNetGrbImageDescriptor: FormatDescriptor = {
	id: "crossnet-grb-image",
	name: "CrossNet image format",
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
			source: "Legacy/CrossNet/ImageGRB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crossNetGrbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crossNetGrbImageDescriptor,
	detection: {
		signatures: SIGNATURES.map((value) => {
			const bytes = Buffer.alloc(4);
			bytes.writeUInt32LE(value);
			return { bytes };
		}),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a CrossNet picture");
		}
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
					bitsPerPixel: layout.bitsPerPixel,
					stride: layout.stride,
				},
			}),
			// The pixels are unfolded from a walk of control bytes and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a CrossNet picture");
		}
		const stored = await readStored(source);
		const picture = unpackGrb(stored, layout);
		const rowBytes =
			1 === layout.bitsPerPixel ? (layout.width + 7) >> 3 : layout.width;
		const tight = compactRows(
			picture.pixels,
			layout.height,
			layout.stride,
			rowBytes,
		);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		if (1 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp1(layout.width, layout.height, tight, picture.palette, true),
			]);
		}
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				tight,
				picture.palette,
				true,
			),
		]);
	},
});
