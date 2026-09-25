// Port of GARbro "ArcFormats/ScrPlayer/ImageIMG.cs" (tag "IMG", classes `ImgFormat` / `ImgReader` and the
// walk of the places of `ImgBitStream`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.
//
// The picture is a walk of its own over a **table of codes**: its stream stands of codes whose count of
// places and whose own place stand in a table of `ArcFormats/ScrPlayer/` (two places a byte), and the walk
// reads a code of it at a time - the count of the places of the code first, of thirteen places, and, where
// that code names a long one, eleven places more behind it.
//
// The places of the picture are turned out a row at a time, of three rows of a window that stand one over
// the other: the row of the walk is turned over with the one behind it as every row begins, so a place of a
// code reaches back to the row of it, to the row in front of that one or to the one in front of that. The
// place a code stands of is read of a second table of codes, and the table of the places a code reaches
// back to carries the place it reached back to the last time to the front of it as well, so a place that
// stood behind another is read of a shorter code afterwards.
//
// A code of the places of the picture hands the places of it over as they stand, and a place of a colour of
// a code stands of the place it reaches back to less the places of a table of its own, or of a difference
// read of a walk of its own where the table of the colours of the code names one. The picture of the kind
// of thirty two places a colour stands of an alpha of its own, of a fourth table of the places of a code.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	IMG_BYTE_MAP,
	IMG_COLOR_CODE,
	IMG_DELTA_TABLE_1,
	IMG_DELTA_TABLE_3,
	IMG_MAP_BLUE,
	IMG_MAP_GREEN,
	IMG_MAP_RED,
	IMG_OFFSET_TABLE,
	IMG_POS_TABLE_24,
	IMG_POS_TABLE_32,
	IMG_RESOURCES,
} from "./img-tables.js";

const MARK = Buffer.from("IMG ", "latin1");
const HEAD_SIZE = 0x18;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x0e;
const PLACES_AT = 0x10;
const PLACES_24 = 24;
const PLACES_32 = 32;
const PLACES_WIDE = 4;
const BYTE_PLACES = 8;
const FULL_ALPHA = 0xff;
/** The window of the walk: three rows of 0xC80 places each, of which the walk turns one over. */
const ROW_PLACES = 0xc80;
const WINDOW_SIZE = 0x2580;
/** The codes of the walk. */
const CONTROL_PLACES = 13;
const CONTROL_MORE = 0xef;
const MORE_PLACES = 11;
const POS_PLACES = 5;
const DELTA_PLACES = 8;
const DELTA_MORE = 0x2b;
const DELTA_MORE_PLACES = 13;
/** The code of a row of places of their own, and the place the count of them stands of. */
const RUN_FIRST = 0xd8;
const RUN_BASE = 0xd6;
/** The place of the alpha that stands of a difference of its own. */
const ALPHA_DELTA = -3;
const BYTE_MASK = 0xff;

export interface ImgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `ImgFormat.ReadMetaData`: the mark, the box of the picture and the places of a colour of it. */
export function readImgLayout(data: Buffer): ImgLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(MARK)) return undefined;
	const bitsPerPixel = data.readUInt16LE(PLACES_AT);
	if (PLACES_24 !== bitsPerPixel && PLACES_32 !== bitsPerPixel)
		return undefined;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	if (width * PLACES_WIDE > ROW_PLACES) return undefined;
	return { width, height, bitsPerPixel };
}

/** `ImgBitStream`: the walk of the places of the codes of the stream, of the highest place of a byte down. */
export class ImgBitStream {
	private bits = 0;
	private cached = 0;
	private at = 0;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	/** `ImgBitStream.PeekBits`: the lowest places of the cache, of the places of the byte of a code. */
	peekBits(count: number): number {
		if (this.cached < count) {
			for (let round = 0; round < 2; round += 1) {
				if (this.cached >= count) break;
				const place =
					this.at < this.data.length ? (this.data[this.at++] ?? 0) : 0;
				this.bits |= (IMG_BYTE_MAP[place] ?? 0) << this.cached;
				this.cached += BYTE_PLACES;
			}
		}
		return this.bits & ((1 << count) - 1);
	}

	/** `ImgBitStream.GetBits`: the place a code of a table stands of, of the count of its places. */
	getBits(table: Uint8Array | readonly number[], count: number): number {
		const entry = this.peekBits(count) * 2;
		const places = table[entry] ?? 0;
		this.bits >>= places;
		this.cached -= places;
		return table[entry + 1] ?? 0;
	}
}

/** `ImgReader.GetDelta`: the places of a difference, of a table of codes of its own. */
function getDelta(input: ImgBitStream): number {
	let places = input.getBits(IMG_DELTA_TABLE_1, DELTA_PLACES);
	if (DELTA_MORE === places) {
		places += input.getBits(IMG_RESOURCES.delta2, DELTA_MORE_PLACES);
	}
	return IMG_DELTA_TABLE_3[places] ?? 0;
}

/**
 * `ImgReader.Unpack`: the places of the picture, of four places a place of it (blue, green, red and, for
 * the kind of thirty two places a colour, the alpha of it).
 */
