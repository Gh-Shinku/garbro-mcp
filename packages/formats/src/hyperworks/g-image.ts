// Format reference: GARbro "Legacy/HyperWorks/ImageG.cs", classes `GFormat` and `GReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { BIT1, BIT2, BIT3, OFF } from "./g-tables.js";

const HEAD_SIZE = 12;
const PALETTE_AT = 0x0c;
const PALETTE_SIZE = 0x30;
const WALK_AT = 0x40;
/** `GFormat.Signature`: the first word of the head, of a picture of the engine. */
const SIGNATURE = 0x7d00;
/** The second word of the head: the mark of the engine itself. */
const TAG = 0x1a47;
const BITS_8 = 8;
/** The places of the file of the table of the colours of a picture of the engine. */
const PALETTE_INDEXES = [
	0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 0x0c, 0x0d, 0x0a, 0x0b, 0x0e, 0x0f,
];
const PALETTE_COLORS = 42;
const COLOR_BASE = 10;
const HALF_BASE = 26;
/** `((v & 0xF00 | (v & 0xF000) >> 12) + 0xA0A)`: the places of the file of a place of the picture. */
const COLOR_BIAS = 0x0a0a;
/** The first places of the file of `OffTable`: the pairs of the walk of the places of a picture. */
const TREE_AT = 54;
const LINE_BUFFER = 0x142;
const BYTE_MASK = 0xff;
const NIBBLE_MASK = 0x0f;
const COLORS_PER_PLACE = 16;

/** The head of a picture of the engine, of the places of the file of the walk of it. */
export interface GImageLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** `(Width + 1) & -2`: the places of the file of a row of the walk of the engine. */
	stride: number;
	/** `(Height + 1) & -2`: the rows of the walk of the engine. */
	rows: number;
	/** `(Width + 7) & -8`: the places of the file of a row of the places of the block of the walk. */
	packed: number;
	/** The 0x30 places of the file of the table of the colours, at 0x0C of the picture. */
	palette: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"A picture of the engine of no places of the file",
		);
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/**
 * `GFormat.ReadMetaData`: the head of a picture of the engine. The reference takes a picture of the
 * first word 0x7D00 of the head alone, of the letters `.G` of the name of the file of a picture of
 * the other walks of it, of the file of the engine of the other places of the file of the head.
 */
export function readGImageLayout(
	data: Buffer,
	sourcePath = "",
): GImageLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.readUInt16LE(2) !== TAG) return undefined;
	if (data.readUInt16LE(0) !== SIGNATURE && !/\.g$/i.test(sourcePath))
		return undefined;
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(10);
	// The reference carries no such guard of the places of the file of a picture of no places of it; it
	// stands of a walk of no places of the file of the picture of the engine itself.
	if (0 === width || 0 === height) return undefined;
	const palette = Buffer.alloc(PALETTE_SIZE, 0);
	if (data.length > PALETTE_AT) {
		data.copy(
			palette,
			0,
			PALETTE_AT,
			Math.min(PALETTE_AT + PALETTE_SIZE, data.length),
		);
	}
	return {
		width,
		height,
		offsetX: data.readInt16LE(4),
		offsetY: data.readInt16LE(6),
		stride: (width + 1) & ~1,
		rows: (height + 1) & ~1,
		packed: (width + 7) & -8,
		palette,
	};
}

/** `GReader`: the walk of the places of the file of a picture of the engine. */
class GWalk {
	private at = WALK_AT;
	private bits = 0;
	private bitCount = 0;
	private readonly places: Uint16Array;
	private readonly line: [number, number, number];
	private readonly colors = new Uint8Array(256);
	private readonly output: Buffer;

	constructor(
		private readonly data: Buffer,
		private readonly layout: GImageLayout,
	) {
		const size = Math.max(LINE_BUFFER, (layout.stride >> 1) + 2);
		this.places = new Uint16Array(size * 3 + 1);
		this.line = [1, 1 + size, 1 + size * 2];
		this.output = Buffer.alloc(layout.stride * layout.rows, 0);
	}

	/** The table of the colours of `GReader.InitColorTable`, of sixteen places of sixteen of them. */
	private initColorTable(): void {
		let at = 0;
		for (let i = 0; i < COLORS_PER_PLACE; i += 1) {
			for (let j = 0; j < COLORS_PER_PLACE; j += 1) {
				this.colors[at] = (j + i + 1) & NIBBLE_MASK;
				at += 1;
			}
		}
	}

