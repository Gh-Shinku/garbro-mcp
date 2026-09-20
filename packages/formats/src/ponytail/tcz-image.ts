// Format reference: GARbro "Legacy/Ponytail/ImageTCZ.cs", classes `TczFormat` and `TczReader` (a Ponytail
// Soft picture of the second kind: its places stand column by column in a buffer that holds sixteen columns,
// and a step of its walk either copies places that stand behind it or takes a byte out of the place two
// behind). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The word the format registers is the word of the first kind, and the two are told apart by the word behind
// it: this one names itself `2.5`. `TczReader` stands over the reader of the first kind, so the run of places
// in front of a step and the words the walk reads whole come from the same place here.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	getBits,
	nextBit,
	PALETTE_FIELD,
	PALETTE_SIZE,
	readBitLength,
	readTszPalette,
	type TszCursor,
} from "./tsz-image.js";

/** 'NMI ', the word the reference registers, which it shares with the first kind of its pictures. */
const SIGNATURE = Buffer.from("NMI ", "latin1");
/** The word behind the word of the format, which stands this kind apart from the first one. */
const VERSION = "2.5\0";
const VERSION_FIELD = 0x04;
const HEADER_SIZE = 0x10;
/** The width of the picture stands in the word at `0x0C` and its height in the word behind it, the places of
 * the picture standing beside each other rather than in fours, and how far the picture stands from the corner
 * of its own place in the first two words behind the width of the format. */
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x0e;
/** `TczReader.MaxHeight` and the buffer it walks over: sixteen columns of that height. */
const MAXIMUM_HEIGHT = 0x190;
const BUFFER_SIZE = MAXIMUM_HEIGHT * 0x10;
/** How many columns of the buffer are gathered into the four bytes of a row, and how many columns it holds. */
const GATHER_COLUMNS = 4;
const COLUMNS = 16;
/** `TczReader.s_offTable0` and `s_offTable1`. */
const OFFSET_TABLE_0 = [-4, -3, -2, -1, 0, 1, 2, 3];
const OFFSET_TABLE_1 = [
	-16, -8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 10, 16,
];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface TczLayout {
	/** The places of the picture, two of them standing in every byte of a row. */
	width: number;
	height: number;
	/** How many bytes stand in a row of the picture. */
	stride: number;
	/** How far the picture stands from the corner of its own place, which the reference keeps and does not use
	 * while gathering the places of the picture. */
	originX: number;
	originY: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `TczFormat.ReadMetaData`: the word `NMI ` stands at the beginning of the file with the word `2.5` behind it,
 * the width of the picture stands in the word at `0x0C` and its height in the word behind it.
 */
export function readTczLayout(
	data: Buffer,
	fileLength = data.length,
): TczLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", VERSION_FIELD, VERSION_FIELD + VERSION.length) !==
		VERSION
	) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (height > MAXIMUM_HEIGHT) return undefined;
	if (width * height > LIMIT) return undefined;
	return {
		width,
		height,
		stride: width >> 1,
		originX: data.readInt16LE(0x08),
		originY: data.readInt16LE(0x0a),
	};
}

/**
 * `TczReader.Unpack`: the places of the picture stand column by column in a buffer that holds sixteen columns
 * of the greatest height a picture of this kind takes. Every column holds as many places as the picture is
 * high, and a step of the walk either copies a run of places or takes one place out of the place two behind.
 *
 * | the places in front of the step | what the step does |
 * | ------------------------------- | ------------------ |
 * | `0` then none, one, or two words of four places | one place gathered out of the place two behind, the places of the step naming the two ends of it |
 * | `1 0` and four places | a run whose places stand as many lines behind the column at hand as the four places name |
 * | `1 1 0` and two places | a run whose places stand four, three or two places behind the column at hand each way |
 * | `1 1 1 0` and three places | a run whose places stand two whole columns behind the column at hand, and as many places as the three name |
 * | `1 1 1 1 0` | the same, four columns behind |
 * | `1 1 1 1 1` | the same, eight columns behind |
 *
 * Every four columns the picture holds are gathered into the four bytes of a row, and the column the walk
 * stands over next stands sixteen columns further on, so that the four columns of a group are gathered as soon
 * as they all stand in the buffer.
 */
