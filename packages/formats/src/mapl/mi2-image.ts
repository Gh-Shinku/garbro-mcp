// Port of GARbro "Legacy/Mapl/ImageMI2.cs" (tag "MI2", class Mi2Format), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the engine of Mapl of the walks of
// the places of the file of the picture in blocks of the eight places of the file of the block of them, of
// the places of the file of the block behind them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp8Palette } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x28;
/** The count of the places of the file of a block of the picture of the engine. */
const BLOCK_SIZE = 0x40;
/** The count of the places of the file of a row of a block of it and of a place of a colour of a picture. */
const BLOCK_EDGE = 8;
const COLOR_PLACES = 3;
const MAX_COLORS = 0x100;
/** The count of the places of the file of the counts of the walk of three places of the file. */
const COUNTS_24 = 24;
const MAX_DIMENSION = 0x10000;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface Mi2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	colors: number;
}

/** `Mi2Format.ReadMetaData`. */
export function readMi2Layout(data: Buffer): Mi2Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.readUInt32LE(0) !== HEAD_SIZE) return undefined;
	const bitsPerPixel = data.readUInt16LE(0x0e);
	if (8 !== bitsPerPixel && 24 !== bitsPerPixel) return undefined;
	const width = data.readUInt32LE(4);
	const height = data.readUInt32LE(8);
	if (0 === width || width > MAX_DIMENSION) return undefined;
	if (0 === height || height > MAX_DIMENSION) return undefined;
	let colors = data.readInt32LE(0x20);
	if (8 === bitsPerPixel) {
		if (colors < 0 || colors > MAX_COLORS) return undefined;
		if (0 === colors) colors = MAX_COLORS;
	}
	return { width, height, bitsPerPixel, colors };
}

/** `Mi2Format.Reader`: the walks of the places of the file of a channel of a picture of the engine. */
class Mi2Reader {
	private at = HEAD_SIZE;
	private readonly block = Buffer.alloc(BLOCK_SIZE, 0x00);
	private readonly buffer = Buffer.alloc(0x20, 0x00);
	private readonly palette = Buffer.alloc(0x100, 0x00);
	private readonly indices = Buffer.alloc(BLOCK_SIZE, 0x00);

	constructor(private readonly data: Buffer) {}

	/** One place of the file of a walk, of the places of the file of it. */
	private byte(what: string): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				`The places of the file of ${what} stand short of the file`,
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private take(target: Buffer, count: number, what: string): void {
		if (this.at + count > this.data.length) {
			throw invalidPicture(
				`The places of the file of ${what} stand short of the file`,
			);
		}
		this.data.copy(target, 0, this.at, this.at + count);
		this.at += count;
	}

	/** `Binary.RotByteR` of the places of the file of a walk. */
	private static rotateByteRight(value: number, count: number): number {
		const places = count & 7;
		return ((value >>> places) | (value << (8 - places))) & 0xff;
	}

	/** `ImageFormat.ReadPalette` of the picture, of the count of the words of the colour map of it. */
	readPalette(colors: number): Buffer {
		const palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
		this.take(palette, Math.min(colors, MAX_COLORS) * 4, "the colour map");
		return palette;
	}

	/** `Mi2Format.Reader.UnpackChannel`: the places of a channel of the picture. */
	unpackChannel(
		output: Buffer,
		stride: number,
		blocksW: number,
		blocksH: number,
	): void {
		let destinationRow = output.length - stride;
		for (let blockY = 0; blockY < blocksH; blockY += 1) {
			let destinationPlace = destinationRow;
			for (let blockX = 0; blockX < blocksW; blockX += 1) {
				this.walkBlock();
				let source = 0;
				let destination = destinationPlace;
				while (source < BLOCK_SIZE && destination >= 0) {
					this.block.copy(output, destination, source, source + BLOCK_EDGE);
					source += BLOCK_EDGE;
					destination -= stride;
				}
				destinationPlace += BLOCK_EDGE;
			}
			destinationRow -= stride * BLOCK_EDGE;
		}
	}

