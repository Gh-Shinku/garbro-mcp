// Format reference: GARBro "ArcFormats/Succubus/ImageGH.cs", classes `GhFormat` and `GhpReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The newer of the two versions this format carries is left unimplemented **by the reference itself**
// (`GhpReader.Unpack3` throws), so this port refuses it as well.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two words a picture of this engine opens with, and the head behind them. */
const MARKS = [Buffer.from("GHP3", "latin1"), Buffer.from("GHP2", "latin1")];
const HEADER_SIZE = 0x28;
const VERSION_AT = 3;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x0e;
const COLOURS_AT = 0x10;
/** The places the two versions keep their own fields at. */
const OLD_PALETTE_AT = 0x14;
const OLD_CHUNKS_AT = 0x18;
const OLD_DATA_AT = 0x1c;
const NEW_PALETTE_AT = 0x18;
const NEW_DATA_AT = 0x24;
/** The version whose picture the reference leaves unwritten. */
const UNWRITTEN_VERSION = 3;
/** A picture of this engine is always of one byte a pixel, and its palette three bytes a colour. */
const DEPTH = 8;
const PALETTE_COLOUR_BYTES = 3;
const PALETTE_ENTRIES = 0x100;
/** How deep a picture's own indices are packed, and the most the reference will look. */
const DEEPEST_DEPTH = 24;
/** The table the walk reads its own numbers from: a width and a base, four to a step. */
const BIT_TABLE = [
	0, 0, 2, 0, 4, 4, 6, 0x14, 8, 0x54, 0x0c, 0x154, 0x10, 0x1154, 0x12, 0x11154,
];
/** The bits the walk asks for when it names a chunk, and the longest run of ones it reads. */
const CHUNK_BITS = 2;
const REPEAT_TO_ONE_BIT = 1;
const UP_TO_TWO = 2;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface GhLayout {
	version: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	colours: number;
	paletteOffset: number;
	dataOffset: number;
	depth: number;
	stride: number;
	chunkCount: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GhpReader.GetColorDepth`: how many bits an index of a palette of that many colours takes. */
export function ghColorDepth(colours: number): number {
	let depth = 0;
	for (let bit = 1; bit < colours && depth < DEEPEST_DEPTH; bit <<= 1) {
		depth += 1;
	}
	return depth;
}

/** `GhFormat.ReadMetaData`: the head of the picture, whose fields stand apart in the two versions. */
export function readGhLayout(data: Buffer): GhLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!MARKS.some((mark) => data.subarray(0, 4).equals(mark))) return undefined;
	const version = (data[VERSION_AT] ?? 0) - 0x30;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	const colours = data.readUInt16LE(COLOURS_AT);
	if (0 === width || 0 === height || 0 === colours) return undefined;
	if (width * height > LIMIT) return undefined;
	const stride = (width + 3) & ~3;
	if (stride * height > LIMIT) return undefined;
	const older = UP_TO_TWO === version;
	return {
		version,
		width,
		height,
		bitsPerPixel: DEPTH,
		colours,
		paletteOffset: older
			? data.readUInt32LE(OLD_PALETTE_AT)
			: data.readUInt32LE(NEW_PALETTE_AT),
		dataOffset: older
			? data.readUInt32LE(OLD_DATA_AT)
			: data.readUInt32LE(NEW_DATA_AT),
		depth: ghColorDepth(colours),
		stride,
		chunkCount: older ? data.readInt32LE(OLD_CHUNKS_AT) : 0,
	};
}

/** `ImageFormat.ReadPalette` in the order this format keeps, taken to the four bytes a writer wants. */
export function readGhPalette(
	data: Buffer,
	at: number,
	colours: number,
): Buffer | undefined {
	if (colours < 1 || colours > PALETTE_ENTRIES) return undefined;
	if (at + colours * PALETTE_COLOUR_BYTES > data.length) return undefined;
	const palette = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < colours; index += 1) {
		const from = at + index * PALETTE_COLOUR_BYTES;
		const to = index * 4;
		// The format keeps its colours red first, and the writers of this project blue first.
		palette[to] = data[from + 2] ?? 0;
		palette[to + 1] = data[from + 1] ?? 0;
		palette[to + 2] = data[from] ?? 0;
		palette[to + 3] = 0xff;
	}
	return palette;
}

/**
 * `GhpReader.FillBitsCache` and its two readers: four bytes are gathered into a cache with the **first** of
 * them in its lowest byte, and the bits are then read from the **top** of that cache - so a group of four
 * bytes is consumed from its last byte's highest bit down to its first byte's lowest.
 */
class GhBitReader {
	private cache = 0;
	private cached = 0;

	constructor(
		private readonly data: Uint8Array,
		private readonly from: number,
	) {}

	private fill(): void {
		this.cache = 0;
		for (let shift = 0; shift < 32; shift += 8) {
			const byte = this.data[this.from + this.at] ?? -1;
			if (-1 === byte) break;
			this.at += 1;
			this.cache = (this.cache | (byte << shift)) >>> 0;
		}
		this.cached = 32;
	}

	private at = 0;

	/** `GhpReader.ReadBits`: as many bits as asked for, taken from the top of the cache. */
	readBits(count: number): number {
		let bits = 0;
		let wanted = count;
		if (wanted > this.cached) {
			if (this.cached > 0) {
				wanted -= this.cached;
				bits = ((this.cache >>> (32 - this.cached)) << wanted) >>> 0;
			}
			this.fill();
		}
		bits = (bits | (this.cache >>> (32 - wanted))) >>> 0;
		this.cache = (this.cache << wanted) >>> 0;
		this.cached -= wanted;
		return bits;
	}

	/** `GhpReader.ReadBitCount`: how many ones stand before the next nothing. */
	readBitCount(): number {
		let count = 0;
		for (;;) {
			if (0 === this.cached) this.fill();
			const bit = this.cache >>> 31;
			this.cached -= 1;
			this.cache = (this.cache << 1) >>> 0;
			if (0 === bit) break;
			count += 1;
		}
		return count;
	}

	/** `GhpReader.ReadPos`: where the next pixel stands, of the table's own widths and bases. */
	readPos(): number {
		const pos = this.readBitCount();
		if (pos > 0) {
			return (
				(BIT_TABLE[2 * pos + 3] ?? 0) +
				this.readBits(BIT_TABLE[2 * pos + 2] ?? 0) +
				1
			);
		}
		return this.readBits(2) + 1;
	}

	/** `GhpReader.ReadCount`: how many pixels a chunk stands for. */
	readCount(): number {
		let count = 0;
		const x = this.readBitCount();
		if (x > 0) {
			count =
				(BIT_TABLE[2 * x + 1] ?? 0) + this.readBits(BIT_TABLE[2 * x] ?? 0) + 1;
		}
		return count + 2;
	}
}

/**
 * `GhpReader.Unpack2`: the walk names the place of every pixel it writes on its own, marks it in a table,
 * and then fills every place the table never marked with the value it wrote last - so a row smears its right
 * hand side from the left.
 */
export function unpackGhPicture(
	data: Buffer,
	layout: GhLayout,
): { pixels: Buffer; palette: Buffer } {
	if (UNWRITTEN_VERSION === layout.version) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The picture's newer version is left unwritten by the reference as well",
		);
	}
	if (UP_TO_TWO !== layout.version) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`The picture's version ${layout.version} is not ported`,
		);
	}
	const palette = readGhPalette(data, layout.paletteOffset, layout.colours);
	if (!palette) throw invalid("The picture's palette reaches past the file");
	const { width, height, stride, depth } = layout;
	const pixels = Buffer.alloc(stride * height, 0x00);
	const bits = new GhBitReader(data, layout.dataOffset);
	const repeats = new Uint8Array(Math.ceil((width * height) / 8));
	let count = 0;
	let skip = 5;
	let x = 0;
	let y = 0;
	let nextX = 0;
	let nextY = 0;
	bits.readPos();
	let pixel = bits.readBits(depth);
	for (let placed = 0; placed < layout.chunkCount; ) {
		if (count <= 0) {
			const control = bits.readBits(CHUNK_BITS);
			if (control > UP_TO_TWO) count = bits.readCount() - 1;
			else skip = bits.readBits(REPEAT_TO_ONE_BIT) + 2 * control;
		} else {
			count -= 1;
		}
		if (y >= 0 && y < height && x >= 0 && x < width) {
			pixels[stride * y + x] = pixel & 0xff;
			const place = width * y + x;
			repeats[place >> 3] = (repeats[place >> 3] ?? 0) | (1 << (place & 7));
		}
		if (skip >= 5) {
			const pos = bits.readPos() + nextX;
			const rows = Math.trunc(pos / width);
			nextX = pos - rows * width;
			nextY += rows;
			pixel = bits.readBits(depth);
			y = nextY;
			x = nextX;
			placed += 1;
		} else {
			y += 1;
			x += skip - UP_TO_TWO;
		}
	}
	// `GhpReader.Unpack2`'s own second pass: every place the walk never marked takes the value written last.
	pixel = 0;
	let at = 0;
	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			const marked = ((repeats[at >> 3] ?? 0) >> (at & 7)) & 1;
			if (0 !== marked) pixel = pixels[stride * row + column] ?? 0;
			else pixels[stride * row + column] = pixel & 0xff;
			at += 1;
		}
	}
	return { pixels, palette };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const succubusGhImageDescriptor: FormatDescriptor = {
	id: "succubus-gh-image",
	name: "Succubus image",
	extensions: ["gh"],
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
			source: "ArcFormats/Succubus/ImageGH.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const succubusGhImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: succubusGhImageDescriptor,
	detection: { signatures: MARKS.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readGhLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGhLayout(await readStored(source));
		if (!layout) throw invalid("Not a Succubus picture");
		if (UP_TO_TWO !== layout.version) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"The picture's newer version is left unwritten by the reference as well",
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
				colours: layout.colours,
				pictureVersion: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGhLayout(stored);
		if (!layout) throw invalid("Not a Succubus picture");
		const { pixels, palette } = unpackGhPicture(stored, layout);
		// The walk works in rows of four bytes, and the writers of this project take packed rows.
		const packed = Buffer.alloc(layout.width * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			for (let column = 0; column < layout.width; column += 1) {
				packed[row * layout.width + column] =
					pixels[row * layout.stride + column] ?? 0;
			}
		}
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, packed, palette, false),
		]);
	},
});
