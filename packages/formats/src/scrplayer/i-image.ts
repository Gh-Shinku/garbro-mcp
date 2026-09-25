// Port of GARbro "ArcFormats/ScrPlayer/ImageI.cs" (tag "IMG2", classes `Img2Format` / `Img2Reader` and the
// walk of the places of `Img2BitStream`), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.
//
// The picture is the second one of the ScrPlayer engine, and its walk is the one of the first
// (`img-image.ts`): its stream stands of codes whose count of places and whose own place stand in a table of
// `ArcFormats/ScrPlayer/`, the walk peeks the window of a table and stands of the entry the window names, of
// the count of the places of the entry alone, and the places of the picture reach back to the row of the
// walk, to the row in front of it or to the one in front of that.
//
// It stands apart from the first of its engine in four places: its stream stands of the places of a byte
// from the lowest of them up (the first reads them from the highest down, of a table of the places of a
// byte of its own), its places of a code within a row stand of six places rather than five, the table of
// the colours of a code names the places that stand of a difference of their own rather than the places
// that stand as they are, and the picture of thirty two places a colour carries the places of the alpha of
// a code in a table of the places of a code of its own.

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
import { IMG_OFFSET_TABLE } from "./img-tables.js";
import { tightImgPlaces } from "./img-image.js";
import {
	IMG2_ALPHA_TABLE,
	IMG2_DELTA_TABLE,
	IMG2_POS_TABLE_24,
	IMG2_POS_TABLE_32,
	IMG2_RESOURCES,
	IMG2_RGB_BITS_BLUE,
	IMG2_RGB_BITS_GREEN,
	IMG2_RGB_BITS_RED,
} from "./i-tables.js";

const MARK = Buffer.from("IMG2", "latin1");
const HEAD_SIZE = 0x20;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x0e;
const PLACES_AT = 0x10;
const PLACES_24 = 24;
const PLACES_32 = 32;
const PLACES_WIDE = 4;
const BYTE_PLACES = 8;
const FULL_ALPHA = 0xff;
/** The codes of the walk: the places of the picture, of a place within a row and of a difference. */
const CONTROL_PLACES = 13;
const CONTROL_MORE = 0xb8;
const POS_PLACES = 6;
const DELTA_PLACES = 10;
const DELTA_MORE = 0x41;
/** The code of a row of places of their own, and the place the count of them stands of. */
const RUN_FIRST = 0xd8;
const RUN_BASE = 0xd6;
/** The place of a colour that stands of a difference of its own. */
const DELTA_PLACE = 0xfd;
/** The places of a colour of a code, of the red one first and then of the green one and the blue one. */
const COLOUR_TABLES = [
	IMG2_RGB_BITS_BLUE,
	IMG2_RGB_BITS_GREEN,
	IMG2_RGB_BITS_RED,
];
const BYTE_MASK = 0xff;

export interface Img2Layout {
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

/** `Img2Format.ReadMetaData`: the mark, the box of the picture and the places of a colour of it. */
export function readImg2Layout(data: Buffer): Img2Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(MARK)) return undefined;
	const bitsPerPixel = data.readUInt16LE(PLACES_AT);
	if (PLACES_24 !== bitsPerPixel && PLACES_32 !== bitsPerPixel)
		return undefined;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	return { width, height, bitsPerPixel };
}

/** `Img2BitStream`: the walk of the places of the codes of the stream, of the lowest place of a byte up. */
export class Img2BitStream {
	private bits = 0;
	private cached = 0;
	private at = 0;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	/** `Img2BitStream.PeekBits`: the lowest places of the cache, of the places of the byte of a code. */
	peekBits(count: number): number {
		while (this.cached < count) {
			if (this.at >= this.data.length) {
				throw invalidPicture("The walk of the picture stands past it");
			}
			this.bits |= (this.data[this.at++] ?? 0) << this.cached;
			this.cached += BYTE_PLACES;
		}
		return this.bits & ((1 << count) - 1);
	}

	/** `Img2BitStream.GetBits`: the place a code of a table stands of, of the count of its places. */
	getBits(table: Uint8Array | readonly number[], count: number): number {
		const entry = this.peekBits(count) * 2;
		const places = table[entry] ?? 0;
		this.bits >>= places;
		this.cached -= places;
		return table[entry + 1] ?? 0;
	}
}