	/** `Mi2Format.Reader.UnpackChannel` of the places of the block of the walk of the count of it. */
	private walkBlock(): void {
		const control = this.byte("the walks of the places of the picture");
		switch (control) {
			case 0:
				this.take(this.block, BLOCK_SIZE, "the places of the file of the walk");
				return;
			case 1: {
				const value = this.byte("the places of the file of the walk");
				this.block.fill(value, 0, BLOCK_SIZE);
				return;
			}
			case 2:
				this.op2();
				return;
			case 3:
				this.op3();
				return;
			case 4:
				this.op4();
				return;
			case 5:
				this.op5();
				return;
			case 6:
				this.op6();
				return;
			case 7:
				this.op7();
				return;
			case 8:
				this.op2();
				break;
			case 9:
				this.op3();
				break;
			case 10:
				this.op4();
				break;
			case 11:
				this.op5();
				break;
			case 12:
				this.op6();
				break;
			case 13:
				this.op7();
				break;
			default:
				throw invalidPicture(
					`The walk of the places of the file of the picture of the count of ${control} places of the file stands of no walk of the engine`,
				);
		}
		this.adjustBlock();
	}

	/** `Mi2Format.Reader.Op2`: one place of the file and the places of the file behind the mask of them. */
	private op2(): void {
		const value = this.byte("the places of the file of the walk");
		this.take(this.buffer, BLOCK_EDGE, "the masks of the walk");
		let at = 0;
		for (let row = 0; row < BLOCK_EDGE; row += 1) {
			let mask = 0x80;
			for (let place = 0; place < BLOCK_EDGE; place += 1) {
				this.block[at] =
					0 !== ((this.buffer[row] ?? 0) & mask)
						? value
						: this.byte("the places of the file of the walk");
				at += 1;
				mask >>= 1;
			}
		}
	}

	/** `Mi2Format.Reader.Op3`: the two places of the file of the mask of the walk of them. */
	private op3(): void {
		const first = this.byte("the places of the file of the walk");
		const second = this.byte("the places of the file of the walk");
		let at = 0;
		for (let row = 0; row < BLOCK_EDGE; row += 1) {
			let mask = 0x80;
			const marks = this.byte("the masks of the walk");
			for (let place = 0; place < BLOCK_EDGE; place += 1) {
				this.block[at] = 0 !== (marks & mask) ? second : first;
				at += 1;
				mask >>= 1;
			}
		}
	}

	/** `Mi2Format.Reader.Op4`: the three places of the file of the counts of two places of the file. */
	private op4(): void {
		const values = [
			this.byte("the places of the file of the walk"),
			this.byte("the places of the file of the walk"),
			this.byte("the places of the file of the walk"),
		];
		this.take(this.buffer, BLOCK_SIZE / 4, "the counts of the walk");
		let at = 0;
		for (let place = 0; place < BLOCK_SIZE / 4; place += 1) {
			let bits = this.buffer[place] ?? 0;
			for (let count = 0; count < 4; count += 1) {
				const kind = bits >> 6;
				this.block[at] =
					0 === kind
						? this.byte("the places of the file of the walk")
						: (values[kind - 1] ?? 0);
				at += 1;
				bits = (bits << 2) & 0xff;
			}
		}
	}

	/** `Mi2Format.Reader.Op5`: the four places of the file of the counts of two places of the file. */
	private op5(): void {
		const values = [
			this.byte("the places of the file of the walk"),
			this.byte("the places of the file of the walk"),
			this.byte("the places of the file of the walk"),
			this.byte("the places of the file of the walk"),
		];
		this.take(this.buffer, BLOCK_SIZE / 4, "the counts of the walk");
		let at = 0;
		for (let place = 0; place < BLOCK_SIZE / 4; place += 1) {
			let bits = this.buffer[place] ?? 0;
			for (let count = 0; count < 4; count += 1) {
				this.block[at] = values[bits >> 6] ?? 0;
				at += 1;
				bits = (bits << 2) & 0xff;
			}
		}
	}

