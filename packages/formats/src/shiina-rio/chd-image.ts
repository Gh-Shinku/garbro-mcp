// Format reference: GARbro "ArcFormats/ShiinaRio/ImageCHD.cs", classes `ChdFormat`, `ChdMetaData` and
// `ChdReader` (Forest image format, the predecessor of the ShiinaRio pictures). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `'CHD\0'`. */
const SIGNATURE = 0x00444843;
const COUNT_FIELD = 4;
/** The index stands behind the two words of the header. */
const INDEX_FIELD = 12;
const MAXIMUM_COUNT = 0xfffff;
/** What stands in front of the measurements at the head of the picture. */
const PLACEMENT_SIZE = 0x10;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 4;
const OFFSET_X_FIELD = 8;
const OFFSET_Y_FIELD = 0xc;
/** The depth the reference writes down, though the pixels it unfolds are one byte of grey each. */
const BPP = 32;
const END_OF_ROW = 0xff;
/** What every pixel of a run carries on top of the byte the stream holds. */
const PIXEL_BIAS = 0x57;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface ChdLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The first place named by the index, which holds the measurements. */
	firstOffset: number;
	/** Where the row offsets stand, sixteen bytes behind that place. */
	rowsOffset: number;
}

/**
 * `ChdFormat.ReadMetaData`: a count of index words behind the signature, which must be a number that fits in
 * twenty bits and must name at least one place — the first that is not nothing, past everything the index
 * holds. There stand the measurements and the place of the picture, and sixteen bytes behind them the offsets
 * of the rows.
 */
export function readChdLayout(data: Buffer): ChdLayout | undefined {
	if (data.length < INDEX_FIELD) return undefined;
	if (data.readUInt32LE(0) !== SIGNATURE) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	if (count < 0 || count > MAXIMUM_COUNT) return undefined;
	if (data.length < INDEX_FIELD + count * 4) return undefined;
	let firstOffset = 0;
	for (let index = 0; index < count && 0 === firstOffset; index += 1) {
		firstOffset = data.readUInt32LE(INDEX_FIELD + index * 4);
	}
	if (0 === firstOffset) return undefined;
	if (firstOffset + PLACEMENT_SIZE > data.length) return undefined;
	return {
		width: data.readUInt32LE(firstOffset + WIDTH_FIELD),
		height: data.readUInt32LE(firstOffset + HEIGHT_FIELD),
		offsetX: data.readInt32LE(firstOffset + OFFSET_X_FIELD),
		offsetY: data.readInt32LE(firstOffset + OFFSET_Y_FIELD),
		firstOffset,
		rowsOffset: firstOffset + PLACEMENT_SIZE,
	};
}

/** How many bytes of picture the measurements describe. */
export function chdPixelLength(layout: ChdLayout): number {
	return layout.width * layout.height;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `ChdReader.Unpack`: the offsets of the rows stand at the head of the picture, one word each, and every row
 * is packed as pairs of a count to pass over and a count of bytes to read — either count a single byte, or the
 * byte `0xFF` and the count as a word behind it. A count to pass over that is exactly what is left of the row
 * ends it. Every byte a run reads carries `0x57` on top of what the stream holds, and one the stream does not
 * reach carries it on top of what stood there, which is nothing in a row nothing has written to yet.
 *
 * The count to pass over moves the reader's **place in the row** but not the place it writes to, which the
 * reference advances by the count of bytes alone; the port keeps that arithmetic as it stands. A run that
 * reaches past the end of the picture is refused, because the .NET array the reference reads into throws
 * there, while a run that reaches past the end of its **row** is not — it writes into the row behind it.
 */
export function unpackChdRows(data: Buffer, layout: ChdLayout): Buffer {
	const length = chdPixelLength(layout);
	if (!Number.isSafeInteger(length) || length <= 0) {
		throw invalidPicture("Forest picture of no size");
	}
	if (length > MAXIMUM_PICTURE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Forest picture of ${length} bytes is too large`,
		);
	}
	if (layout.rowsOffset + layout.height * 4 > data.length) {
		throw invalidPicture("Forest picture is cut short of its rows");
	}
	const rows: number[] = [];
	for (let index = 0; index < layout.height; index += 1) {
		rows.push(data.readUInt32LE(layout.rowsOffset + index * 4));
	}
	const output: Buffer = Buffer.alloc(length, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		let position = rows[row] ?? 0;
		let dst = row * layout.width;
		let left = layout.width;
		while (left > 0) {
			if (position >= data.length) {
				throw invalidPicture("Forest picture is cut short of its pixels");
			}
			let skip = data[position] ?? 0;
			position += 1;
			if (END_OF_ROW === skip) {
				if (position + 2 > data.length) {
					throw invalidPicture("Forest picture is cut short of its pixels");
				}
				skip = data.readUInt16LE(position);
				position += 2;
			}
			const reached = left - skip;
			if (0 === reached) break;
			if (position >= data.length) {
				throw invalidPicture("Forest picture is cut short of its pixels");
			}
			let count = data[position] ?? 0;
			position += 1;
			if (0 === count) {
				if (position + 2 > data.length) {
					throw invalidPicture("Forest picture is cut short of its pixels");
				}
				count = data.readUInt16LE(position);
				position += 2;
			}
			if (dst + count > output.length) {
				throw invalidPicture("Forest picture holds a run past its end");
			}
			const available = Math.min(count, data.length - position);
			for (let index = 0; index < count; index += 1) {
				const held =
					index < available
						? (data[position + index] ?? 0)
						: (output[dst + index] ?? 0);
				output[dst + index] = (held + PIXEL_BIAS) & 0xff;
			}
			position += available;
			dst += count;
			left = reached - count;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const shiinaRioChdImageDescriptor: FormatDescriptor = {
	id: "shiina-rio-chd-image",
	name: "Forest image format",
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
			source: "ArcFormats/ShiinaRio/ImageCHD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const shiinaRioChdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: shiinaRioChdImageDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0x43, 0x48, 0x44, 0x00]) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(INDEX_FIELD)) return false;
		return readChdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readChdLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Forest picture");
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
							bitsPerPixel: BPP,
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BPP,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readChdLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a Forest picture");
		}
		const pixels = unpackChdRows(stored, layout);
		return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
	},
});