export function decodeTcz(data: Buffer, layout: TczLayout): Buffer {
	const palette = readTszPalette(data);
	const pixels: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const buffer: Buffer = Buffer.alloc(BUFFER_SIZE + MAXIMUM_HEIGHT, 0x00);
	buffer[0] = 3;
	buffer[1] = 3;
	const offsets0 = new Uint16Array(COLUMNS);
	const offsets1 = new Uint16Array(COLUMNS);
	let at = 2;
	for (let column = 0; column < COLUMNS; column += 1) {
		offsets1[column] = (((COLUMNS - column) & 0x0f) * MAXIMUM_HEIGHT) & 0xffff;
		offsets0[column] = at;
		at += MAXIMUM_HEIGHT;
	}
	const cursor: TszCursor = {
		data,
		position: PALETTE_FIELD + PALETTE_SIZE,
		bits: 0,
		count: 0,
	};
	let dst = 2;
	let outputAt = 0;
	for (let x = 0; x < layout.stride; x += 1) {
		let y = 0;
		while (y < layout.height) {
			if (nextBit(cursor)) {
				let source = dst;
				// The places in front of the step are read one at a time, and every one of them names a
				// nearer column than the one before it.
				const behind = nextBit(cursor);
				if (!behind) {
					source += offsets1[1] ?? 0;
					source += OFFSET_TABLE_1[getBits(cursor, 4)] ?? 0;
				} else {
					const near = nextBit(cursor);
					if (!near) {
						source += getBits(cursor, 2) - 4;
					} else {
						const far = nextBit(cursor);
						if (!far) source += offsets1[2] ?? 0;
						else {
							const wide = nextBit(cursor);
							source += wide ? (offsets1[8] ?? 0) : (offsets1[4] ?? 0);
						}
						source += OFFSET_TABLE_0[getBits(cursor, 3)] ?? 0;
					}
				}
				source &= 0xffff;
				const count = readBitLength(cursor) + 1;
				if (!copyOverlapped(buffer, source, dst, count)) {
					throw invalidPicture("NMI picture walks beyond its own places");
				}
				y += count;
				dst += count;
			} else {
				if (dst < 2) {
					throw invalidPicture("NMI picture walks beyond its own places");
				}
				let value = (buffer[dst - 2] ?? 0) & 0xff;
				value = ((value << 8) | value) & 0xf00f;
				if (nextBit(cursor)) {
					const high = getBits(cursor, 4);
					value = (value & 0xff) | (high << 12);
				}
				if (nextBit(cursor)) {
					const low = getBits(cursor, 4);
					value = (value & 0xff00) | low;
				}
				value = ((value & 0xff) | (value >> 8)) & 0xff;
				if (dst >= buffer.length) {
					throw invalidPicture("NMI picture walks beyond its own places");
				}
				buffer[dst] = value;
				dst += 1;
				y += 1;
			}
		}
		const column = x + 1;
		if (0 === (column & (GATHER_COLUMNS - 1))) {
			gatherTczScanline(
				buffer,
				offsets0[(column - 1) & 0x0c] ?? 0,
				pixels,
				outputAt,
				layout,
			);
			outputAt += GATHER_COLUMNS;
		}
		const place = column & 0x0f;
		dst = offsets0[place] ?? 0;
		if (0 !== place) {
			offsets1[place] = ((offsets1[place] ?? 0) - BUFFER_SIZE) & 0xffff;
		} else {
			for (let index = 1; index < COLUMNS; index += 1) {
				offsets1[index] = ((offsets1[index] ?? 0) + BUFFER_SIZE) & 0xffff;
			}
		}
	}
	return writeBmp4(layout.width, layout.height, pixels, palette);
}

/** `TczReader.CopyScanline`: the four columns of a group are gathered into the four bytes of a row, the
 * colours of the four places of a row standing one after the other. */
export function gatherTczScanline(
	buffer: Buffer,
	source: number,
	output: Buffer,
	at: number,
	layout: TczLayout,
): void {
	let dst = at;
	for (let row = 0; row < layout.height; row += 1) {
		for (let column = 0; column < GATHER_COLUMNS; column += 1) {
			const from = source + row + MAXIMUM_HEIGHT * column;
			const to = dst + column;
			if (from >= buffer.length || to >= output.length) {
				throw invalidPicture("NMI picture walks beyond its own places");
			}
			output[to] = buffer[from] ?? 0;
		}
		dst += layout.stride;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ponytailTczImageDescriptor: FormatDescriptor = {
	id: "ponytail-tcz-image",
	name: "Ponytail Soft NMI 2.5 image format",
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
			source: "Legacy/Ponytail/ImageTCZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ponytailTczImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ponytailTczImageDescriptor,
	// The reference registers the same word as the first kind of its pictures, which is told apart by the word
	// behind it.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readTczLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readTczLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an NMI 2.5 picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(PALETTE_FIELD),
			size: source.size - BigInt(PALETTE_FIELD),
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
			},
		});
		return { entries: [entry], metadata: { image: "bmp", bitsPerPixel: 4 } };
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readTczLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an NMI 2.5 picture");
		// The rows of the picture are padded to four bytes by the bitmap writer.
		return Readable.from([decodeTcz(stored, layout)]);
	},
});