	/** `Mi2Format.Reader.Op6`: the colour map of the walk and the counts of three places of the file. */
	private op6(): void {
		const count = this.byte("the counts of the walk");
		this.take(this.palette, count, "the colour map of the walk");
		this.take(this.buffer, COUNTS_24, "the counts of the walk");
		this.indices.fill(0x00, 0, BLOCK_SIZE);
		let at = 0;
		let bits = 0;
		let left = 0;
		let source = 0;
		let mask = 0x80;
		for (let place = 0; place < BLOCK_SIZE; place += 1) {
			let value = 0;
			let weight = 4;
			for (let bit = 0; bit < 3; bit += 1) {
				if (0 === left) {
					bits = this.buffer[source] ?? 0;
					source += 1;
					left = 8;
				}
				if (0 !== (bits & mask)) value |= weight;
				left -= 1;
				weight >>= 1;
				mask = Mi2Reader.rotateByteRight(mask, 1);
			}
			this.indices[at] = value;
			at += 1;
		}
		for (let place = 0; place < BLOCK_SIZE; place += 1) {
			const index = this.indices[place] ?? 0;
			this.block[place] =
				index > 0
					? (this.palette[index - 1] ?? 0)
					: this.byte("the places of the file of the walk");
		}
	}

	/** `Mi2Format.Reader.Op7`: the colour map of the walk and the counts of four places of the file. */
	private op7(): void {
		const count = this.byte("the counts of the walk");
		this.take(this.palette, count, "the colour map of the walk");
		this.take(this.buffer, BLOCK_SIZE / 2, "the counts of the walk");
		let at = 0;
		for (let place = 0; place < BLOCK_SIZE / 2; place += 1) {
			let bits = this.buffer[place] ?? 0;
			for (let count2 = 0; count2 < 2; count2 += 1) {
				const index = bits >> 4;
				bits = (bits << 4) & 0xff;
				this.block[at] =
					index > 0
						? (this.palette[index - 1] ?? 0)
						: this.byte("the places of the file of the walk");
				at += 1;
			}
		}
	}

	/** `Mi2Format.Reader.AdjustBlock`: the places of the block of the walk behind the counts of them. */
	private adjustBlock(): void {
		let at = 0;
		for (let row = 0; row < BLOCK_EDGE; row += 1) {
			this.byte("the counts of the walk");
			for (let place = 0; place < BLOCK_EDGE; place += 1) {
				this.block[at] = ((this.block[at] ?? 0) << 1) & 0xff;
				at += 1;
			}
		}
	}
}

/** `Mi2Format.Read`: the places of the picture, handed over as a bitmap. */
export function unpackMi2Picture(data: Buffer, layout: Mi2Layout): Buffer {
	const stride = (layout.width + 7) & ~7;
	const blocksW = Math.ceil(layout.width / BLOCK_EDGE);
	const blocksH = Math.ceil(layout.height / BLOCK_EDGE);
	const reader = new Mi2Reader(data);
	const channel: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	if (8 === layout.bitsPerPixel) {
		const palette = reader.readPalette(layout.colors);
		reader.unpackChannel(channel, stride, blocksW, blocksH);
		// The places of the row of the walk of the picture stand of the count of the places of the file of
		// the eight places of the block of them: the places of the row of the picture stand of the places
		// of the file of the count of the places of it.
		const places: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			channel.copy(
				places,
				row * layout.width,
				row * stride,
				row * stride + layout.width,
			);
		}
		return writeBmp8Palette(layout.width, layout.height, places, palette);
	}
	const bgr: Buffer = Buffer.alloc(
		layout.width * layout.height * COLOR_PLACES,
		0x00,
	);
	for (let color = 0; color < COLOR_PLACES; color += 1) {
		reader.unpackChannel(channel, stride, blocksW, blocksH);
		let source = 0;
		let destination = color;
		for (let row = 0; row < layout.height; row += 1) {
			for (let place = 0; place < layout.width; place += 1) {
				bgr[destination] = channel[source + place] ?? 0;
				destination += COLOR_PLACES;
			}
			source += stride;
		}
	}
	return writeBmp24(layout.width, layout.height, bgr);
}

export const maplMi2ImageDescriptor: FormatDescriptor = {
	id: "mapl-mi2-image",
	name: "Mapl engine image",
	extensions: ["mi2", "fcg"],
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
			source: "Legacy/Mapl/ImageMI2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const maplMi2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maplMi2ImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x28, 0x00, 0x00, 0x00]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readMi2Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readMi2Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Mapl engine");
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
					colors: layout.colors,
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
		const layout = readMi2Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the Mapl engine");
		return Readable.from([unpackMi2Picture(data, layout)]);
	},
});
