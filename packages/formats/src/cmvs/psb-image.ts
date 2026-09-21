// Format reference: GARBro "ArcFormats/Cmvs/ImagePSB.cs", classes `PsbFormat` and the `PsbReader` behind it.
// The walk it unpacks with is the `PsbReader.LzssUnpack` of that file, which differs from the PB3 pictures'
// own walk in both the shape of a pair of bytes and the size of the frame it reads back from. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The engine's own word, which is the only part of the head its own bytes hold. */
const SIGNATURE = Buffer.from("PSBP", "latin1");
/** The head, and the tail of the file the fields behind it are keyed with. */
const HEADER_SIZE = 0x14;
const TAIL_SIZE = 0x13;
const HEADER_FIELD_START = 4;
const METHOD_FIELD = 0x0c;
const WIDTH_FIELD = 0x0e;
const HEIGHT_FIELD = 0x10;
const DEPTH_FIELD = 0x12;
const TABLE_OFFSET_FIELD = 4;
const DATA_OFFSET_FIELD = 8;
/** The depth a picture of this engine is stored in, in bytes a pixel. */
const DEPTHS: Record<number, number> = { 24: 3, 32: 4 };
/** The frame the walk of this engine reads back from, and where it begins writing into it. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_START = 0xfee;
/** Bits of a pair of bytes that name the run of a copy; the rest name the place it comes from. */
const COPY_COUNT_BITS = 4;
const COPY_MINIMUM = 3;
/** The block a picture of the later method is cut into. */
const BLOCK_SIZE = 8;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface PsbLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Which way the picture's bytes are packed, two and three being the ones this port reads. */
	method: number;
	tableOffset: number;
	dataOffset: number;
	/** The bytes a pixel takes. */
	channels: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PsbFormat.ReadMetaData`: the head holds only the engine's word as it stands. Every field behind it is
 * keyed with the file's own last nineteen bytes - first exclusive-or, then subtract - so a picture cannot be
 * read from its head alone.
 */
export function readPsbLayout(data: Buffer): PsbLayout | undefined {
	if (data.length < HEADER_SIZE || data.length < TAIL_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const header = Buffer.from(data.subarray(0, HEADER_SIZE));
	const tail = data.subarray(data.length - TAIL_SIZE);
	for (let at = HEADER_FIELD_START; at < HEADER_SIZE; at += 1) {
		const keyed = (header[at] ?? 0) ^ (tail[TAIL_SIZE - 3 + (at & 1)] ?? 0);
		header[at] = (keyed - (tail[at - HEADER_FIELD_START] ?? 0)) & 0xff;
	}
	const method = header.readUInt16LE(METHOD_FIELD);
	const width = header.readUInt16LE(WIDTH_FIELD);
	const height = header.readUInt16LE(HEIGHT_FIELD);
	const bitsPerPixel = header.readUInt16LE(DEPTH_FIELD);
	const channels = DEPTHS[bitsPerPixel];
	if (0 === width || 0 === height || undefined === channels) return undefined;
	const total = width * height * channels;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		method,
		tableOffset: header.readInt32LE(TABLE_OFFSET_FIELD),
		dataOffset: header.readInt32LE(DATA_OFFSET_FIELD),
		channels,
	};
}

/**
 * `PsbReader.LzssUnpack`: a control byte read from its highest bit down, where a set bit stands for a copy
 * and a clear one for a byte that stands as it is. A copy is a pair of bytes whose lower four bits name how
 * long the run is and whose rest names a place in a frame of four thousand and ninety six bytes, which is
 * read back from and written to as the picture is walked; the frame begins as nothing and its cursor starts
 * near its end.
 */
export function unpackPsbWalk(
	data: Buffer,
	bitSrc: number,
	dataSrc: number,
	output: Uint8Array,
	outputSize: number,
	frame: Uint8Array,
): void {
	let bitMask = 0x80;
	let frameOffset = FRAME_START;
	let source = dataSrc;
	let destination = 0;
	while (destination < outputSize) {
		if (0 === bitMask) {
			bitMask = 0x80;
			bitSrc += 1;
		}
		if (0 !== (bitMask & (data[bitSrc] ?? 0))) {
			const value = data.readUInt16LE(source);
			source += 2;
			const count = (value & ((1 << COPY_COUNT_BITS) - 1)) + COPY_MINIMUM;
			const offset = value >> COPY_COUNT_BITS;
			for (let at = 0; at < count; at += 1) {
				const place = frame[(at + offset) & FRAME_MASK] ?? 0;
				if (destination < output.length) output[destination] = place;
				destination += 1;
				frame[frameOffset] = place;
				frameOffset = (frameOffset + 1) & FRAME_MASK;
			}
		} else {
			const place = data[source] ?? 0;
			source += 1;
			if (destination < output.length) output[destination] = place;
			destination += 1;
			frame[frameOffset] = place;
			frameOffset = (frameOffset + 1) & FRAME_MASK;
		}
		bitMask >>= 1;
	}
}

/**
 * A table of channels, read the way the reference reads one: the sizes stand in a row, and the bodies they
 * measure stand behind them, one after another. The place the last body ends is what a table that follows
 * one of these begins at.
 */
interface PsbTable {
	bodies: number[];
	/** Where the last of the bodies ends. */
	end: number;
}

function readTable(
	data: Buffer,
	sizesAt: number,
	bodiesAt: number,
	channels: number,
): PsbTable | undefined {
	const bodies: number[] = [];
	let offset = bodiesAt;
	for (let channel = 0; channel < channels; channel += 1) {
		const at = sizesAt + 4 * channel;
		if (at + 4 > data.length) return undefined;
		bodies.push(offset);
		offset += data.readInt32LE(at);
	}
	return { bodies, end: offset };
}

/**
 * `PsbReader.UnpackV2`: each channel is a plane of differences, packed away, which is added up a byte at a
 * time and written into the picture with nothing between its own channel's bytes. The sizes of the packed
 * planes stand in front of them, and the sizes of the places they are read from stand between the two.
 */
export function unpackPsbV2(data: Buffer, layout: PsbLayout): Buffer {
	const planeSize = layout.width * layout.height;
	const output: Buffer = Buffer.alloc(planeSize * layout.channels, 0x00);
	const packed = readTable(
		data,
		layout.tableOffset,
		layout.tableOffset + 4 * layout.channels,
		layout.channels,
	);
	if (!packed) throw invalid("The picture's first table reaches past the file");
	// The places the planes are read from stand in a table of their own, whose sizes begin where the packed
	// planes end and whose bodies begin behind those sizes.
	const planes = readTable(
		data,
		packed.end,
		packed.end + 4 * layout.channels,
		layout.channels,
	);
	if (!planes)
		throw invalid("The picture's second table reaches past the file");
	for (let channel = 0; channel < layout.channels; channel += 1) {
		const plane: Uint8Array = new Uint8Array(planeSize);
		unpackPsbWalk(
			data,
			packed.bodies[channel] ?? 0,
			planes.bodies[channel] ?? 0,
			plane,
			planeSize,
			new Uint8Array(FRAME_SIZE),
		);
		let destination = channel;
		let value = 0;
		for (let at = 0; at < planeSize; at += 1) {
			value = (value + (plane[at] ?? 0)) & 0xff;
			output[destination] = value;
			destination += layout.channels;
		}
	}
	return output;
}

/**
 * `PsbReader.UnpackV3`: the picture is cut into blocks of eight by eight, and each channel keeps a byte of
 * flags for them, a plane of the bytes the blocks hold, and a block of bytes to fill a whole block with. A
 * set bit fills its block with the next byte of that block; a clear one takes the next byte of the plane.
 */
export function unpackPsbV3(data: Buffer, layout: PsbLayout): Buffer {
	const stride = layout.width * layout.channels;
	const planeSize = layout.width * layout.height;
	const output: Buffer = Buffer.alloc(planeSize * layout.channels, 0x00);
	let blocksAcross = layout.width >> 3;
	let blocksDown = layout.height >> 3;
	if (0 !== (layout.width & 7)) blocksAcross += 1;
	if (0 !== (layout.height & 7)) blocksDown += 1;
	const bits = readTable(
		data,
		layout.tableOffset,
		layout.tableOffset + 4 * layout.channels,
		layout.channels,
	);
	if (!bits) throw invalid("The picture's first table reaches past the file");
	const bodies = readTable(
		data,
		layout.dataOffset,
		layout.dataOffset + 4 * layout.channels,
		layout.channels,
	);
	if (!bodies)
		throw invalid("The picture's second table reaches past the file");
	for (let channel = 0; channel < layout.channels; channel += 1) {
		const record = bits.bodies[channel] ?? 0;
		if (record + 12 > data.length) {
			throw invalid("The picture's block record reaches past the file");
		}
		const flagsLength = data.readInt32LE(record);
		const fillLength = data.readInt32LE(record + 4);
		const size = data.readInt32LE(record + 8);
		const flagsAt = record + 12;
		const fillAt = flagsAt + flagsLength;
		const packedAt = fillAt + fillLength;
		if (size < 0 || size > planeSize) {
			throw invalid("The picture's blocks are larger than its picture");
		}
		const plane: Uint8Array = new Uint8Array(size);
		unpackPsbWalk(
			data,
			packedAt,
			bodies.bodies[channel] ?? 0,
			plane,
			size,
			new Uint8Array(FRAME_SIZE),
		);
		let planeAt = 0;
		let fillSource = fillAt;
		let bitMask = 0x80;
		let flagAt = flagsAt;
		let rowOrigin = channel;
		let destination = channel;
		for (let down = 0; down < blocksDown; down += 1) {
			const blockHeight = Math.min(
				BLOCK_SIZE,
				layout.height - down * BLOCK_SIZE,
			);
			rowOrigin = destination;
			for (let across = 0; across < blocksAcross; across += 1) {
				const blockWidth = Math.min(
					BLOCK_SIZE,
					layout.width - across * BLOCK_SIZE,
				);
				if (0 === bitMask) {
					flagAt += 1;
					bitMask = 0x80;
				}
				const filled = 0 !== (bitMask & (data[flagAt] ?? 0));
				const value = filled ? (data[fillSource++] ?? 0) : 0;
				for (let y = 0; y < blockHeight; y += 1) {
					let at = destination + stride * y;
					for (let x = 0; x < blockWidth; x += 1) {
						output[at] = filled ? value : (plane[planeAt++] ?? 0);
						at += layout.channels;
					}
				}
				bitMask >>= 1;
				destination += BLOCK_SIZE * layout.channels;
			}
			destination = rowOrigin + BLOCK_SIZE * stride;
		}
	}
	return output;
}

/** `PsbReader.Unpack`: which way the picture's bytes are packed. */
export function unpackPsbPicture(data: Buffer, layout: PsbLayout): Buffer {
	if (2 === layout.method) return unpackPsbV2(data, layout);
	if (3 === layout.method) return unpackPsbV3(data, layout);
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`The PVNS engine's picture method ${layout.method} is not ported`,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cmvsPsbImageDescriptor: FormatDescriptor = {
	id: "cmvs-psb-image",
	name: "PVNS engine image",
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
			source: "ArcFormats/Cmvs/ImagePSB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cmvsPsbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cmvsPsbImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readPsbLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPsbLayout(stored);
		if (!layout) throw invalid("Not a PVNS engine picture");
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
				method: layout.method,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readPsbLayout(stored);
		if (!layout) throw invalid("Not a PVNS engine picture");
		const pixels = unpackPsbPicture(stored, layout);
		// The rows are kept from the top down, as the reference's own `Create` takes them.
		return Readable.from([
			3 === layout.channels
				? writeBmp24(layout.width, layout.height, pixels, false)
				: writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
