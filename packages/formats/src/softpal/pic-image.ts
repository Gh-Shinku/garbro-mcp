// Port of GARbro "ArcFormats/Softpal/ImagePIC.cs" (tag "PIC/SOFTPAL", class PicFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the engine of Softpal of the walks of
// the places of the file in blocks of the eight places of the file of the block of them: the counts of the
// blocks of the picture, of the places of the file of the walk of every block of it behind the counts of
// them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 8;
/** The count of the places of the file of a row of a block of the picture and of a place of it. */
const BLOCK_EDGE = 8;
const BLOCK_SIZE = BLOCK_EDGE * BLOCK_EDGE;
/** The count of the places of the file of a colour of the picture of eight places to a place. */
const GRAY_COLORS = 0x100;
const COLOR_PLACES_24 = 3;
const COLOR_PLACES_32 = 4;

/**
 * `PicReader.InitBlockValues`: the counts of the walk of the places of the file of a block of the picture,
 * of the counts of the places of the file of them: the counts of the place of the file of the walk of them
 * above the count of the places of the file of the walk stand of the counts of the file of it the other way
 * round.
 */
function initBlockValues(length: number): Uint8Array {
	const values = new Uint8Array(length * 2);
	for (let at = 0; at < length; at += 1) {
		values[at] = at;
		values[values.length - 1 - at] = (-1 - at) & 0xff;
	}
	return values;
}

const VALUES_2BIT = initBlockValues(2);
const VALUES_4BIT = initBlockValues(8);
const VALUES_6BIT = initBlockValues(0x20);

/** `PicReader.ChannelOrder`: the places of the file of the channels of a picture of thirty two places. */
const CHANNEL_ORDER: readonly number[] = [3, 0, 1, 2];

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface SoftpalPicLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	blocksWidth: number;
	blocksHeight: number;
}

/** `PicFormat.ReadMetaData`. */
export function readSoftpalPicLayout(
	data: Buffer,
): SoftpalPicLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const places = data.readInt16LE(0);
	if (1 !== places && 3 !== places && 4 !== places) return undefined;
	const width = data.readUInt16LE(2);
	const height = data.readUInt16LE(4);
	if (0 === width || 0 === height) return undefined;
	const blocksWidth = data[6] ?? 0;
	const blocksHeight = data[7] ?? 0;
	if (blocksWidth * BLOCK_EDGE < width) return undefined;
	if (blocksHeight * BLOCK_EDGE < height) return undefined;
	return {
		width,
		height,
		bitsPerPixel: places * 8,
		blocksWidth,
		blocksHeight,
	};
}

/** `PicReader`: the walks of the places of the file of a picture of the engine. */
class SoftpalPicReader {
	private at = HEAD_SIZE;
	private readonly control: Buffer;
	private readonly output: Buffer;
	private readonly block = Buffer.alloc(BLOCK_SIZE, 0x00);
	private readonly pixel = Buffer.alloc(COLOR_PLACES_32, 0x00);

	constructor(
		private readonly data: Buffer,
		private readonly layout: SoftpalPicLayout,
	) {
		const count = layout.blocksWidth * layout.blocksHeight;
		if (this.at + count > data.length) {
			throw invalidPicture(
				"The counts of the walks of the picture stand short of the file",
			);
		}
		this.control = data.subarray(this.at, this.at + count);
		this.at += count;
		this.output = Buffer.alloc(
			this.stride * layout.blocksHeight * BLOCK_EDGE,
			0x00,
		);
	}

	/** The count of the places of the file of a row of the picture of the blocks of it. */
	private get stride(): number {
		return (
			this.layout.blocksWidth * BLOCK_EDGE * (this.layout.bitsPerPixel / 8)
		);
	}

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

