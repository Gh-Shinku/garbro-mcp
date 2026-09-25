// Format reference: GARBro "ArcFormats/Strikes/ImageLAG.cs", class `LagFormat` with the `LagReader` beside
// it. The LZSS the scanlines of a picture are packed with stands in "ArcFormats/Strikes/ArcPCK.cs" as
// `PckOpener.LzssUnpack` - the walk of the archive of the same engine, which is ported beside this picture as
// `strikes-pck` - and it is transcribed here because the reference reaches for it from both. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The four bytes every picture of this engine opens with. */
const SIGNATURE = Buffer.from([0x01, 0x10, 0x4c, 0x41]);
const HEAD_SIZE = 0x20;
/** The head stands the other way round: every word of it is read most significant byte first. */
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const SCANLINE_FIELD = 8;
const FLAGS_FIELD = 0x0a;
const LAST_CHUNK_FIELD = 0x14;
const CHUNK_COUNT_FIELD = 0x18;
/** What the flags of a picture name. */
const DEPTH_MASK = 0x1f;
const ALPHA_FLAG = 0x20;
const PALETTE_FLAG = 0x80;
/** The three depths the reference detects, only one of which it draws. */
const BITS_8 = 8;
const BITS_16 = 16;
const BITS_24 = 24;
/** The colour map a picture may carry, three bytes to a colour; only eight bit pictures draw through it. */
const PALETTE_BYTES = 0x100 * 3;
/** The chunks a picture stands in, and the most one of them unfolds to. */
const CHUNK_SIZE = 0x10000;
/** What the flags of a scanline name: the three ways it is packed, one behind the other. */
const SCANLINE_LZSS = 4;
const SCANLINE_RLE = 2;
const SCANLINE_DELTA = 1;
/** The frame the packed scanlines copy out of, and the two runs of the packed rows. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_START = 0xfee;
const RUN_BIAS = 3;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface LagLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	scanLineSize: number;
	hasAlpha: boolean;
	hasPalette: boolean;
	lastChunkSize: number;
	chunkCount: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `LagFormat.ReadMetaData`: the head stands most significant byte first, and its flags name the depth in
 * their lowest five bits with a palette and an alpha channel above them. The reference detects three depths
 * and draws one of them.
 */
export function readLagLayout(data: Buffer): LagLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const flags = data[FLAGS_FIELD] ?? 0;
	const bitsPerPixel = flags & DEPTH_MASK;
	if (
		bitsPerPixel !== BITS_8 &&
		bitsPerPixel !== BITS_16 &&
		bitsPerPixel !== BITS_24
	) {
		return undefined;
	}
	const width = data.readUInt16BE(WIDTH_FIELD);
	const height = data.readUInt16BE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		scanLineSize: data.readUInt16BE(SCANLINE_FIELD),
		hasAlpha: 0 !== (flags & ALPHA_FLAG),
		hasPalette: 0 !== (flags & PALETTE_FLAG),
		lastChunkSize: data.readInt32BE(LAST_CHUNK_FIELD),
		chunkCount: data.readUInt16BE(CHUNK_COUNT_FIELD),
	};
}

/**
 * `LagReader.ReadChunks`: the picture stands in chunks behind its colour map, every chunk naming its length
 * most significant byte first with the highest bit telling whether it is a stream of its own - a length that
 * is **not** a stream is a length read backwards into the file. A stream of a picture is cut into pieces of
 * sixty four kilobytes, and the last chunk of a picture is held to the size the head names for it.
 */
export async function readLagChunks(
	data: Buffer,
	offset: number,
	layout: LagLayout,
): Promise<Buffer> {
	const size = CHUNK_SIZE * layout.chunkCount + layout.lastChunkSize;
	const buffer = Buffer.alloc(Math.max(size, 0), 0x00);
	let at = offset;
	let destination = 0;
	for (let chunk = 0; chunk <= layout.chunkCount; chunk += 1) {
		if (at + 4 > data.length) {
			throw invalidImage("The picture ends inside the head of a chunk");
		}
		let length = data.readInt32BE(at);
		at += 4;
		const streamed = length < 0;
		// The highest bit says the chunk is a stream of its own, and the rest of the word is its length,
		// which the reference reaches by clearing that bit - a word read the other way round.
		length = streamed ? -length : length;
		if (streamed) {
			const room = Math.min(CHUNK_SIZE, buffer.length - destination);
			if (room <= 0) break;
			if (at + length > data.length) {
				throw invalidImage("A stream of the picture reaches past it");
			}
			const unpacked = await inflateZlibBuffer(data.subarray(at, at + length));
			const taken = Math.min(room, unpacked.length);
			unpacked.copy(buffer, destination, 0, taken);
			destination += taken;
			at += length;
		} else {
			if (at + length > data.length) {
				throw invalidImage("A chunk of the picture reaches past it");
			}
			const taken = Math.min(length, buffer.length - destination);
			data.copy(buffer, destination, at, at + taken);
			destination += taken;
			at += length;
		}
	}
	return buffer;
}

