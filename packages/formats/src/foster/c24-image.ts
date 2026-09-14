// Format reference: GARbro "ArcFormats/Foster/ImageC24.cs", classes `C24Format` and `C24Decoder`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

export const C24_IMAGE_SIGNATURE: Buffer = Buffer.from([
	0x43, 0x32, 0x34, 0x00,
]);
const HEADER_SIZE = 12;
const COUNT_FIELD = 4;
const INDEX_OFFSET_FIELD = 8;
/** The measurements, the two offsets and where the rows begin: sixteen bytes. */
export const C24_FRAME_HEADER_SIZE = 16;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 4;
const OFFSET_X_FIELD = 8;
const OFFSET_Y_FIELD = 0x0c;
/** The longest run of bytes a one byte count can ask for. */
const LONG_COUNT = 0xff;
const BYTES_PER_PIXEL = 3;
const BITS_PER_PIXEL = 24;
const ROW_OFFSET_SIZE = 4;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

export interface C24ImageLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
	/** Where the table of row offsets begins, right behind the frame's own header. */
	dataOffset: number;
}

/**
 * The reference reads twelve bytes: its word, a count of frames it never looks at again, and the offset of the
 * frame. Behind that offset sit the width, the height, a pair of offsets and the table of rows.
 */
export async function readC24ImageLayout(
	source: ByteSource,
	bitsPerPixel: number,
): Promise<C24ImageLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		// The count is the archive's frame count, which the reference asks to be positive and nothing else.
		if (header.readInt32LE(COUNT_FIELD) <= 0) return undefined;
		const offset = header.readUInt32LE(INDEX_OFFSET_FIELD);
		if (BigInt(offset) + BigInt(C24_FRAME_HEADER_SIZE) > source.size)
			return undefined;
		const frame = Buffer.from(
			await source.readAt(BigInt(offset), C24_FRAME_HEADER_SIZE),
		);
		if (frame.length < C24_FRAME_HEADER_SIZE) return undefined;
		const width = frame.readUInt32LE(WIDTH_FIELD);
		const height = frame.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * BYTES_PER_PIXEL > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			offsetX: frame.readInt32LE(OFFSET_X_FIELD),
			offsetY: frame.readInt32LE(OFFSET_Y_FIELD),
			dataOffset: offset + C24_FRAME_HEADER_SIZE,
		};
	} catch {
		return undefined;
	}
}

/**
 * The table of row offsets the reference reads before anything else, one word a row, standing where the frame's
 * own header ends.
 */
export function readC24RowOffsets(
	file: Buffer,
	dataOffset: number,
	height: number,
): number[] {
	const end = dataOffset + height * ROW_OFFSET_SIZE;
	if (dataOffset < 0 || end > file.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Truncated Foster image rows");
	}
	const rows: number[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(file.readUInt32LE(dataOffset + row * ROW_OFFSET_SIZE));
	}
	return rows;
}

/** The pixels of a row whose run has run out of file: the reference fills the rest with nothing. */
function copyRun(
	file: Buffer,
	at: number,
	output: Buffer,
	dst: number,
	size: number,
): number {
	if (dst < 0 || size < 0 || dst + size > output.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster image run");
	}
	const available = Math.min(size, Math.max(0, file.length - at));
	if (available > 0) file.copy(output, dst, at, at + available);
	return available;
}

/**
 * The reference's decoder for its twenty four bit images. A row is a series of runs that alternate between
 * **filled** and **copied** bytes — every row starts with a fill — and each run is one pixel count with a byte of
 * its own:
 *
 * * a fill writes three bytes of `0xFF` a pixel, so a fill is a white run;
 * * a copy takes three bytes a pixel from the file as they stand;
 * * a count of `0xFF` in a **fill** and a count of `0` in a **copy** are not counts at all but marks that the
 *   real count is a word behind them. The mark is only looked for in the kind of run it belongs to, so a copy of
 *   `0xFF` pixels is written as it stands.
 *
 * The pixel cursor runs on across rows: a row whose runs do not add up to the width leaves the next row to start
 * where it stopped, and a row that adds up to more than the width writes past its own end. Both are what the
 * reference does, and a run that would write past the whole image is refused by the framework it writes through.
 */
export function unpackC24Rows(
	file: Buffer,
	rows: number[],
	width: number,
	output: Buffer,
): void {
	let dst = 0;
	for (const rowOffset of rows) {
		let at = rowOffset;
		let rle = false;
		for (let x = 0; x < width; ) {
			if (at >= file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Foster image row");
			}
			let count = file[at] ?? 0;
			at += 1;
			if (!rle) {
				if (count === LONG_COUNT) {
					if (at + 2 > file.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Truncated Foster image run",
						);
					}
					count = (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
					at += 2;
				}
				const size = count * BYTES_PER_PIXEL;
				if (dst < 0 || size < 0 || dst + size > output.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster image run");
				}
				output.fill(0xff, dst, dst + size);
				dst += size;
			} else {
				if (count === 0) {
					if (at + 2 > file.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Truncated Foster image run",
						);
					}
					count = (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
					at += 2;
				}
				at += copyRun(file, at, output, dst, count * BYTES_PER_PIXEL);
				dst += count * BYTES_PER_PIXEL;
			}
			x += count;
			rle = !rle;
		}
	}
}

export const fosterC24ImageDescriptor: FormatDescriptor = {
	id: "foster-c24-image",
	name: "Foster game engine image",
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
			source: "ArcFormats/Foster/ImageC24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fosterC24ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fosterC24ImageDescriptor,
	detection: { signatures: [{ bytes: C24_IMAGE_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readC24ImageLayout(source, BITS_PER_PIXEL)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readC24ImageLayout(source, BITS_PER_PIXEL);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					dataOffset: layout.dataOffset,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "run-length",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readC24ImageLayout(source, BITS_PER_PIXEL);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster image");
		const { width, height, dataOffset } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const rows = readC24RowOffsets(file, dataOffset, height);
		const pixels: Buffer = Buffer.alloc(width * height * BYTES_PER_PIXEL, 0x00);
		unpackC24Rows(file, rows, width, pixels);
		return Readable.from([writeBmp24(width, height, pixels, false)]);
	},
});