	/** `PicReader.Unpack`: the places of the picture of the walks of the places of the file of it. */
	unpack(): Buffer {
		if (8 === this.layout.bitsPerPixel) {
			this.unpack8bpp();
		} else if (24 === this.layout.bitsPerPixel) {
			this.unpack24bpp();
		} else if (32 === this.layout.bitsPerPixel) {
			this.unpack32bpp();
		} else {
			throw invalidPicture(
				"The picture of the engine stands of no count of the places of a colour of its own",
			);
		}
		// The places of the picture stand of the blocks of the walk of the places of the file of it of the
		// block of the file the last of them the first, of the count of the places of the picture of it.
		const stride = (this.layout.width * this.layout.bitsPerPixel) / 8;
		const cropped: Buffer = Buffer.alloc(stride * this.layout.height, 0x00);
		let destination = 0;
		let source = this.output.length - this.stride;
		while (destination < cropped.length) {
			this.output.copy(cropped, destination, source, source + stride);
			destination += stride;
			source -= this.stride;
		}
		return cropped;
	}

	/** `PicReader.Unpack8bpp`: the walks of the places of the file of a picture of eight places to a place. */
	private unpack8bpp(): void {
		const { blocksWidth, blocksHeight } = this.layout;
		for (let blockY = 0; blockY < blocksHeight; blockY += 1) {
			for (let blockX = 0; blockX < blocksWidth; blockX += 1) {
				const control =
					this.control[blockX + blocksWidth * (blocksHeight - blockY - 1)] ?? 0;
				if (0x80 === control) {
					this.block.fill(0x00, 0, BLOCK_SIZE);
				} else if (0x81 === control) {
					this.block.fill(0xff, 0, BLOCK_SIZE);
				} else {
					const pixel = this.byte(
						"the walk of the places of the file of a block of the picture",
					);
					this.decodeBlock(control, pixel);
				}
				let destination =
					BLOCK_EDGE * (blockX + BLOCK_EDGE * blockY * blocksWidth);
				let source = 0;
				for (let row = 0; row < BLOCK_EDGE; row += 1) {
					this.block.copy(
						this.output,
						destination,
						source,
						source + BLOCK_EDGE,
					);
					destination += this.stride;
					source += BLOCK_EDGE;
				}
			}
		}
	}

	/** `PicReader.Unpack24bpp`: the walks of a picture of twenty four places to a place. */
	private unpack24bpp(): void {
		const { blocksWidth, blocksHeight } = this.layout;
		for (let blockY = 0; blockY < blocksHeight; blockY += 1) {
			for (let blockX = 0; blockX < blocksWidth; blockX += 1) {
				let control =
					this.control[blockX + blocksWidth * (blocksHeight - blockY - 1)] ?? 0;
				if (0x80 === control) {
					let destination =
						COLOR_PLACES_24 *
						BLOCK_EDGE *
						(blockX + BLOCK_EDGE * blockY * blocksWidth);
					for (let row = 0; row < BLOCK_EDGE; row += 1) {
						this.output.fill(
							0x00,
							destination,
							destination + BLOCK_EDGE * COLOR_PLACES_24,
						);
						destination += this.stride;
					}
					continue;
				}
				this.take(
					this.pixel,
					COLOR_PLACES_24,
					"the walk of the places of the file of a block of the picture",
				);
				for (let channel = 0; channel < COLOR_PLACES_24; channel += 1) {
					this.decodeBlock(control & 3, this.pixel[channel] ?? 0);
					let destination =
						COLOR_PLACES_24 *
							BLOCK_EDGE *
							(blockX + BLOCK_EDGE * blockY * blocksWidth) +
						channel;
					let source = 0;
					for (let row = 0; row < BLOCK_EDGE; row += 1) {
						for (let place = 0; place < BLOCK_EDGE; place += 1) {
							this.output[destination + place * COLOR_PLACES_24] =
								this.block[source] ?? 0;
							source += 1;
						}
						destination += this.stride;
					}
					control >>= 2;
				}
			}
		}
	}

