// Format reference: GARBro "ArcFormats/Silky/ImageMSK.cs", class `RmskFormat` with the `RmskReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word the mask opens with. */
const SIGNATURE = Buffer.from("Rmsk", "latin1");
const OFFSET_X_FIELD = 4;
const OFFSET_Y_FIELD = 6;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0x0a;
/** The byte that names which of the two ways the mask is stored with, and where its bits begin. */
const FLAG_FIELD = 0x0c;
const DATA_OFFSET = 0x0e;
/** A mask of this engine is always a byte to the pixel. */
const BITS_PER_PIXEL = 8;
/** The places a copy may reach, in whole pixels, before and behind the pixel it stands at. */
const OFFSET_TABLE_8 = [-1, -2, -4, -6, -8, -12, -16, -20];
const OFFSET_TABLE_16 = [
	-20, -16, -12, -8, -6, -4, -2, -1, 0, 1, 2, 4, 6, 8, 12, 16,
];
/** The two ways, and the flag that tells them apart: the lowest bit of the byte at 0xC. */
const FLAG_COLUMNS = 1;
/** A mask this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface RmskLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** Whether the mask is stored in columns rather than rows. */
	columns: boolean;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function placeInTable(table: readonly number[], index: number): number {
	const value = table[index];
	if (undefined === value)
		throw invalidImage("A copy of the mask names no place");
	return value;
}

/**
 * `RmskFormat.ReadMetaData` and the head of the reader: a mask always holds a byte to the pixel, and the byte
 * at 0xC names the way it is stored - the lowest bit set meaning its pixels stand in columns - with its bits
 * beginning behind the byte that follows.
 */
export function readRmskLayout(data: Buffer): RmskLayout | undefined {
	if (data.length <= DATA_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt16LE(OFFSET_X_FIELD),
		offsetY: data.readInt16LE(OFFSET_Y_FIELD),
		columns: 0 !== ((data[FLAG_FIELD] ?? 0) & FLAG_COLUMNS),
	};
}

/** The length of a copy, which six branches of a bit each name. */
function readCopyCount(bits: MsbBitReader): number {
	if (1 === bits.readBits(1)) return bits.readBits(1) + 2;
	if (1 === bits.readBits(1)) return bits.readBits(2) + 4;
	if (1 === bits.readBits(1)) return bits.readBits(3) + 8;
	if (1 === bits.readBits(1)) return bits.readBits(6) + 16;
	if (1 === bits.readBits(1)) return bits.readBits(8) + 80;
	return bits.readBits(10) + 336;
}

function copyByte(output: Buffer, destination: number, source: number): void {
	if (source < 0 || source >= output.length) {
		throw invalidImage("A copy of the mask reaches outside it");
	}
	if (destination < 0 || destination >= output.length) {
		throw invalidImage("The mask reaches past its own pixels");
	}
	output[destination] = output[source] ?? 0;
}

/**
 * `RmskReader.UnpackV0`: the rows are walked from the **last** row up, and a row is written left to right -
 * a byte of its own, or a copy whose place stands in the same row, in the row behind it or in the row in
 * front of it, and whose length six branches of a bit name.
 */
/**
 * `RmskReader.UnpackV0`: the rows are walked from the **last** row up, and a row is written left to right -
 * a byte of its own, or a copy whose place stands in the same row, in the row behind it or in the row in
 * front of it, and whose length six branches of a bit name.
 */