	/** `GReader.SetupBitReader`: the two first places of the file of the walk stand of the reservoir. */
	private setupBitReader(): void {
		if (this.data.length < WALK_AT + 2) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the walk of it",
			);
		}
		this.bits = (this.data[WALK_AT] ?? 0) << 8;
		this.bits |= this.data[WALK_AT + 1] ?? 0;
		this.at = WALK_AT + 2;
		this.bitCount = BITS_8;
	}

	/** `GReader`'s `m_input.ReadByte()`, of -1 at the end of the places of the file of the walk. */
	private readByte(): number {
		if (this.at >= this.data.length) return -1;
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	/** `GReader.GetNextBit`. */
	private nextBit(): number {
		this.bits <<= 1;
		this.bitCount -= 1;
		if (0 === this.bitCount) {
			const next = this.readByte();
			if (next >= 0) this.bits |= next;
			this.bitCount = BITS_8;
		}
		return (this.bits >> 16) & 1;
	}

	/** `GReader.ExtractBits`: one of the three tables of the walk of the engine. */
	private extractBits(table: readonly number[]): number {
		const idx = ((this.bits >> 8) & BYTE_MASK) * 2;
		const count = table[idx] ?? 0;
		if (count !== 0) {
			let bits = count;
			if (bits >= this.bitCount) {
				bits -= this.bitCount;
				this.bits <<= this.bitCount;
				const next = this.readByte();
				if (next >= 0) this.bits |= next;
				this.bitCount = BITS_8;
			}
			this.bits <<= bits;
			this.bitCount -= bits;
			return table[idx + 1] ?? 0;
		}
		this.bits <<= this.bitCount;
		const next = this.readByte();
		if (next >= 0) this.bits |= next;
		this.bits <<= BITS_8 - this.bitCount;
		let at = table[idx + 1] ?? 0;
		do {
			const bit = this.nextBit();
			at = OFF[2 * at + TREE_AT + bit] ?? 0;
		} while ((OFF[2 * at + TREE_AT] ?? 0) !== 0);
		return OFF[2 * at + TREE_AT + 1] ?? 0;
	}

	/** `GReader.AdjustColorTable`: a place of the file of the table of the colours of a picture. */
	private adjustColorTable(idx: number): number {
		const shift = this.extractBits(BIT3);
		let at = COLORS_PER_PLACE * idx + shift;
		const value = this.colors[at] ?? 0;
		if (shift !== 0) {
			let left = shift;
			while (left > 0) {
				this.colors[at] = this.colors[at - 1] ?? 0;
				at -= 1;
				left -= 1;
			}
			this.colors[at] = value;
		}
		return value;
	}

	/** `GReader.GetColorFromTable`: the colour of a place of the picture of the places before it. */
	private colorFromTable(x: number): number {
		const line1 = this.line[1];
		const line0 = this.line[0];
		const b0 = this.places[line1 + x] ?? 0;
		const b1 = this.places[line1 + x - 1] ?? 0;
		const b2 = this.places[line0 + x - 1] ?? 0;
		const n0 = b0 & NIBBLE_MASK;
		const n1 = (b0 >> 4) & NIBBLE_MASK;
		const n2 = (b0 >> 8) & NIBBLE_MASK;
		const n3 = (b0 >> 12) & NIBBLE_MASK;
		const m0 = b1 & NIBBLE_MASK;
		const m1 = (b1 >> 4) & NIBBLE_MASK;
		const m2 = (b1 >> 8) & NIBBLE_MASK;
		const m3 = (b1 >> 12) & NIBBLE_MASK;
		const p0 = b2 & NIBBLE_MASK;
		const p1 = (b2 >> 4) & NIBBLE_MASK;
		const p2 = (b2 >> 8) & NIBBLE_MASK;
		const p3 = (b2 >> 12) & NIBBLE_MASK;
		let r1 = n1;
		if (n1 !== n3 && (n1 !== m1 || n1 !== p1)) {
			r1 = p0 === p1 ? p0 : m2;
		}
		if (this.nextBit() !== 0) r1 = this.adjustColorTable(r1);
		let r0 = n0;
		if (n0 !== n2 && (n0 !== m0 || n0 !== p0)) {
			r0 = r1 === p1 ? p1 : n3;
		}
		if (this.nextBit() !== 0) r0 = this.adjustColorTable(r0);
		let r3 = n3;
		if (r1 !== n3 && (n3 !== m3 || n3 !== p3)) {
			r3 = p2 === p3 ? p2 : p0;
		}
		if (this.nextBit() !== 0) r3 = this.adjustColorTable(r3);
		let r2 = n2;
		if (n2 !== r0 && (n2 !== m2 || n2 !== p2)) {
			r2 = p3 === r3 ? p3 : r1;
		}
		if (this.nextBit() !== 0) r2 = this.adjustColorTable(r2);
		return ((r3 << 12) | (r2 << 8) | (r1 << 4) | r0) & 0xffff;
	}

	/** `GReader.UnpackRow`: two rows of the picture of a row of the walk of the engine. */
	private unpackRow(y: number, width: number, from: number): void {
		let row1 = this.layout.stride * y * 2;
		let row2 = row1 + this.layout.stride;
		let at = from;
		for (let i = 0; i < width; i += 1) {
			const value = this.places[at] ?? 0;
			at += 1;
			const down =
				(((value & 0x0f00) | ((value & 0xf000) >> 12)) + COLOR_BIAS) & 0xffff;
			if (row2 + 1 < this.output.length) this.output.writeUInt16LE(down, row2);
			row2 += 2;
			const up =
				(((value & NIBBLE_MASK) << 8) | ((value & 0x00f0) >> 4)) + COLOR_BIAS;
			if (row1 + 1 < this.output.length) {
				this.output.writeUInt16LE(up & 0xffff, row1);
			}
			row1 += 2;
		}
	}

	/** `GReader.Unpack`: the places of the file of the picture of the walk of the engine. */
	unpack(): Buffer {
		this.initColorTable();
		this.setupBitReader();
		const blockWidth = this.layout.packed >> 1;
		const blockHeight = this.layout.rows >> 1;
		for (let y = 0; y < blockHeight; y += 1) {
			const spare = this.line[2];
			this.line[2] = this.line[1];
			this.line[1] = this.line[0];
			this.line[0] = spare;
			let x = 0;
			let dst = spare;
			while (x < blockWidth) {
				if (this.nextBit() !== 0) {
					this.places[dst] = this.colorFromTable(x);
					dst += 1;
					x += 1;
					continue;
				}
				let count = this.extractBits(BIT1);
				if (count >= 0x40) count += this.extractBits(BIT1);
				const idx = this.extractBits(BIT2) * 2;
				const which = OFF[idx + 1] ?? 0;
				const source = (this.line[which] ?? 1) + (OFF[idx] ?? 0) + x;
				if (source < 0) {
					throw invalidPicture(
						"A picture of the engine of a run before the walk of it",
					);
				}
				x += count;
				let from = source;
				let left = count;
				while (left > 0) {
					this.places[dst] = this.places[from] ?? 0;
					dst += 1;
					from += 1;
					left -= 1;
				}
			}
			this.unpackRow(y, blockWidth, spare);
		}
		return this.output;
	}
}