export function unpackImgPicture(data: Buffer, layout: ImgLayout): Buffer {
	const stride = layout.width * PLACES_WIDE;
	const output = Buffer.alloc(stride * (layout.height + 1), 0x00);
	const row = Buffer.alloc(WINDOW_SIZE, 0x00);
	if (PLACES_32 === layout.bitsPerPixel) {
		for (let at = 3; at < row.length; at += PLACES_WIDE) row[at] = FULL_ALPHA;
	}
	const offsetTable = [...IMG_OFFSET_TABLE];
	const rows = [0, ROW_PLACES, ROW_PLACES * 2];
	const input = new ImgBitStream(data, HEAD_SIZE);
	let at = 0;
	for (let line = 0; line < layout.height; line += 1) {
		const target = rows[2] ?? 0;
		rows[2] = rows[1] ?? 0;
		rows[1] = rows[0] ?? 0;
		rows[0] = target;
		let places = target;
		for (let x = 0; x < layout.width; ) {
			let control = input.getBits(IMG_RESOURCES.control1, CONTROL_PLACES);
			if (CONTROL_MORE === control) {
				control += input.getBits(IMG_RESOURCES.control2, MORE_PLACES);
			}
			let alpha = 0;
			let position: number;
			if (PLACES_32 === layout.bitsPerPixel) {
				const code = input.getBits(IMG_RESOURCES.control32, CONTROL_PLACES) * 2;
				position = (IMG_POS_TABLE_32[code] ?? 0) * 2;
				alpha = IMG_POS_TABLE_32[code + 1] ?? 0;
			} else {
				position = input.getBits(IMG_POS_TABLE_24, POS_PLACES) * 2;
			}
			const xOffset = offsetTable[position] ?? 0;
			const yOffset = offsetTable[position + 1] ?? 0;
			if (position > 0) {
				offsetTable[position] = offsetTable[position - 2] ?? 0;
				offsetTable[position + 1] = offsetTable[position - 1] ?? 0;
				offsetTable[position - 2] = xOffset;
				offsetTable[position - 1] = yOffset;
			}
			const source = (rows[yOffset] ?? 0) + (x + xOffset) * PLACES_WIDE;
			if (control >= RUN_FIRST) {
				// The places of the picture stand of the places of the code as they are.
				const count = control - RUN_BASE;
				if (source < 0 || source + count * PLACES_WIDE > WINDOW_SIZE) {
					throw invalidPicture(
						"The places of a code of the picture stand past it",
					);
				}
				copyOverlapped(row, source, places, count * PLACES_WIDE);
				places += count * PLACES_WIDE;
				x += count;
				continue;
			}
			if (source < 0 || source + PLACES_WIDE > WINDOW_SIZE) {
				throw invalidPicture(
					"The places of a code of the picture stand past it",
				);
			}
			// The table of the colours of the code names the places of a colour that stand of a difference
			// of their own, of the red place first, then the green one and then the blue one.
			const colours = IMG_COLOR_CODE[control] ?? 0;
			const red =
				0 !== (colours & 1) ? getDelta(input) : (IMG_MAP_RED[control] ?? 0);
			const green =
				0 !== (colours & 2) ? getDelta(input) : (IMG_MAP_GREEN[control] ?? 0);
			const blue =
				0 !== (colours & 4) ? getDelta(input) : (IMG_MAP_BLUE[control] ?? 0);
			row[places + 2] = ((row[source + 2] ?? 0) - red) & BYTE_MASK;
			row[places + 1] = ((row[source + 1] ?? 0) - green) & BYTE_MASK;
			row[places] = ((row[source] ?? 0) - blue) & BYTE_MASK;
			if (PLACES_32 === layout.bitsPerPixel) {
				if (ALPHA_DELTA === alpha) alpha = getDelta(input);
				row[places + 3] = ((row[source + 3] ?? 0) - alpha) & BYTE_MASK;
			}
			places += PLACES_WIDE;
			x += 1;
		}
		row.copy(output, at, rows[0] ?? 0, (rows[0] ?? 0) + stride);
		at += stride;
	}
	return output;
}

/**
 * The places of the picture of a tight row of the places of its format: the walk of this engine turns the
 * places of a picture out of four places a place of it, of a blue, a green, a red and an alpha place.
 */
export function tightImgPlaces(
	places: Buffer,
	layout: { width: number; height: number; bitsPerPixel: number },
): Buffer {
	const tight = layout.width * (PLACES_32 === layout.bitsPerPixel ? 4 : 3);
	const wide = layout.width * PLACES_WIDE;
	if (tight === wide) return places;
	const out = Buffer.alloc(tight * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		for (let place = 0; place < layout.width; place += 1) {
			const from = row * wide + place * PLACES_WIDE;
			const to = row * tight + place * (tight / layout.width);
			out[to] = places[from] ?? 0;
			out[to + 1] = places[from + 1] ?? 0;
			out[to + 2] = places[from + 2] ?? 0;
			if (4 === tight / layout.width) out[to + 3] = places[from + 3] ?? 0;
		}
	}
	return out;
}

export const scrPlayerImgImageDescriptor: FormatDescriptor = {
	id: "scrplayer-img-image",
	name: "ScrPlayer image",
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
			source: "ArcFormats/ScrPlayer/ImageIMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const scrPlayerImgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: scrPlayerImgImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readImgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readImgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the ScrPlayer engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readImgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the ScrPlayer engine");
		const places = unpackImgPicture(data, layout);
		// The picture of the walk stands of four places a place of it, of the alpha of the code where the
		// kind stands of one and of a full one everywhere else.
		const tight = tightImgPlaces(places, layout);
		return Readable.from([
			PLACES_32 === layout.bitsPerPixel
				? writeBmp32(layout.width, layout.height, tight)
				: writeBmp24(layout.width, layout.height, tight),
		]);
	},
});