/** `Img2Reader.GetDelta`: the places of a difference, of a table of codes of its own. */
function getDelta(input: Img2BitStream, table: readonly number[]): number {
	let places = input.getBits(IMG2_RESOURCES.colorBits1, DELTA_PLACES);
	if (DELTA_MORE === places) {
		places += input.getBits(IMG2_RESOURCES.colorBits2, DELTA_PLACES);
	}
	return table[places] ?? 0;
}

/**
 * `Img2Reader.Unpack`: the places of the picture, of four places a place of it (blue, green, red and, for
 * the kind of thirty two places a colour, the alpha of it).
 */
export function unpackImg2Picture(data: Buffer, layout: Img2Layout): Buffer {
	const stride = layout.width * PLACES_WIDE;
	const output = Buffer.alloc(stride * (layout.height + 1), 0x00);
	const extraRow = output.length - stride;
	if (PLACES_32 === layout.bitsPerPixel) {
		// The rows of the window stand of a full alpha of their own, of the row of the walk and of the one
		// behind the places of the picture.
		for (let at = 3; at < stride; at += PLACES_WIDE) {
			output[at] = FULL_ALPHA;
			output[extraRow + at] = FULL_ALPHA;
		}
	}
	const offsetTable = [...IMG_OFFSET_TABLE];
	const rows = [0, extraRow, extraRow];
	const input = new Img2BitStream(data, HEAD_SIZE);
	for (let line = 0; line < layout.height; line += 1) {
		let places = rows[0] ?? 0;
		for (let x = 0; x < layout.width; ) {
			let control = input.getBits(IMG2_RESOURCES.control1, CONTROL_PLACES);
			if (CONTROL_MORE === control) {
				control += input.getBits(IMG2_RESOURCES.control2, CONTROL_PLACES);
			}
			let position: number;
			let alpha = 0;
			let hasAlpha = false;
			if (PLACES_32 === layout.bitsPerPixel) {
				const code = input.getBits(IMG2_RESOURCES.control32, 9) * 2;
				position = (IMG2_POS_TABLE_32[code] ?? 0) * 2;
				hasAlpha = 0 !== (IMG2_POS_TABLE_32[code + 1] ?? 0);
			} else {
				position = input.getBits(IMG2_POS_TABLE_24, POS_PLACES) * 2;
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
				if (source < 0 || source + count * PLACES_WIDE > output.length) {
					throw invalidPicture(
						"The places of a code of the picture stand past it",
					);
				}
				copyOverlapped(output, source, places, count * PLACES_WIDE);
				places += count * PLACES_WIDE;
				x += count;
				continue;
			}
			if (source < 0 || source + PLACES_WIDE > output.length) {
				throw invalidPicture(
					"The places of a code of the picture stand past it",
				);
			}
			// The table of the colours of the code names the places of a colour that stand of a difference
			// of their own, of the red place first, then the green one and then the blue one.
			for (let place = 2; place >= 0; place -= 1) {
				const colours = COLOUR_TABLES[place] ?? COLOUR_TABLES[2] ?? [];
				let change = colours[control] ?? 0;
				if (DELTA_PLACE === change) {
					change = getDelta(input, IMG2_DELTA_TABLE);
				}
				output[places + place] =
					((output[source + place] ?? 0) - change) & BYTE_MASK;
			}
			if (PLACES_32 === layout.bitsPerPixel) {
				if (hasAlpha) alpha = getDelta(input, IMG2_ALPHA_TABLE);
				output[places + 3] = ((output[source + 3] ?? 0) - alpha) & BYTE_MASK;
			}
			places += PLACES_WIDE;
			x += 1;
		}
		rows[2] = rows[1] ?? 0;
		rows[1] = rows[0] ?? 0;
		rows[0] = (rows[0] ?? 0) + stride;
	}
	return output;
}

export const scrPlayerImg2ImageDescriptor: FormatDescriptor = {
	id: "scrplayer-img2-image",
	name: "ScrPlayer image",
	extensions: ["i"],
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
			source: "ArcFormats/ScrPlayer/ImageI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const scrPlayerImg2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: scrPlayerImg2ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readImg2Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readImg2Layout(data);
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
		const layout = readImg2Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the ScrPlayer engine");
		const places = unpackImg2Picture(data, layout);
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