	/** `PicReader.Unpack32bpp`: the walks of a picture of thirty two places to a place. */
	private unpack32bpp(): void {
		const { blocksWidth, blocksHeight } = this.layout;
		for (let blockY = 0; blockY < blocksHeight; blockY += 1) {
			for (let blockX = 0; blockX < blocksWidth; blockX += 1) {
				let control =
					this.control[blockX + blocksWidth * (blocksHeight - blockY - 1)] ?? 0;
				this.take(
					this.pixel,
					COLOR_PLACES_32,
					"the walk of the places of the file of a block of the picture",
				);
				for (let channel = 0; channel < COLOR_PLACES_32; channel += 1) {
					this.decodeBlock(control & 3, this.pixel[channel] ?? 0);
					let destination =
						BLOCK_EDGE *
							COLOR_PLACES_32 *
							(blockX + BLOCK_EDGE * blockY * blocksWidth) +
						(CHANNEL_ORDER[channel] ?? 0);
					let source = 0;
					for (let row = 0; row < BLOCK_EDGE; row += 1) {
						for (let place = 0; place < BLOCK_EDGE; place += 1) {
							this.output[destination + place * COLOR_PLACES_32] =
								this.block[source] ?? 0;
							source += 1;
						}
						destination += this.stride;
					}
					control >>= 2;
				}
			}
		}
	}

	/** `PicReader.DecodeBlock`: the places of the file of the walk of a block of the picture. */
	private decodeBlock(control: number, pixel: number): void {
		let destination = 0;
		if (0 === control) {
			for (let count = 0; count < BLOCK_SIZE / 4; count += 1) {
				const places = this.byte(
					"the walks of the places of the file of a block of the picture",
				);
				this.block[destination] = VALUES_2BIT[(places >> 6) & 3] ?? 0;
				this.block[destination + 1] = VALUES_2BIT[(places >> 4) & 3] ?? 0;
				this.block[destination + 2] = VALUES_2BIT[(places >> 2) & 3] ?? 0;
				this.block[destination + 3] = VALUES_2BIT[places & 3] ?? 0;
				destination += 4;
			}
		} else if (1 === control) {
			for (let count = 0; count < BLOCK_SIZE / 2; count += 1) {
				const places = this.byte(
					"the walks of the places of the file of a block of the picture",
				);
				this.block[destination] = VALUES_4BIT[places >> 4] ?? 0;
				this.block[destination + 1] = VALUES_4BIT[places & 0x0f] ?? 0;
				destination += 2;
			}
		} else if (2 === control) {
			for (let count = 0; count < BLOCK_SIZE / 4; count += 1) {
				const first = this.byte(
					"the walks of the places of the file of a block of the picture",
				);
				const second = this.byte(
					"the walks of the places of the file of a block of the picture",
				);
				const third = this.byte(
					"the walks of the places of the file of a block of the picture",
				);
				const fourth =
					(third >> 6) | ((second >> 4) & 0x0c) | ((first >> 2) & 0x30);
				this.block[destination] = VALUES_6BIT[first & 0x3f] ?? 0;
				this.block[destination + 1] = VALUES_6BIT[second & 0x3f] ?? 0;
				this.block[destination + 2] = VALUES_6BIT[third & 0x3f] ?? 0;
				this.block[destination + 3] = VALUES_6BIT[fourth] ?? 0;
				destination += 4;
			}
		} else if (3 === control) {
			this.take(
				this.block,
				BLOCK_SIZE,
				"the walks of the places of the file of a block of the picture",
			);
		}
		this.predict(pixel);
	}

