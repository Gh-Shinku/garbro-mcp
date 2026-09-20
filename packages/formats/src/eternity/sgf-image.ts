// Format reference: GARbro ArcFormats/Eternity/ImageSGF.cs (classes `SgfFormat` and `SgfReader`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `SgfFormat.Signature`: the reference declares a word and then matches the two letters `SG`. */
const SIGNATURE = Buffer.from("SG", "latin1");
const HEADER_SIZE = 0x20;
/** The only version the reference reads. */
const VERSION = 100;
const BITS_PER_PIXEL = 24;
const ALPHA_OFFSET_AT = 0x1c;
/** The two words `SgfReader.ReadAlpha` tells apart: `A ` reads a section, everything else none. */
const ALPHA_SECTION = 0x2041;
const BMP_SECTION = 0x4d42;
/** An alpha section holds its block size at 8 and its first block offset at 0x10. */
const ALPHA_BLOCK_SIZE_AT = 8;
const ALPHA_BLOCK_OFFSET_AT = 0x10;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function rotateLeft32(value: number, count: number): number {
	return ((value << count) | (value >>> (32 - count))) >>> 0;
}

export interface SgfLayout {
	readonly width: number;
	readonly height: number;
	readonly hasAlpha: boolean;
	/** The block size in rows, which is zero for no file the reference reads. */
	readonly blockSize: number;
	readonly dataOffset: number;
	readonly alphaOffset: number;
}

/** `SgfFormat.ReadMetaData`. */
export function readSgfLayout(data: Buffer): SgfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, 2) !== SIGNATURE.toString("latin1"))
		return undefined;
	if (VERSION !== data.readUInt16LE(2)) return undefined;
	return {
		width: data.readUInt16LE(4),
		height: data.readUInt16LE(6),
		hasAlpha: 0 !== data.readInt32LE(8),
		blockSize: data.readUInt16LE(0x0c),
		dataOffset: data.readUInt32LE(0x14),
		alphaOffset: data.readUInt32LE(ALPHA_OFFSET_AT),
	};
}

/**
 * The byte walk of `SgfReader.GetNextByte`: one 32 bit word supplies up to 32 answers from its lowest bit
 * up, a second decides between a difference and a literal, a third gives a difference its direction, a
 * fourth holds the differences themselves as nibbles, and a fifth holds the literal bytes. The masks are
 * shared by the three colour channels and start over at every block.
 */
class SgfByteReader {
	readonly #data: Buffer;
	#at: number;
	#masks = [1, 1, 1, 1, 1];
	#words = [0, 0, 0, 0, 0];

	constructor(data: Buffer, at: number) {
		this.#data = data;
		this.#at = at;
	}

	skipTo(at: number): void {
		this.#at = at;
	}

	restartMasks(): void {
		this.#masks = [1, 1, 1, 1, 1];
	}

	u8(): number {
		this.#need(1);
		const value = this.#data.readUInt8(this.#at);
		this.#at += 1;
		return value;
	}

	u16(): number {
		this.#need(2);
		const value = this.#data.readUInt16LE(this.#at);
		this.#at += 2;
		return value;
	}

	u32(): number {
		this.#need(4);
		const value = this.#data.readUInt32LE(this.#at);
		this.#at += 4;
		return value;
	}

	#need(count: number): void {
		if (this.#at + count > this.#data.length)
			throw invalidPicture("Eternity picture ends inside its own stream");
	}

