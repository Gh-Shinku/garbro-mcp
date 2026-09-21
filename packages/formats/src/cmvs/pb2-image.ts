// Format reference: GARBro "ArcFormats/Cmvs/ImagePB2.cs", classes `Pb2Format` and the `Pb2Reader` that
// stands on the `PbReaderBase` of "ArcFormats/Cmvs/ImagePB.cs" - the same base the ported PB3 pictures use,
// so the walks below are the project's already ported ones. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import {
	pb3LzssResetFrame,
	pb3LzssUnpack,
	pb3UnpackJbp,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The engine's own word. */
const SIGNATURE = Buffer.from("PB2A", "latin1");
/** The head, and the tail of the file that keys it. */
const HEADER_SIZE = 0x20;
const TAIL_SIZE = 27;
const HEADER_FIELD_START = 8;
const TAIL_XOR_KEYS = [24, 25];
/** Where the fields of the head stand. */
const INPUT_SIZE_FIELD = 4;
const FRAME_COUNT_FIELD = 8;
const TYPE_FIELD = 0x10;
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x14;
const DEPTH_FIELD = 0x16;
const OFFSET1_FIELD = 0x18;
const OFFSET2_FIELD = 0x1c;
/** The frame the walks of this engine read back from, which the ported PB3 walk already carries. */
const FRAME_SIZE = 0x800;
/** The block every packed way of this engine is cut into. */
const BLOCK_SIZE = 8;
/** The ways a picture of this engine may be packed. */
const TYPE_BLOCKS = 1;
const TYPE_BLOCK_MAP = 2;
const TYPE_JBP = 4;
const TYPE_CHANNELS = 6;
/** The picture of the JBP way stands behind the head, and its alpha channel where the head says. */
const JBP_OFFSET = 0x20;
/** Where the channel table of the last way stands, and how far its own places reach from there. */
const CHANNEL_TABLE_START = 0x24;
const CHANNEL_TABLE_SIZE = 0x20;
const CHANNEL_COUNT = 4;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface Pb2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Which way the picture's bytes are packed. */
	type: number;
	/** The bytes a pixel takes. */
	pixelSize: number;
	/** The stride every row of the picture takes. */
	stride: number;
	offset1: number;
	offset2: number;
	frameCount: number;
	inputSize: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Pb2Format.ReadMetaData`: the head of this engine holds only its word as it stands. Every byte from its
 * eighth on is keyed with the **last twenty seven bytes** of the file: exclusive-or with one of two bytes
 * near the end of that tail, then subtract one of its earlier bytes.
 */
export function readPb2Layout(data: Buffer): Pb2Layout | undefined {
	if (data.length < HEADER_SIZE || data.length < TAIL_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const header = Buffer.from(data.subarray(0, HEADER_SIZE));
	const tail = data.subarray(data.length - TAIL_SIZE);
	for (let at = HEADER_FIELD_START; at < HEADER_SIZE; at += 2) {
		for (let half = 0; half < 2; half += 1) {
			const index = at + half;
			const keyed =
				(header[index] ?? 0) ^ (tail[TAIL_XOR_KEYS[half] ?? 0] ?? 0);
			header[index] = (keyed - (tail[index - HEADER_FIELD_START] ?? 0)) & 0xff;
		}
	}
	const width = header.readUInt16LE(WIDTH_FIELD);
	const height = header.readUInt16LE(HEIGHT_FIELD);
	const bitsPerPixel = header.readUInt16LE(DEPTH_FIELD);
	const type = header.readUInt16LE(TYPE_FIELD);
	if (0 === width || 0 === height || 0 === bitsPerPixel) return undefined;
	if (8 !== bitsPerPixel && 24 !== bitsPerPixel && 32 !== bitsPerPixel) {
		return undefined;
	}
	const pixelSize = bitsPerPixel >> 3;
	// The two ways that keep four channels a pixel name their own stride in four bytes a pixel.
	const stride =
		TYPE_JBP === type || TYPE_CHANNELS === type ? width * 4 : width * pixelSize;
	const total = stride * height;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		type,
		pixelSize,
		stride,
		offset1: header.readInt32LE(OFFSET1_FIELD),
		offset2: header.readInt32LE(OFFSET2_FIELD),
		frameCount: header.readInt32LE(FRAME_COUNT_FIELD),
		inputSize: header.readInt32LE(INPUT_SIZE_FIELD),
	};
}

/** The frame every walk of this engine reads back from, which begins as nothing. */
function newFrame(): Uint8Array {
	const frame = new Uint8Array(FRAME_SIZE);
	pb3LzssResetFrame(frame);
	return frame;
}

/**
 * `Pb2Reader.UnpackV1`: the whole picture is packed as one run of blocks of eight by eight, and each channel
 * of it is placed block by block, so the blocks of one channel come before the next channel's.
 */
export function unpackPb2V1(data: Buffer, layout: Pb2Layout): Buffer {
	const blockData = new Uint8Array(layout.stride * layout.height);
	pb3LzssUnpack({
		input: data,
		bitSrc: layout.offset1,
		dataSrc: layout.offset2,
		frame: newFrame(),
		output: blockData,
		outputSize: blockData.length,
	});
	const output: Buffer = Buffer.alloc(blockData.length, 0x00);
	const blocksAcross = Math.ceil(layout.width / BLOCK_SIZE);
	const blocksDown = Math.ceil(layout.height / BLOCK_SIZE);
	let source = 0;
	for (let channel = 0; channel < layout.pixelSize; channel += 1) {
		let destination = channel;
		for (let blockY = 0; blockY < blocksDown; blockY += 1) {
			const y = blockY * BLOCK_SIZE;
			const blockHeight = Math.min(layout.height - y, BLOCK_SIZE);
			let row = destination;
			for (let blockX = 0; blockX < blocksAcross; blockX += 1) {
				const x = blockX * BLOCK_SIZE;
				const blockWidth = Math.min(layout.width - x, BLOCK_SIZE);
				let at = row;
				for (let line = 0; line < blockHeight; line += 1) {
					for (let column = 0; column < blockWidth; column += 1) {
						output[at + column * layout.pixelSize] = blockData[source] ?? 0;
						source += 1;
					}
					at += layout.stride;
				}
				row += BLOCK_SIZE * layout.pixelSize;
			}
			destination += layout.stride * BLOCK_SIZE;
		}
	}
	return output;
}

/**
 * `Pb2Reader.UnpackV2`: every channel carries a record of its own - two lengths, then a block of flags and a
 * block of bytes - and a packed plane of the blocks themselves. A flag that is set fills its whole block with
 * one byte of the record; a clear one takes the next byte of the plane.
 */
export function unpackPb2V2(data: Buffer, layout: Pb2Layout): Buffer {
	const output: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const blocksAcross = Math.ceil(layout.width / BLOCK_SIZE);
	const blocksDown = Math.ceil(layout.height / BLOCK_SIZE);
	let controlAt = layout.offset1 + layout.pixelSize * 4;
	let dataAt = layout.offset2 + layout.pixelSize * 4;
	let blockData: Uint8Array | undefined;
	for (let channel = 0; channel < layout.pixelSize; channel += 1) {
		if (controlAt + 12 > data.length) {
			throw invalid("The picture's channel record reaches past the file");
		}
		const flagsSize = data.readInt32LE(controlAt);
		const fillSize = data.readInt32LE(controlAt + 4);
		const size = data.readInt32LE(controlAt + 8);
		if (size < 0 || size > LIMIT) {
			throw invalid("The picture's blocks are larger than it may be");
		}
		if (!blockData || blockData.length < size) blockData = new Uint8Array(size);
		pb3LzssUnpack({
			input: data,
			bitSrc: controlAt + flagsSize + fillSize + 12,
			dataSrc: dataAt,
			frame: newFrame(),
			output: blockData,
			outputSize: size,
		});
		let bitMask = 0x80;
		let blockSource = 0;
		let flagAt = controlAt + 12;
		let fillAt = controlAt + flagsSize + 12;
		let destination = channel;
		for (let blockY = 0; blockY < blocksDown; blockY += 1) {
			const y = blockY * BLOCK_SIZE;
			const blockHeight = Math.min(layout.height - y, BLOCK_SIZE);
			let row = destination;
			for (let blockX = 0; blockX < blocksAcross; blockX += 1) {
				const x = blockX * BLOCK_SIZE;
				if (0 === bitMask) {
					flagAt += 1;
					bitMask = 0x80;
				}
				const blockWidth = Math.min(layout.width - x, BLOCK_SIZE);
				let at = row;
				if (0 !== (bitMask & (data[flagAt] ?? 0))) {
					const value = data[fillAt] ?? 0;
					fillAt += 1;
					for (let line = 0; line < blockHeight; line += 1) {
						for (let column = 0; column < blockWidth; column += 1) {
							output[at + column * layout.pixelSize] = value;
						}
						at += layout.stride;
					}
				} else {
					for (let line = 0; line < blockHeight; line += 1) {
						for (let column = 0; column < blockWidth; column += 1) {
							output[at + column * layout.pixelSize] =
								blockData[blockSource] ?? 0;
							blockSource += 1;
						}
						at += layout.stride;
					}
				}
				row += BLOCK_SIZE * layout.pixelSize;
				bitMask >>= 1;
			}
			destination += layout.stride * BLOCK_SIZE;
		}
		controlAt += data.readInt32LE(layout.offset1 + channel * 4);
		dataAt += data.readInt32LE(layout.offset2 + channel * 4);
	}
	return output;
}

/**
 * `Pb2Reader.UnpackV6`: four channels, each packed away on its own and read from a table that stands behind
 * the first nothing in the head's tail. The colours are folded back one into the next - red against blue,
 * green against that, blue against that - and the fourth channel is the alpha.
 */
export function unpackPb2V6(data: Buffer, layout: Pb2Layout): Buffer {
	const size = layout.width * layout.height;
	let tableAt = data.indexOf(0, CHANNEL_TABLE_START);
	if (tableAt < 0) {
		throw invalid("The picture's channel table is not where it should be");
	}
	tableAt = (tableAt + 3) & ~3;
	const channels: Uint8Array[] = [];
	for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
		const entry = tableAt + channel * 8;
		if (entry + 8 > data.length) {
			throw invalid("The picture's channel table reaches past the file");
		}
		const plane = new Uint8Array(size);
		pb3LzssUnpack({
			input: data,
			bitSrc: tableAt + CHANNEL_TABLE_SIZE + data.readInt32LE(entry),
			dataSrc: tableAt + CHANNEL_TABLE_SIZE + data.readInt32LE(entry + 4),
			frame: newFrame(),
			output: plane,
			outputSize: size,
		});
		channels.push(plane);
	}
	const output: Buffer = Buffer.alloc(4 * size, 0x00);
	let at = 0;
	for (let index = 0; index < size; index += 1) {
		const fourth = channels[3]?.[index] ?? 0;
		const red = ((channels[2]?.[index] ?? 0) ^ fourth) & 0xff;
		const green = ((channels[1]?.[index] ?? 0) ^ red) & 0xff;
		const blue = ((channels[0]?.[index] ?? 0) ^ green) & 0xff;
		output[at] = blue;
		output[at + 1] = green;
		output[at + 2] = red;
		output[at + 3] = fourth;
		at += 4;
	}
	return output;
}

/** What a walk of this engine hands back: the picture's bytes, and how wide a row of them is. */
interface Pb2Picture {
	pixels: Buffer;
	stride: number;
}

/** `Pb2Reader.Unpack`: which way the picture's bytes are packed. */
export function unpackPb2Picture(data: Buffer, layout: Pb2Layout): Pb2Picture {
	if (TYPE_BLOCKS === layout.type) {
		return { pixels: unpackPb2V1(data, layout), stride: layout.stride };
	}
	if (TYPE_BLOCK_MAP === layout.type) {
		return { pixels: unpackPb2V2(data, layout), stride: layout.stride };
	}
	if (TYPE_JBP === layout.type) {
		// The walk of the JBP way is the one the ported PB3 pictures already carry.
		const jbp = pb3UnpackJbp(
			data,
			{
				inputSize: layout.inputSize,
				kind: layout.type,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				subKind: 0,
			},
			JBP_OFFSET,
			layout.offset1,
		);
		return { pixels: jbp.pixels, stride: jbp.stride };
	}
	if (TYPE_CHANNELS === layout.type) {
		return { pixels: unpackPb2V6(data, layout), stride: layout.width * 4 };
	}
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`The CVNS engine's picture of type ${layout.type} is not ported`,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cmvsPb2ImageDescriptor: FormatDescriptor = {
	id: "cmvs-pb2-image",
	name: "CVNS engine image",
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
			source: "ArcFormats/Cmvs/ImagePB2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cmvsPb2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cmvsPb2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readPb2Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPb2Layout(stored);
		if (!layout) throw invalid("Not a CVNS engine picture");
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
			// The picture is reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				pictureType: layout.type,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readPb2Layout(stored);
		if (!layout) throw invalid("Not a CVNS engine picture");
		const picture = unpackPb2Picture(stored, layout);
		// The rows are kept from the top down, as the reference's own `Create` takes them.
		return Readable.from([
			32 === layout.bitsPerPixel ||
			TYPE_JBP === layout.type ||
			TYPE_CHANNELS === layout.type
				? writeBmp32(layout.width, layout.height, picture.pixels, false)
				: writeBmp24(layout.width, layout.height, picture.pixels, false),
		]);
	},
});