/**
 * `PckOpener.LzssUnpack`: a frame of four kilobytes whose writing place starts near its end, a control byte
 * naming eight decisions from its **lowest** bit up - a set bit a byte of its own, a clear one a copy out of
 * the frame, whose place and length share two bytes with the length counted from three.
 */
export function unpackLagLzss(
	data: Buffer,
	size: number,
	output: Buffer,
): number {
	const frame = Buffer.alloc(FRAME_SIZE, 0x00);
	let framePos = FRAME_START;
	let at = 0;
	let destination = 0;
	const limit = Math.min(size, data.length);
	while (at < limit) {
		const control = data[at] ?? 0;
		at += 1;
		for (let bit = 1; 0x100 !== bit; bit <<= 1) {
			if (0 !== (control & bit)) {
				if (at >= limit) return destination;
				const value = data[at] ?? 0;
				at += 1;
				frame[framePos] = value;
				framePos = (framePos + 1) & FRAME_MASK;
				if (destination < output.length) output[destination] = value;
				destination += 1;
			} else {
				if (at + 2 > limit) return destination;
				const low = data[at] ?? 0;
				const high = data[at + 1] ?? 0;
				at += 2;
				let place = ((high & 0xf0) << 4) | low;
				let count = Math.max(
					0,
					Math.min(RUN_BIAS + (high & 0x0f), output.length - destination),
				);
				while (count > 0) {
					const value = frame[place & FRAME_MASK] ?? 0;
					place += 1;
					frame[framePos] = value;
					framePos = (framePos + 1) & FRAME_MASK;
					output[destination] = value;
					destination += 1;
					count -= 1;
				}
			}
		}
	}
	return destination;
}

/**
 * `LagReader.RleUnpack`: a run of the picture is named by a byte whose top two bits say how its values are
 * packed - four of two bits to a byte, two of four, values of six bits spread across the bytes, or the bytes
 * themselves - and whose low six bits are the count, smaller by one.
 */
export function unpackLagRle(
	data: Buffer,
	size: number,
	output: Buffer,
): number {
	const limit = Math.min(size, data.length);
	let at = 0;
	let destination = 0;
	while (at < limit && destination < output.length) {
		const code = data[at] ?? 0;
		at += 1;
		if (at >= limit) break;
		const count = (code & 0x3f) + 1;
		if (destination + count > output.length) break;
		const way = (code & 0xc0) >> 6;
		if (0 === way) {
			let index = 0;
			for (; index < count; index += 1) {
				const part = index & 3;
				let value: number;
				if (0 === part) value = ((data[at] ?? 0) & 0xc0) >> 6;
				else if (1 === part) value = ((data[at] ?? 0) & 0x30) >> 4;
				else if (2 === part) value = ((data[at] ?? 0) & 0x0c) >> 2;
				else {
					value = (data[at] ?? 0) & 3;
					at += 1;
				}
				if (0 !== (value & 2)) value |= 0xfc;
				output[destination] = value;
				destination += 1;
			}
			if (0 !== (index & 3)) at += 1;
		} else if (1 === way) {
			let index = 0;
			for (; index < count; index += 1) {
				let value: number;
				if (0 !== (index & 1)) {
					value = (data[at] ?? 0) & 0x0f;
					at += 1;
				} else {
					value = ((data[at] ?? 0) & 0xf0) >> 4;
				}
				if (0 !== (value & 8)) value |= 0xf0;
				output[destination] = value;
				destination += 1;
			}
			if (0 !== (index & 1)) at += 1;
		} else if (2 === way) {
			let index = 0;
			for (; index < count; index += 1) {
				const part = index & 3;
				let value: number;
				if (0 === part) {
					value = ((data[at] ?? 0) & 0xfc) >> 2;
				} else if (1 === part) {
					const first = data[at] ?? 0;
					at += 1;
					value = (((data[at] ?? 0) & 0xf0) >> 4) | ((first & 3) << 4);
				} else if (2 === part) {
					const first = data[at] ?? 0;
					at += 1;
					value = (((data[at] ?? 0) & 0xc0) >> 6) | ((first & 0x0f) << 2);
				} else {
					value = (data[at] ?? 0) & 0x3f;
					at += 1;
				}
				if (0 !== (value & 0x20)) value |= 0xc0;
				output[destination] = value;
				destination += 1;
			}
			if (0 !== (index & 3)) at += 1;
		} else {
			const available = Math.min(count, limit - at);
			data.copy(output, destination, at, at + available);
			at += available;
			destination += available;
		}
	}
	return destination;
}