function unpackRows(
	output: Buffer,
	layout: RmskLayout,
	bits: MsbBitReader,
): void {
	const { width, height } = layout;
	let line = width * (height - 1);
	for (let row = 0; row < height; row += 1) {
		let destination = line;
		let column = width;
		while (column > 0) {
			if (0 === bits.readBits(1)) {
				let source: number;
				const narrow = bits.readBits(1);
				if (1 === narrow) {
					if (0 === bits.readBits(1)) {
						source =
							destination + placeInTable(OFFSET_TABLE_8, bits.readBits(3));
					} else {
						source =
							width +
							destination +
							placeInTable(OFFSET_TABLE_16, bits.readBits(4));
					}
				} else {
					source = destination;
					const above = bits.readBits(1);
					if (1 === above) {
						source += width * (bits.readBits(1) + 2);
					} else {
						source += width * (bits.readBits(2) + 4);
					}
					source += placeInTable(OFFSET_TABLE_16, bits.readBits(4));
				}
				const count = readCopyCount(bits);
				for (let at = 0; at < count; at += 1) {
					copyByte(output, destination, source);
					destination += 1;
					source += 1;
				}
				column -= count;
			} else {
				if (destination >= output.length) {
					throw invalidImage("The mask reaches past its own pixels");
				}
				output[destination] = bits.readBits(BITS_PER_PIXEL);
				destination += 1;
				column -= 1;
			}
		}
		line -= width;
	}
}

/**
 * `RmskReader.UnpackV1`: the same, with the pixels standing in **columns**: the walk begins at the last
 * column and runs down it, and a copy names its place in the column behind, the column in front, or the place
 * right beside it in the same row.
 */
function unpackColumns(
	output: Buffer,
	layout: RmskLayout,
	bits: MsbBitReader,
): void {
	const { width, height } = layout;
	let column = width * (height - 1);
	for (let x = 0; x < width; x += 1) {
		let destination = column;
		let line = height;
		while (line > 0) {
			if (0 !== bits.readBits(1)) {
				if (destination < 0 || destination >= output.length) {
					throw invalidImage("The mask reaches past its own pixels");
				}
				output[destination] = bits.readBits(BITS_PER_PIXEL);
				destination -= width;
				line -= 1;
			} else {
				let source: number;
				// Every branch reads a bit of its own, so they are taken into names in turn rather than
				// written as one chain whose conditions would all read alike.
				const first = bits.readBits(1);
				if (1 === first) {
					if (0 === bits.readBits(1)) {
						source =
							destination -
							width * placeInTable(OFFSET_TABLE_8, bits.readBits(3));
					} else {
						source =
							destination -
							1 -
							width * placeInTable(OFFSET_TABLE_16, bits.readBits(4));
					}
				} else {
					const second = bits.readBits(1);
					if (1 === second) {
						const beside = destination - 2 - bits.readBits(1);
						source =
							beside - width * placeInTable(OFFSET_TABLE_16, bits.readBits(4));
					} else {
						const beside = destination - 4 - bits.readBits(2);
						source =
							beside - width * placeInTable(OFFSET_TABLE_16, bits.readBits(4));
					}
				}
				const count = readCopyCount(bits);
				line -= count;
				for (let at = 0; at < count; at += 1) {
					copyByte(output, destination, source);
					source -= width;
					destination -= width;
				}
			}
		}
		column += 1;
	}
}

/** `RmskReader.Unpack`: the way the byte at 0xC names, over a bit stream that begins at 0xE. */
export function unpackRmsk(data: Buffer, layout: RmskLayout): Buffer {
	const bits = new MsbBitReader(data, DATA_OFFSET);
	const output = Buffer.alloc(layout.width * layout.height, 0x00);
	if (layout.columns) {
		unpackColumns(output, layout, bits);
	} else {
		unpackRows(output, layout, bits);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rmskImageDescriptor: FormatDescriptor = {
	id: "silky-rmsk-image",
	name: "Silky's bitmap mask",
	extensions: ["msk"],
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
			source: "ArcFormats/Silky/ImageMSK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rmskImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rmskImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(DATA_OFFSET)) return false;
		return readRmskLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readRmskLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Silky's mask");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
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
				},
			}),
			// The mask is unfolded and a bitmap is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
				columns: layout.columns,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readRmskLayout(stored);
		if (!layout) throw invalidImage("Not a Silky's mask");
		// The reference builds this picture flipped, so its rows reach the bitmap from the bottom up.
		return Readable.from([
			writeBmp8(layout.width, layout.height, unpackRmsk(stored, layout), true),
		]);
	},
});