/** `GReader.UnpackPalette`: the table of the colours of a picture of the engine, of 42 of them. */
export function unpackGPalette(data: Buffer): Buffer {
	const palette = Buffer.alloc(PALETTE_COLORS * 4, 0);
	for (let i = 0; i < COLORS_PER_PLACE; i += 1) {
		const at = 3 * (PALETTE_INDEXES[i] ?? 0);
		const red = ((data[at] ?? 0) | ((data[at] ?? 0) << 4)) & BYTE_MASK;
		const green =
			((data[at + 1] ?? 0) | ((data[at + 1] ?? 0) << 4)) & BYTE_MASK;
		const blue = ((data[at + 2] ?? 0) | ((data[at + 2] ?? 0) << 4)) & BYTE_MASK;
		const plain = (COLOR_BASE + i) * 4;
		palette[plain] = blue;
		palette[plain + 1] = green;
		palette[plain + 2] = red;
		const half = (HALF_BASE + i) * 4;
		palette[half] = halfPlace(blue);
		palette[half + 1] = halfPlace(green);
		palette[half + 2] = halfPlace(red);
	}
	return palette;
}

/** `(byte)((sbyte)v >> 1)` of the reference, of the places of a colour of half of them. */
function halfPlace(value: number): number {
	let half = ((value << 24) >> 24) >> 1;
	if (half < 0) half += value & 1;
	return half & BYTE_MASK;
}

/** `GReader`: the picture of the engine, of the places of the file of a BMP of it. */
export function unpackGPicture(data: Buffer, layout: GImageLayout): Buffer {
	const walk = new GWalk(data, layout);
	const places = walk.unpack();
	const palette = unpackGPalette(layout.palette);
	const pixels = Buffer.alloc(layout.width * layout.height, 0);
	for (let y = 0; y < layout.height; y += 1) {
		const from = y * layout.stride;
		places.copy(
			pixels,
			y * layout.width,
			from,
			Math.min(from + layout.width, places.length),
		);
	}
	return writeBmp8Palette(layout.width, layout.height, pixels, palette);
}

export const gImageDescriptor: FormatDescriptor = {
	id: "hyperworks-g-image",
	name: "HyperWorks indexed image",
	extensions: ["g"],
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
			source: "Legacy/HyperWorks/ImageG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gImageDescriptor,
	detection: {
		signatures: [{ bytes: new Uint8Array([0x00, 0x7d, 0x47, 0x1a]) }],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = await readStored(source);
			return data.readUInt16LE(2) === TAG;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readGImageLayout(data, sourcePath);
		if (!layout) throw invalidPicture("Not a picture of the HyperWorks engine");
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
					bitsPerPixel: BITS_8,
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
				bitsPerPixel: BITS_8,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const data = await readStored(source);
		const layout = readGImageLayout(data, sourcePath);
		if (!layout) throw invalidPicture("Not a picture of the HyperWorks engine");
		return Readable.from([unpackGPicture(data, layout)]);
	},
});