	/** `PicReader.DecodeBlock` of the places of the file of the walk of a block of the picture behind. */
	private predict(pixel: number): void {
		const block = this.block;
		const add = (at: number, value: number): void => {
			block[at] = ((block[at] ?? 0) + value) & 0xff;
		};
		let first = pixel + (block[27] ?? 0);
		block[27] = first & 0xff;
		add(26, first);
		add(25, block[26] ?? 0);
		add(24, block[25] ?? 0);
		let second = first + (block[18] ?? 0);
		add(19, first);
		block[18] = second & 0xff;
		add(17, second);
		add(16, block[17] ?? 0);
		let third = second + (block[9] ?? 0);
		add(11, block[19] ?? 0);
		add(10, second);
		block[9] = third & 0xff;
		add(8, third);
		add(3, block[11] ?? 0);
		add(2, block[10] ?? 0);
		add(1, third);
		add(0, third);
		first = pixel + (block[28] ?? 0);
		block[28] = first & 0xff;
		add(29, first);
		add(30, block[29] ?? 0);
		add(31, block[30] ?? 0);
		second = first + (block[21] ?? 0);
		add(20, first);
		block[21] = second & 0xff;
		add(22, second);
		add(23, block[22] ?? 0);
		third = second + (block[14] ?? 0);
		add(12, block[20] ?? 0);
		add(13, second);
		block[14] = third & 0xff;
		add(15, third);
		add(4, block[12] ?? 0);
		add(5, block[13] ?? 0);
		add(6, third);
		add(7, third);
		first = pixel + (block[35] ?? 0);
		block[35] = first & 0xff;
		add(34, first);
		add(33, block[34] ?? 0);
		add(32, block[33] ?? 0);
		second = first + (block[42] ?? 0);
		add(43, first);
		block[42] = second & 0xff;
		add(41, second);
		add(40, block[41] ?? 0);
		third = second + (block[49] ?? 0);
		add(51, block[43] ?? 0);
		add(50, second);
		block[49] = third & 0xff;
		add(48, third);
		add(59, block[51] ?? 0);
		add(58, block[50] ?? 0);
		add(57, third);
		add(56, third);
		first = pixel + (block[36] ?? 0);
		block[36] = first & 0xff;
		add(37, first);
		add(38, block[37] ?? 0);
		add(39, block[38] ?? 0);
		second = first + (block[45] ?? 0);
		add(44, first);
		block[45] = second & 0xff;
		add(46, second);
		add(47, block[46] ?? 0);
		third = second + (block[54] ?? 0);
		add(52, block[44] ?? 0);
		add(53, second);
		block[54] = third & 0xff;
		add(55, third);
		add(60, block[52] ?? 0);
		add(61, block[53] ?? 0);
		add(62, third);
		add(63, third);
	}
}

/** `PicFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackSoftpalPic(
	data: Buffer,
	layout: SoftpalPicLayout,
): Buffer {
	const reader = new SoftpalPicReader(data, layout);
	const cropped = reader.unpack();
	if (8 === layout.bitsPerPixel) {
		// The picture of the engine of eight places to a place stands of the counts of the places of the
		// file of the picture itself: the colour map of it stands of the count of the places of the file of
		// it from the black to the white of it.
		const palette: Buffer = Buffer.alloc(GRAY_COLORS * 4, 0x00);
		for (let at = 0; at < GRAY_COLORS; at += 1) {
			palette[at * 4] = at;
			palette[at * 4 + 1] = at;
			palette[at * 4 + 2] = at;
		}
		return writeBmp8Palette(layout.width, layout.height, cropped, palette);
	}
	if (24 === layout.bitsPerPixel) {
		return writeBmp24(layout.width, layout.height, cropped);
	}
	return writeBmp32(layout.width, layout.height, cropped);
}

export const softpalPicImageDescriptor: FormatDescriptor = {
	id: "softpal-pic-image",
	name: "Softpal engine image",
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
			source: "ArcFormats/Softpal/ImagePIC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const softpalPicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: softpalPicImageDescriptor,
	// The reference stands of no mark of its own: the places of the file of the head of the picture are
	// what decides.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readSoftpalPicLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readSoftpalPicLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Softpal engine");
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
					blocksWidth: layout.blocksWidth,
					blocksHeight: layout.blocksHeight,
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
		const layout = readSoftpalPicLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Softpal engine");
		return Readable.from([unpackSoftpalPic(data, layout)]);
	},
});
