// Format reference: GARbro "ArcFormats/Tanaka/ImageBC.cs", classes `BcFormat`, `TxMetaData` and `TxReader`
// (a bitmap of the Tanaka Tatsuhiro engine with a block of its own behind a plain bitmap head, holding three
// rows to walk back to and the pixels themselves walked along with a delta). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB555_MASKS,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two letters the head begins with. */
const MARK = Buffer.from("BC", "latin1");
const HEADER_SIZE = 0x36;
const DATA_OFFSET_FIELD = 0x0a;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const DEPTH_FIELD = 0x1c;
const COLORS_FIELD = 0x2e;
/** The word the block the pixels stand in begins with, 'TX04'. */
const BLOCK_MARK = 0x34305854;
/** The two letters behind the size of the rows and the height again. */
const BLOCK_HEADER_SIZE = 8;
/** The depths the head may name. */
const DEPTHS = [8, 16, 24, 32];
/** The colours of the colour map of an eight bit picture where the head gives none. */
const DEFAULT_COLORS = 0x100;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface TxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The size of a row as the head gives it, which is what the walks of the block count rows with. */
	stride: number;
	/** The size of a row the block is laid out with, the one above rounded up to four bytes. */
	alignedStride: number;
	colors: number;
	/** The place the pixels stand at, behind the block's own eight bytes. */
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BcFormat.ReadMetaData`: the head begins with the two letters `BC`, the place of the block stands at
 * `0x0A`, the width and the height at `0x12` and `0x16` as words, the depth at `0x1C` as a word of two bytes,
 * and the count of colours at `0x2E` — nought or less meaning the two hundred and fifty six of a full eight
 * bit map. The block itself begins with the word `TX04`, the size of a row and then the height again, and
 * both have to agree with the head.
 */
export function readTxLayout(
	data: Buffer,
	fileLength = data.length,
): TxLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const bitsPerPixel = data.readInt16LE(DEPTH_FIELD);
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width * (bitsPerPixel >> 3) > LIMIT || height > LIMIT) return undefined;
	const declared = data.readInt32LE(COLORS_FIELD);
	const colors = declared <= 0 ? DEFAULT_COLORS : declared;
	if (8 === bitsPerPixel && HEADER_SIZE + colors * 4 > fileLength) {
		return undefined;
	}
	const blockOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	if (blockOffset + BLOCK_HEADER_SIZE > fileLength) return undefined;
	if (BLOCK_MARK !== data.readUInt32LE(blockOffset)) return undefined;
	const stride = data.readUInt16LE(blockOffset + 4);
	// The height stands again as a word of two bytes, so a picture taller than that can never agree.
	if (data.readUInt16LE(blockOffset + 6) !== height) return undefined;
	if (stride === 0) return undefined;
	const alignedStride = (stride + 3) & ~3;
	const plane = alignedStride * height;
	if (plane > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		stride,
		alignedStride,
		colors,
		dataOffset: blockOffset + BLOCK_HEADER_SIZE,
	};
}

/** The colour map of the picture, spread over four byte entries as a bitmap wants it. */
export function readTxPalette(stored: Buffer, layout: TxLayout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	if (8 !== layout.bitsPerPixel) return palette;
	for (let entry = 0; entry < layout.colors && entry < 0x100; entry += 1) {
		const at = HEADER_SIZE + entry * 4;
		palette[entry * 4] = stored[at] ?? 0;
		palette[entry * 4 + 1] = stored[at + 1] ?? 0;
		palette[entry * 4 + 2] = stored[at + 2] ?? 0;
	}
	return palette;
}

/**
 * `Binary.CopyOverlapped`: a byte at a time, which is what a run that reads the bytes it has just written
 * needs. Where the walk points behind the beginning of the picture the reference would read outside its own
 * array, so the port refuses the picture instead (a documented deviation in the message only).
 */
function copyOverlapped(
	buffer: Buffer,
	source: number,
	dst: number,
	count: number,
): void {
	if (source < 0) {
		throw invalidPicture(
			"Tanaka picture walks behind the beginning of its own pixels",
		);
	}
	for (let index = 0; index < count; index += 1) {
		buffer[dst + index] = buffer[source + index] ?? 0;
	}
}

/**
 * `TxReader.Decompress`: two bytes stand as they are and then the walks follow, every one of them behind a
 * byte that says which walk it is:
 *
 * * `111xxxxx` — the five lower places are how many bytes stand as they are, less one;
 * * `110xxxxx` — the places are an offset of five bits into the row and the byte behind says how many bytes
 *   are copied from that place backwards;
 * * `00xxxxxx` — three places of offset and three of count, a count of seven meaning the count stands in the
 *   byte behind, all within the row the walk stands in;
 * * `01xxxxxx` — four places of offset and two of count, read the same way, from the row above;
 * * `10xxxxxx` — the same, from the row two above.
 */
export function unpackTx(stored: Buffer, layout: TxLayout): Buffer {
	const pixelSize = layout.bitsPerPixel >> 3;
	const output: Buffer = Buffer.alloc(
		layout.alignedStride * layout.height,
		0x00,
	);
	let position = layout.dataOffset;
	if (position + 2 > stored.length) {
		throw invalidPicture("Tanaka picture is cut short of its pixels");
	}
	output[0] = stored[position] ?? 0;
	output[1] = stored[position + 1] ?? 0;
	position += 2;
	let dst = 2;
	while (dst < output.length) {
		if (position >= stored.length) break;
		let count = stored[position] ?? 0;
		position += 1;
		if (0xe0 === (count & 0xe0)) {
			count = Math.min((count & 0x1f) + 1, output.length - dst);
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = stored[position + index] ?? 0;
			}
			position += count;
			dst += count;
			continue;
		}
		let offset: number;
		let source: number;
		if (0xc0 === (count & 0xe0)) {
			if (position >= stored.length) {
				throw invalidPicture("Tanaka picture is cut short of its runs");
			}
			// This is how it stands in the original code: the byte behind adds its five lower places.
			offset = (count + ((stored[position] ?? 0) << 5)) & 0x1f;
			position += 1;
			count = stored[position] ?? 0;
			position += 1;
			source = dst - 1 - offset;
		} else if (0 === (count & 0xc0)) {
			offset = (count >> 3) & 7;
			count &= 7;
			if (7 !== count) count += 2;
			else {
				count = stored[position] ?? 0;
				position += 1;
			}
			source = dst - 1 - offset;
		} else if (0x40 === (count & 0xc0)) {
			offset = (count >> 2) & 0xf;
			count &= 3;
			if (3 !== count) count += 2;
			else {
				count = stored[position] ?? 0;
				position += 1;
			}
			source = dst - layout.stride + offset - 8;
		} else {
			offset = (count >> 2) & 0xf;
			count &= 3;
			if (3 !== count) count += 2;
			else {
				count = stored[position] ?? 0;
				position += 1;
			}
			source = dst - layout.stride * 2 + offset - 8;
		}
		count = Math.min(count, output.length - dst);
		copyOverlapped(output, source, dst, count);
		dst += count;
	}
	if (pixelSize > 1) {
		// Every pixel stands as the difference from the one before it, of the row it stands in — the rows
		// stepping by the size the head gives, which is the one the block was laid out with.
		const length = layout.stride * layout.height;
		for (let row = 0; row < length; row += layout.stride) {
			let at = row;
			for (let x = 1; x < layout.width; x += 1) {
				for (let index = 0; index < pixelSize; index += 1) {
					output[at + pixelSize + index] =
						((output[at + pixelSize + index] ?? 0) +
							(output[at + index] ?? 0)) &
						0xff;
				}
				at += pixelSize;
			}
		}
	}
	return output;
}

/** The rows the block was laid out with, gathered into the size a bitmap lays its rows out with. */
function packRows(buffer: Buffer, layout: TxLayout): Buffer {
	const rowBytes = layout.width * (layout.bitsPerPixel >> 3);
	const tight: Buffer = Buffer.alloc(rowBytes * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		const from = row * layout.alignedStride;
		const available = Math.min(rowBytes, buffer.length - from);
		if (available <= 0) break;
		buffer.copy(tight, row * rowBytes, from, from + available);
	}
	return tight;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const tanakaBcImageDescriptor: FormatDescriptor = {
	id: "tanaka-bc-image",
	name: "Tanaka Tatsuhiro's engine image format",
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
			source: "ArcFormats/Tanaka/ImageBC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tanakaBcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tanakaBcImageDescriptor,
	// The reference registers no signature at all and is reached by its extension.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readTxLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readTxLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Tanaka Tatsuhiro picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					stride: layout.stride,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lz77",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readTxLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Tanaka Tatsuhiro picture");
		}
		const rows = packRows(unpackTx(stored, layout), layout);
		const { width, height, bitsPerPixel } = layout;
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (8 === bitsPerPixel) {
			return Readable.from([
				writeBmp8Palette(
					width,
					height,
					rows,
					readTxPalette(stored, layout),
					true,
				),
			]);
		}
		if (16 === bitsPerPixel) {
			return Readable.from([
				writeBmp16(width, height, rows, true, RGB555_MASKS),
			]);
		}
		if (24 === bitsPerPixel) {
			return Readable.from([writeBmp24(width, height, rows, true)]);
		}
		return Readable.from([writeBmp32(width, height, rows, true)]);
	},
});
