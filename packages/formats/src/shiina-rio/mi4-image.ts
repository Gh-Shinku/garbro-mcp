// Format reference: GARBro "ArcFormats/ShiinaRio/ImageMI4.cs", class `Mi4Format` with the `Reader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("MAI4", "latin1");
const HEAD_SIZE = 0x10;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0x0c;
const PIXEL_SIZE = 3;
const BITS_PER_PIXEL = 24;
/** The picture is written four bytes at a time, of which the walk of the first places stands short. */
const BIT_WORD_SIZE = 4;
/** The picture holds no more places than this project is willing to draw. */
const LIMIT = 256 * 1024 * 1024;
export type Mi4Version = "first" | "second";

export interface Mi4Layout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Mi4Format.ReadMetaData`: the picture opens with its own word, then the places of its width and height. */
export function readMi4Layout(data: Buffer): Mi4Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT || width * PIXEL_SIZE > LIMIT) return undefined;
	return { width, height };
}

/**
 * `Reader.LoadBits` and the two walks of the picture read their bits out of words of four bytes, taken from
 * the **last** byte of the word down - the reader lays the bytes of a word one behind the other from its lowest
 * one up and then takes its highest bit first, which is the same as reading a word the other way round with
 * its highest bit in front. A word the file does not hold in full stands as it does, the rest of it nothing.
 */
class Mi4Reader {
	private readonly data: Buffer;
	private position = HEAD_SIZE;
	private bits = 0;
	private left = 0;

	constructor(data: Buffer) {
		this.data = data;
	}

	/**
	 * `Reader.LoadBits`: a word of the picture stands four bytes of the file long, of which the walk of the
	 * first places stands short - a word the file does not hold in full stands as it does, the rest of it
	 * nothing.
	 */
	private load(): void {
		const count = Math.min(BIT_WORD_SIZE, this.data.length - this.position);
		for (let at = 0; at < count; at += 1) {
			const byte = this.data[this.position + at] ?? 0;
			this.bits = ((this.bits >>> 8) | (byte << 24)) >>> 0;
			this.left += 8;
		}
		this.position += count;
	}

	private nextBit(): number {
		if (0 === this.left) this.load();
		const bit = (this.bits >>> 31) & 1;
		this.bits = (this.bits << 1) >>> 0;
		if (this.left > 0) this.left -= 1;
		return bit;
	}

	bit(): number {
		return this.nextBit();
	}

	/** `Reader.GetBits`: the bits behind the walk, read one behind the other, which is the same walk. */
	bitsOf(count: number): number {
		let value = 0;
		for (let at = 0; at < count; at += 1) {
			value = ((value << 1) | this.nextBit()) >>> 0;
		}
		return value;
	}

	/** `IBinaryStream.PeekByte`: whether any of the file stands behind the walk of the bits. */
	get ended(): boolean {
		return this.position >= this.data.length;
	}

	/** The bytes of a place of the picture, read out of the file itself while the walk has them. */
	byte(): number {
		if (this.ended) {
			throw invalidPicture("The picture ends inside a place of its own");
		}
		const value = this.data[this.position] ?? 0;
		this.position += 1;
		return value;
	}

	place(): [number, number, number] {
		return [this.byte(), this.byte(), this.byte()];
	}
}

/** A place copied out of the picture itself: one of the places the walk has already drawn. */
function copyPlace(output: Buffer, source: number): [number, number, number] {
	if (source < 0 || source + PIXEL_SIZE > output.length) {
		throw invalidPicture("A place of the picture stands outside it");
	}
	return [
		output[source] ?? 0,
		output[source + 1] ?? 0,
		output[source + 2] ?? 0,
	];
}

/**
 * `Reader.UnpackV1` and `Reader.UnpackV2`: the picture is drawn a place at a time, every place either a byte
 * of its own in each of the three of them or a run of the places around the one before it. The second walk
 * reaches further in two of its ways - one of them copying a place from one of the two places above the one
 * before, the other naming a place of its own and then the run behind it - and stands short in one of them,
 * where the first walk copies the place above and to the left of the one the walk stands at.
 */
export function unpackMi4Picture(
	data: Buffer,
	layout: Mi4Layout,
	version: Mi4Version,
): Buffer {
	const stride = layout.width * PIXEL_SIZE;
	const output = Buffer.alloc(stride * layout.height, 0x00);
	const reader = new Mi4Reader(data);
	let dst = 0;
	let b = 0;
	let g = 0;
	let r = 0;
	const second = "second" === version;
	while (dst < output.length) {
		if (0 === reader.bit()) {
			// The bits in front of a way name it: a byte of its own, or a run of two, three, four or five bits.
			let zeros = 1;
			while (zeros < 5 && 0 === reader.bit()) zeros += 1;
			if (1 === zeros) {
				// A place of its own, read out of the file - the second walk of the picture standing over a
				// file that ends where it does rather than reading past it.
				if (!second || !reader.ended) [b, g, r] = reader.place();
			} else if (2 === zeros) {
				const way = reader.bitsOf(2);
				if (3 === way) {
					[b, g, r] = copyPlace(output, dst - stride);
				} else if (!second) {
					b = (b + way - 1) & 0xff;
					g = (g + reader.bitsOf(2) - 1) & 0xff;
					r = (r + reader.bitsOf(2) - 1) & 0xff;
				} else {
					b = (b + way - 1) & 0xff;
					const more = reader.bitsOf(2);
					if (3 === more) {
						const back = 0 !== reader.bit();
						[b, g, r] = copyPlace(
							output,
							back ? dst - stride - PIXEL_SIZE : dst - stride + PIXEL_SIZE,
						);
					} else {
						g = (g + more - 1) & 0xff;
						r = (r + reader.bitsOf(2) - 1) & 0xff;
					}
				}
			} else if (3 === zeros) {
				const way = reader.bitsOf(3);
				if (7 === way) {
					// The second walk copies the place above and then adds a run of its own to it; the first
					// walk copies it and stands there.
					[b, g, r] = copyPlace(output, dst - stride);
					if (second) {
						b = (b + reader.bitsOf(3) - 3) & 0xff;
						g = (g + reader.bitsOf(3) - 3) & 0xff;
						r = (r + reader.bitsOf(3) - 3) & 0xff;
					}
				} else {
					b = (b + way - 3) & 0xff;
					g = (g + reader.bitsOf(3) - 3) & 0xff;
					r = (r + reader.bitsOf(3) - 3) & 0xff;
				}
			} else if (4 === zeros) {
				const way = reader.bitsOf(4);
				if (!second && 0xf === way) {
					[b, g, r] = copyPlace(output, dst - stride - PIXEL_SIZE);
				} else {
					b = (b + way - 7) & 0xff;
					g = (g + reader.bitsOf(4) - 7) & 0xff;
					r = (r + reader.bitsOf(4) - 7) & 0xff;
				}
			} else {
				b = (b + reader.bitsOf(5) - 15) & 0xff;
				g = (g + reader.bitsOf(5) - 15) & 0xff;
				r = (r + reader.bitsOf(5) - 15) & 0xff;
			}
		}
		output[dst] = b;
		output[dst + 1] = g;
		output[dst + 2] = r;
		dst += PIXEL_SIZE;
	}
	return output;
}

/**
 * `Mi4Format.Read`: the reference draws a picture of this engine with the **second** walk of its own and, if
 * that walk stands short of what the file holds, draws it again with the first.
 */
export function readMi4Picture(data: Buffer, layout: Mi4Layout): Buffer {
	try {
		return unpackMi4Picture(data, layout, "second");
	} catch {
		return unpackMi4Picture(data, layout, "first");
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mi4ImageDescriptor: FormatDescriptor = {
	id: "shiina-rio-mi4-image",
	name: "ShiinaRio image",
	extensions: ["mi4"],
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
			source: "ArcFormats/ShiinaRio/ImageMI4.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mi4ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mi4ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		const head = await source.readAt(0n, HEAD_SIZE);
		return head.subarray(0, MARK.length).equals(MARK);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMi4Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the ShiinaRio engine");
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
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMi4Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the ShiinaRio engine");
		return Readable.from([
			writeBmp24(layout.width, layout.height, readMi4Picture(data, layout)),
		]);
	},
});