	/** `GetNextByte`: one channel byte, given the channel's previous one. */
	next(previous: number): number {
		const mask1 = this.#masks[0] ?? 1;
		if (1 === mask1) this.#words[0] = this.u32();
		if (0 === (mask1 & (this.#words[0] ?? 0))) {
			const mask2 = this.#masks[1] ?? 1;
			if (1 === mask2) this.#words[1] = this.u32();
			if (0 !== (mask2 & (this.#words[1] ?? 0))) {
				const mask3 = this.#masks[2] ?? 1;
				if (1 === mask3) this.#words[2] = this.u32();
				const mask4 = this.#masks[3] ?? 1;
				if (1 === mask4) this.#words[3] = this.u32();
				const diff = ((this.#words[3] ?? 0) & 0x0f) + 1;
				previous =
					0 !== (mask3 & (this.#words[2] ?? 0))
						? (previous - diff) & 0xff
						: (previous + diff) & 0xff;
				this.#words[3] = (this.#words[3] ?? 0) >>> 4;
				this.#masks[2] = rotateLeft32(mask3, 1);
				this.#masks[3] = rotateLeft32(mask4, 4);
			} else {
				const mask5 = this.#masks[4] ?? 1;
				if (1 === mask5) this.#words[4] = this.u32();
				previous = (this.#words[4] ?? 0) & 0xff;
				this.#words[4] = (this.#words[4] ?? 0) >>> 8;
				this.#masks[4] = rotateLeft32(mask5, 8);
			}
			this.#masks[1] = rotateLeft32(mask2, 1);
		}
		this.#masks[0] = rotateLeft32(mask1, 1);
		return previous;
	}
}

function checkBlocks(layout: SgfLayout): void {
	if (0 === layout.blockSize)
		throw invalidPicture("Eternity picture declares no block size");
}

/** `SgfReader.Unpack`: the colour channels, block by block, over a stream of differences. */
export function decodeSgfColours(data: Buffer, layout: SgfLayout): Buffer {
	checkBlocks(layout);
	const colours = Buffer.alloc(layout.width * layout.height * 3);
	const reader = new SgfByteReader(data, layout.dataOffset);
	let next = layout.dataOffset;
	let at = 0;
	let blue = 0;
	let green = 0;
	let red = 0;
	for (let y = 0; y < layout.height; y += 1) {
		const start = at;
		if (0 === y % layout.blockSize) {
			reader.skipTo(next);
			next += reader.u32();
			blue = reader.u8();
			green = reader.u8();
			red = reader.u8();
			reader.u8();
			reader.restartMasks();
		}
		for (let x = 0; x < layout.width; x += 1) {
			blue = reader.next(blue);
			green = reader.next(green);
			red = reader.next(red);
			colours[at] = blue;
			colours[at + 1] = green;
			colours[at + 2] = red;
			at += 3;
		}
		// Every row starts again from the first pixel of the row it just wrote.
		blue = colours[start] ?? 0;
		green = colours[start + 1] ?? 0;
		red = colours[start + 2] ?? 0;
	}
	return colours;
}

/** `SgfReader.ReadASection`: the same walk, one channel, and filled from the bottom row up. */
function decodeSgfAlpha(data: Buffer, layout: SgfLayout): Buffer {
	const alpha = Buffer.alloc(layout.width * layout.height);
	const reader = new SgfByteReader(
		data,
		layout.alphaOffset + ALPHA_BLOCK_SIZE_AT,
	);
	const blockSize = reader.u16();
	if (0 === blockSize)
		throw invalidPicture("Eternity picture declares no alpha block size");
	reader.skipTo(layout.alphaOffset + ALPHA_BLOCK_OFFSET_AT);
	let next = layout.alphaOffset + reader.u32();
	let at = alpha.length - layout.width;
	let value = 0;
	for (let y = 0; y < layout.height; y += 1) {
		const start = at;
		if (0 === y % blockSize) {
			reader.skipTo(next);
			next += reader.u32();
			value = reader.u32() & 0xff;
			reader.restartMasks();
		}
		for (let x = 0; x < layout.width; x += 1) {
			value = reader.next(value);
			alpha[at] = value;
			at += 1;
		}
		value = alpha[start] ?? 0;
		at = start - layout.width;
	}
	return alpha;
}

/**
 * `SgfReader.ReadAlpha`. Only the `A ` section is read: for a `BM` section the reference calls a method
 * whose body is commented out and which returns nothing, so such a picture is left without alpha.
 */
export function readSgfAlpha(
	data: Buffer,
	layout: SgfLayout,
): Buffer | undefined {
	if (layout.alphaOffset + 2 > data.length) return undefined;
	const word = data.readUInt16LE(layout.alphaOffset);
	if (ALPHA_SECTION === word) return decodeSgfAlpha(data, layout);
	if (BMP_SECTION === word) return undefined;
	return undefined;
}

/** `SgfFormat.Read`: the colour channels, with the alpha channel woven in when the picture has one. */
export function unpackSgfPicture(data: Buffer, layout: SgfLayout): Buffer {
	const colours = decodeSgfColours(data, layout);
	const alpha = layout.hasAlpha ? readSgfAlpha(data, layout) : undefined;
	if (!alpha) return writeBmp24(layout.width, layout.height, colours);
	const pixels = Buffer.alloc(layout.width * layout.height * 4);
	let source = 0;
	let target = 0;
	let alphaAt = 0;
	while (target < pixels.length) {
		pixels[target] = colours[source] ?? 0;
		pixels[target + 1] = colours[source + 1] ?? 0;
		pixels[target + 2] = colours[source + 2] ?? 0;
		pixels[target + 3] = alpha[alphaAt] ?? 0;
		source += 3;
		target += 4;
		alphaAt += 1;
	}
	return writeBmp32(layout.width, layout.height, pixels);
}

export const eternitySgfImageDescriptor: FormatDescriptor = {
	id: "eternity-sgf-image",
	name: "Eternity engine image",
	extensions: ["sgf"],
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
			source: "ArcFormats/Eternity/ImageSGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eternitySgfImageFormat = defineFixedArchive({
	descriptor: eternitySgfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const head = await source.readAt(0n, HEADER_SIZE);
		return readSgfLayout(head) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readSgfLayout(data);
		if (!layout) throw invalidPicture("Not an Eternity picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: 0n,
			size: source.size,
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
				hasAlpha: layout.hasAlpha,
			},
		});
		return {
			entries: [entry],
			metadata: {
				width: layout.width,
				height: layout.height,
				hasAlpha: layout.hasAlpha,
				blockSize: layout.blockSize,
			},
		};
	},
	async openEntry(source) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readSgfLayout(data);
		if (!layout) throw invalidPicture("Not an Eternity picture");
		return Readable.from([unpackSgfPicture(data, layout)]);
	},
});