/**
 * `LagReader.Unpack`: every scanline of the picture names how long it is and how it is packed, and the three
 * ways stand one behind the other - a frame of its own, then a run of its own, then the sum of its own bytes,
 * which is read back as the difference every byte stands for. The planes of a scanline stand one behind the
 * other in the row itself: its red first, then its green, its blue and, when the picture has one, its alpha.
 */
export async function unpackLag(
	data: Buffer,
	layout: LagLayout,
): Promise<Buffer> {
	if (BITS_24 !== layout.bitsPerPixel) {
		throw unsupported(
			`LAG pictures of ${layout.bitsPerPixel} bits, which the reference detects and does not draw`,
		);
	}
	let at = HEAD_SIZE;
	if (layout.hasPalette) {
		if (at + PALETTE_BYTES > data.length) {
			throw invalidImage("The picture ends inside its colour map");
		}
		at += PALETTE_BYTES;
	}
	const chunks = await readLagChunks(data, at, layout);
	const pixelSize = layout.hasAlpha ? 4 : 3;
	const output = Buffer.alloc(layout.width * layout.height * pixelSize, 0x00);
	const rowSize = layout.scanLineSize * 2;
	let scanline = Buffer.alloc(rowSize, 0x00);
	let unpacked = Buffer.alloc(rowSize, 0x00);
	let chunkAt = 0;
	let destination = 0;
	for (let row = 0; row < layout.height; row += 1) {
		if (chunkAt + 4 > chunks.length) break;
		// The head of a scanline stands most significant byte first, three bytes of a length whose lowest
		// places are not written at all.
		// The reference reads three bytes of a length and then steps it up by a byte, so a stored scanline
		// is counted in whole units of two hundred and fifty six bytes.
		const packedSize =
			(((chunks[chunkAt] ?? 0) << 16) |
				((chunks[chunkAt + 1] ?? 0) << 8) |
				(chunks[chunkAt + 2] ?? 0)) <<
			8;
		chunkAt += 3;
		const flags = chunks[chunkAt] ?? 0;
		chunkAt += 1;
		if (packedSize > rowSize) break;
		chunks.copy(scanline, 0, chunkAt, chunkAt + packedSize);
		chunkAt += packedSize;
		let size = packedSize;
		if (0 !== (flags & SCANLINE_LZSS)) {
			size = unpackLagLzss(scanline, size, unpacked);
			const swap = scanline;
			scanline = unpacked;
			unpacked = swap;
		}
		if (0 !== (flags & SCANLINE_RLE)) {
			size = unpackLagRle(scanline, size, unpacked);
			const swap = scanline;
			scanline = unpacked;
			unpacked = swap;
		}
		if (0 !== (flags & SCANLINE_DELTA)) {
			for (let column = 1; column < size; column += 1) {
				scanline[column] =
					(scanline[column] ?? 0) + (scanline[column - 1] ?? 0);
			}
		}
		// The planes of the row: red at its front, then the green, the blue and the alpha.
		let red = 0;
		let green = layout.width;
		let blue = layout.width * 2;
		let alpha = layout.width * 3;
		for (let column = 0; column < layout.width; column += 1) {
			output[destination] = scanline[blue] ?? 0;
			output[destination + 1] = scanline[green] ?? 0;
			output[destination + 2] = scanline[red] ?? 0;
			if (layout.hasAlpha) output[destination + 3] = scanline[alpha] ?? 0;
			destination += pixelSize;
			red += 1;
			green += 1;
			blue += 1;
			alpha += 1;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const lagImageDescriptor: FormatDescriptor = {
	id: "strikes-lag-image",
	name: "Strikes image",
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
			source: "ArcFormats/Strikes/ImageLAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lagImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lagImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readLagLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLagLayout(await readStored(source));
		if (!layout) throw invalidImage("Not a Strikes picture");
		const drawn =
			24 === layout.bitsPerPixel
				? layout.hasAlpha
					? 32
					: 24
				: layout.bitsPerPixel;
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
					bitsPerPixel: drawn,
				},
			}),
			// The scanlines are drawn out and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: drawn,
				hasPalette: layout.hasPalette,
				chunks: layout.chunkCount + 1,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readLagLayout(stored);
		if (!layout) throw invalidImage("Not a Strikes picture");
		const pixels = await unpackLag(stored, layout);
		if (layout.hasAlpha) {
			return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
