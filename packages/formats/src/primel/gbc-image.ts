// Format reference: GARBro "ArcFormats/Primel/ImageGBC.cs", class `GbcFormat` with the `GbcReader` beside it.
// The bits of a picture are read by GARbro's own "ArcFormats/BitStream.cs", an `MsbBitStream`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { GBC_ZIGZAG } from "./gbc-tables.js";

const MARK = Buffer.from("GBCF", "latin1");
const HEAD_SIZE = 0x14;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xc;
const BITS_FIELD = 0x10;
const FLAGS_FIELD = 0x12;
const DATA_OFFSET = 0x30;
/** Two ways a picture of this engine is drawn stand of its own. */
const DEEP_FLAGS = 0x800;
const FLAGS_MASK = 0xff00;
/** A picture stands of blocks of eight places by eight. */
const BLOCK = 8;
const BLOCK_PLACES = BLOCK * BLOCK;
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
const PLACE_BIAS = 128;
const LIMIT = 256 * 1024 * 1024;

export interface GbcLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flags: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GbcFormat.ReadMetaData`: the picture opens with its own word, then the places of its picture. */
export function readGbcLayout(data: Buffer): GbcLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	if (
		BITS_8 !== bitsPerPixel &&
		BITS_24 !== bitsPerPixel &&
		BITS_32 !== bitsPerPixel
	) {
		return undefined;
	}
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		flags: data.readUInt16LE(FLAGS_FIELD),
	};
}

/** The bits of a picture, of which the highest of a byte stands first. */
class GbcBits {
	private readonly data: Buffer;
	private position: number;
	private bits = 0;
	private left = 0;

	constructor(data: Buffer, position: number) {
		this.data = data;
		this.position = position;
	}

	bitsOf(count: number): number {
		while (this.left < count) {
			if (this.position >= this.data.length) {
				throw invalidPicture("The picture ends inside the bits of its own");
			}
			this.bits = ((this.bits << 8) | (this.data[this.position] ?? 0)) >>> 0;
			this.position += 1;
			this.left += 8;
		}
		this.left -= count;
		return (this.bits >>> this.left) & ((1 << count) - 1);
	}

	bit(): number {
		return this.bitsOf(1);
	}
}

/** `GbcReader.GetInt`: a run of the places of a block, as the first way of the picture names it. */
function readGbcInt(bits: GbcBits): number {
	const count = bits.bitsOf(4);
	if (0 === count) return 0;
	if (1 === count) return 1;
	if (count >= 2 && count <= 7) {
		return bits.bitsOf(count - 1) + (1 << (count - 1));
	}
	if (8 === count) return -1;
	if (9 === count) return -2;
	return bits.bitsOf(count - 9) - (2 << (count - 9));
}

/** `GbcReader.GetIntV2`: the same, with as many places standing over as the bits behind it name. */
function readGbcIntV2(bits: GbcBits): { value: number; skip: number } {
	const count = bits.bitsOf(4);
	if (0 === count) {
		let repeat = 1;
		while (repeat < 16 && 1 === bits.bit()) repeat += 1;
		return { value: 0, skip: 16 === repeat ? 0 : repeat };
	}
	if (1 === count) return { value: 1, skip: 0 };
	if (count >= 2 && count <= 7) {
		return { value: bits.bitsOf(count - 1) + (1 << (count - 1)), skip: 0 };
	}
	if (8 === count) return { value: -1, skip: 0 };
	if (9 === count) return { value: -2, skip: 0 };
	return { value: bits.bitsOf(count - 9) - (2 << (count - 9)), skip: 0 };
}

/** `GbcReader.RestoreBlock`: the places of a block are carried from the place before them, twice over. */
function restoreBlock(block: Int32Array): void {
	for (let column = 1; column < BLOCK; column += 1) {
		block[column] = (block[column] ?? 0) + (block[column - 1] ?? 0);
		block[BLOCK + column] = (block[BLOCK + column] ?? 0) + (block[column] ?? 0);
	}
	for (let row = 1; row < BLOCK; row += 1) {
		for (let column = 1; column < BLOCK; column += 1) {
			const at = row * BLOCK + column;
			block[at] = (block[at] ?? 0) + (block[at - BLOCK - 1] ?? 0);
		}
	}
}

/** `GbcReader.RestoreBlockV2`: the places of a block are carried along its rows and then along its columns. */
function restoreBlockV2(block: Int32Array, bits: GbcBits): void {
	for (let at = 0; at < BLOCK_PLACES; at += 1) {
		const { value, skip } = readGbcIntV2(bits);
		if (0 !== value) block[GBC_ZIGZAG[at] ?? 0] = value;
		else if (0 === skip) break;
		else at += skip - 1;
	}
	for (let row = 0; row < BLOCK_PLACES; row += BLOCK) {
		for (let column = 1; column < BLOCK; column += 1) {
			block[row + column] =
				(block[row + column] ?? 0) + (block[row + column - 1] ?? 0);
		}
	}
	for (let row = BLOCK; row < BLOCK_PLACES; row += BLOCK) {
		for (let column = 0; column < BLOCK; column += 1) {
			block[row + column] =
				(block[row + column] ?? 0) + (block[row - BLOCK + column] ?? 0);
		}
	}
}

/** The places of a block, drawn into the picture with a place of their own taken off every one of them. */
function drawGbcBlock(
	output: Buffer,
	block: Int32Array,
	layout: GbcLayout,
	stride: number,
	blockX: number,
	blockY: number,
	blocksWide: number,
	blocksHigh: number,
	deep: boolean,
): void {
	const places = layout.bitsPerPixel / BITS_8;
	for (let row = 0; row < BLOCK; row += 1) {
		if (blockY + 1 === blocksHigh && blockY * BLOCK + row >= layout.height)
			break;
		for (let column = 0; column < BLOCK; column += 1) {
			if (blockX + 1 === blocksWide && blockX * BLOCK + column >= layout.width)
				break;
			const at =
				(blockY * BLOCK + row) * stride + (blockX * BLOCK + column) * places;
			const source = row * BLOCK + column;
			if (BITS_8 === layout.bitsPerPixel) {
				const value = block[source] ?? 0;
				output[at] = (deep ? value : value - PLACE_BIAS) & 0xff;
				continue;
			}
			for (let plane = 0; plane < places; plane += 1) {
				const value = block[plane * BLOCK_PLACES + source] ?? 0;
				// The first way of a picture takes a place of its own off every place of it; the second
				// hands them over as they stand.
				const place = deep ? value : value - PLACE_BIAS;
				// The places of a colour stand the other way round in the block from the way a bitmap keeps
				// them: the first way hands the three of them over reversed, the second keeps the fourth.
				const index = deep ? (3 === plane ? 3 : 2 - plane) : places - 1 - plane;
				output[at + index] = place & 0xff;
			}
		}
	}
}

/** `GbcReader.UnpackV1`: the places of a block carried along the zigzag order of it, plane by plane. */
function unpackGbcV1(
	data: Buffer,
	layout: GbcLayout,
	stride: number,
	output: Buffer,
): void {
	const bits = new GbcBits(data, DATA_OFFSET);
	const placeSize = layout.bitsPerPixel / BITS_8;
	const blocksWide = Math.trunc((layout.width + BLOCK - 1) / BLOCK);
	const blocksHigh = Math.trunc((layout.height + BLOCK - 1) / BLOCK);
	const block = new Int32Array(placeSize * BLOCK_PLACES);
	for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
		for (let blockX = 0; blockX < blocksWide; blockX += 1) {
			let last = 0;
			for (let at = 0; at < BLOCK_PLACES; at += 1) {
				last += readGbcInt(bits);
				block[GBC_ZIGZAG[at] ?? 0] = last;
			}
			for (let plane = 1; plane < placeSize; plane += 1) {
				for (let at = 0; at < BLOCK_PLACES; at += 1) {
					block[plane * BLOCK_PLACES + (GBC_ZIGZAG[at] ?? 0)] =
						readGbcInt(bits);
				}
				restoreBlock(block.subarray(plane * BLOCK_PLACES));
			}
			drawGbcBlock(
				output,
				block,
				layout,
				stride,
				blockX,
				blockY,
				blocksWide,
				blocksHigh,
				false,
			);
		}
	}
}

/** `GbcReader.UnpackV2`: the places of a block named one by one, of as many as stand over. */
function unpackGbcV2(
	data: Buffer,
	layout: GbcLayout,
	stride: number,
	output: Buffer,
): void {
	const bits = new GbcBits(data, DATA_OFFSET);
	const placeSize = layout.bitsPerPixel / BITS_8;
	const blocksWide = Math.trunc((layout.width + BLOCK - 1) / BLOCK);
	const blocksHigh = Math.trunc((layout.height + BLOCK - 1) / BLOCK);
	const block = new Int32Array(placeSize * BLOCK_PLACES);
	for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
		for (let blockX = 0; blockX < blocksWide; blockX += 1) {
			for (let plane = 0; plane < placeSize; plane += 1) {
				block.fill(0, plane * BLOCK_PLACES, (plane + 1) * BLOCK_PLACES);
				restoreBlockV2(block.subarray(plane * BLOCK_PLACES), bits);
			}
			drawGbcBlock(
				output,
				block,
				layout,
				stride,
				blockX,
				blockY,
				blocksWide,
				blocksHigh,
				true,
			);
		}
	}
}

/** `GbcReader.Unpack`: the way the head names draws the picture, of blocks of eight places by eight. */
export function unpackGbcPicture(data: Buffer, layout: GbcLayout): Buffer {
	const stride = (layout.width * layout.bitsPerPixel) / BITS_8;
	const output = Buffer.alloc(stride * layout.height, 0x00);
	if (DEEP_FLAGS === (layout.flags & FLAGS_MASK)) {
		unpackGbcV2(data, layout, stride, output);
	} else {
		unpackGbcV1(data, layout, stride, output);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gbcImageDescriptor: FormatDescriptor = {
	id: "primel-gbc-image",
	name: "Primel Adventure System image",
	extensions: ["gbc"],
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
			source: "ArcFormats/Primel/ImageGBC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gbcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gbcImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readGbcLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGbcLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Primel engine");
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
		const layout = readGbcLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Primel engine");
		const pixels = unpackGbcPicture(data, layout);
		if (BITS_8 === layout.bitsPerPixel) {
			return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
		}
		if (BITS_24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
