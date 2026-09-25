// Port of GARbro "ArcFormats/elf/ImageGCC.cs" (tag "GCC", class GccFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. Four walks of a picture of twenty four places to
// a place of the engine of AI5WIN: the places of the colours of it stand of a walk of the words of the LZSS
// engine or of a walk of its own, and the alpha of it of a walk of the counts of them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 12;
/** The places of the head of a picture of a mask, of which the walks of the colours and the alpha stand. */
const MASKED_OFFSET = 0x20;
const PLAIN_OFFSET = 0x14;
/** The counts of the places of the file of a colour of the picture. */
const COLOR_PLACES = 3;

export const GCC_SIGNATURES: ReadonlyMap<
	number,
	{ masked: boolean; alt: boolean }
> = new Map([
	[0x6e343247, { masked: false, alt: false }], // 'G24n'
	[0x6d343247, { masked: true, alt: false }], // 'G24m'
	[0x6e343252, { masked: false, alt: true }], // 'R24n'
	[0x6d343252, { masked: true, alt: true }], // 'R24m'
]);

export interface GccLayout {
	signature: number;
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	masked: boolean;
	alt: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GccFormat.ReadMetaData`. */
export function readGccLayout(data: Buffer): GccLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const signature = data.readUInt32LE(0);
	const walk = GCC_SIGNATURES.get(signature);
	if (!walk) return undefined;
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(10);
	if (0 === width || 0 === height) return undefined;
	return {
		signature,
		offsetX: data.readInt16LE(4),
		offsetY: data.readInt16LE(6),
		width,
		height,
		masked: walk.masked,
		alt: walk.alt,
	};
}

/** `GccFormat.Reader.FlipPixels`: the walks of the picture stand of the row of the file the last first. */
function flipRows(pixels: Buffer, stride: number, height: number): Buffer {
	const flipped: Buffer = Buffer.alloc(pixels.length, 0x00);
	let destination = 0;
	for (let source = stride * (height - 1); source >= 0; source -= stride) {
		pixels.copy(flipped, destination, source, source + stride);
		destination += stride;
	}
	return flipped;
}

/** `GccFormat.Reader`: the walk of the bits of the alpha of a picture, of the places of the file of it. */
class GccReader {
	private index: number;
	private current = 0;
	private mask = 0x80;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.index = at;
	}

	/** `GccFormat.Reader.NextBit`: the places of a walk of a picture, of the lowest place of a place first. */
	nextBit(): boolean {
		this.mask <<= 1;
		if (0x100 === this.mask) {
			if (this.index >= this.data.length) {
				throw invalidPicture("The places of the walk stand short of the file");
			}
			this.current = this.data[this.index] ?? 0;
			this.index += 1;
			this.mask = 1;
		}
		return 0 !== (this.current & this.mask);
	}

	/** `GccFormat.Reader.ReadCount`: a count of the places of the walk, of the places of the file of it. */
	readCount(): number {
		let result = 1;
		let bits = 0;
		while (!this.nextBit()) bits += 1;
		while (0 !== bits) {
			bits -= 1;
			result <<= 1;
			if (this.nextBit()) result |= 1;
		}
		return result;
	}

	/** `GccFormat.Reader.UnpackAlpha`: the places of the alpha of a picture, of the counts of them. */
	unpackAlpha(width: number, height: number, at: number): Buffer {
		const total = width * height;
		const alpha: Buffer = Buffer.alloc(total, 0x00);
		let source = at;
		let destination = 0;
		while (destination < total) {
			if (this.nextBit()) {
				const count = this.readCount();
				const value = this.byteAt(source);
				source += 1;
				for (let place = 0; place < count && destination < total; place += 1) {
					alpha[destination] = value;
					destination += 1;
				}
			} else {
				alpha[destination] = this.byteAt(source);
				destination += 1;
				source += 1;
			}
		}
		return alpha;
	}

	private byteAt(at: number): number {
		if (at >= this.data.length) {
			throw invalidPicture("The places of the alpha stand short of the file");
		}
		return this.data[at] ?? 0;
	}
}

/** `GccFormat.Reader.Convert24To32`: the places of the colours of a picture, of the alpha of it. */
function convertToBgra(
	pixels: Buffer,
	alpha: Buffer,
	layout: GccLayout,
	alphaWidth: number,
	alphaHeight: number,
): Buffer {
	const converted: Buffer = Buffer.alloc(
		layout.width * layout.height * 4,
		0x00,
	);
	let destination = 0;
	let alphaRow = alphaWidth * (alphaHeight - layout.offsetY - 1);
	for (
		let row = layout.width * (layout.height - 1);
		row >= 0;
		row -= layout.width
	) {
		let source = row * COLOR_PLACES;
		for (let x = 0; x < layout.width; x += 1) {
			const place = alphaRow + layout.offsetX + x;
			if (place < 0 || place >= alpha.length) {
				throw invalidPicture(
					"The alpha of the picture stands beyond the places of it",
				);
			}
			converted[destination] = pixels[source] ?? 0;
			converted[destination + 1] = pixels[source + 1] ?? 0;
			converted[destination + 2] = pixels[source + 2] ?? 0;
			converted[destination + 3] = alpha[place] ?? 0;
			destination += 4;
			source += COLOR_PLACES;
		}
		alphaRow -= alphaWidth;
	}
	return converted;
}

/** The places of the file of a chunk of the walk of the places of a picture. */
const CHUNK_LIMIT = 0xffff;
const MTF_SIZE = 16;
/** The number the walk of the reference names a value standing in none of its lists of sixteen. */
const NO_RANK = 0xff;

/** The places of a picture a chunk of it hands over, and the place of them the walk stands at. */
interface ChunkWalk {
	readonly output: Buffer;
	dst: number;
}

function readAt(data: Buffer, at: number): number {
	if (at < 0 || at >= data.length) {
		throw invalidPicture("The places of the walk stand short of the file");
	}
	return data[at] ?? 0;
}

/** The place of a value in one of the lists of sixteen of the walk, or `0xff` where it stands in none. */
function rankOf(list: Uint8Array, value: number): number {
	for (let at = 0; at < MTF_SIZE; at += 1) {
		if (list[at] === value) return at;
	}
	return NO_RANK;
}

/** The value of one of the lists of sixteen stands at the front of it, the ones before it behind it. */
function moveToFront(list: Uint8Array, rank: number, value: number): void {
	for (let at = rank & 0xf; at > 0; at -= 1) list[at] = list[at - 1] ?? 0;
	list[0] = value;
}

/**
 * `GccFormat.Reader.ReadRawChunk`: the places of a chunk of a picture standing in the file itself, one
 * place of a pixel at a time, or as a run of the places of one.
 */
function readRawChunk(
	data: Buffer,
	reader: GccReader,
	source: number,
	walk: ChunkWalk,
	chunkSize: number,
): number {
	let at = source;
	let done = 0;
	while (done < chunkSize) {
		if (!reader.nextBit()) {
			for (let place = 0; place < COLOR_PLACES; place += 1) {
				if (walk.dst >= walk.output.length) {
					throw invalidPicture(
						"The places of the walk stand past the places of the picture",
					);
				}
				walk.output[walk.dst] = readAt(data, at);
				walk.dst += 1;
				at += 1;
			}
			done += COLOR_PLACES;
		} else {
			const count = reader.readCount();
			const blue = readAt(data, at);
			const green = readAt(data, at + 1);
			const red = readAt(data, at + 2);
			at += COLOR_PLACES;
			for (let place = 0; place < count; place += 1) {
				if (walk.dst + COLOR_PLACES > walk.output.length) {
					throw invalidPicture(
						"The run of the walk stands past the places of the picture",
					);
				}
				walk.output[walk.dst] = blue;
				walk.output[walk.dst + 1] = green;
				walk.output[walk.dst + 2] = red;
				walk.dst += COLOR_PLACES;
			}
			done += COLOR_PLACES * count;
		}
	}
	return at;
}

/**
 * `GccFormat.Reader.ReadCompressedChunk`: the places of a chunk of a picture standing of two runs of
 * sixteen values, of which the one at the front of a run stands first, and of the runs of the values
 * themselves.
 */
function readCompressedChunk(
	data: Buffer,
	reader: GccReader,
	source: number,
	chunk: Buffer,
	chunkSize: number,
): number {
	const first = new Uint8Array(MTF_SIZE);
	const second = new Uint8Array(MTF_SIZE);
	for (let at = 0; at < MTF_SIZE; at += 1) {
		first[at] = at;
		second[at] = at;
	}
	let at = source;
	let written = 0;
	// The place of the byte behind the one the walk last read, held as a place of eight bits: the
	// reference holds it as a place of eight bits whose top one is its sign, and takes the runs off it as
	// the places of eight bits they stand of.
	let previous = 0xff;
	while (written < chunkSize) {
		let rank: number;
		let value: number;
		// The first place of the walk names either a place of a run of sixteen values or a place of the
		// file itself.
		const fromTable = reader.nextBit();
		if (!fromTable) {
			const fromSecond = reader.nextBit();
			if (fromSecond) {
				rank = reader.readCount();
				if (rank >= MTF_SIZE) {
					throw invalidPicture(
						"The walk of the chunk names no place of its run of sixteen",
					);
				}
				value = second[rank] ?? 0;
			} else {
				const fromRun = reader.nextBit();
				if (fromRun) {
					const delta = reader.readCount();
					const behind = reader.nextBit();
					value = behind
						? (previous - delta) & 0xff
						: (previous + delta) & 0xff;
				} else {
					value = readAt(data, at);
					at += 1;
				}
				chunk[written] = value;
				written += 1;
				rank = rankOf(second, value);
			}
			if (fromSecond) {
				chunk[written] = value;
				written += 1;
			}
		} else {
			const count = reader.readCount();
			const ofTheRun = reader.nextBit();
			// A place of the run of sixteen the value stands in standing first names the value itself;
			// behind it stands the place of the run the value stands in.
			const fromRun = ofTheRun ? false : reader.nextBit();
			if (ofTheRun) {
				rank = 0;
				value = first[0] ?? 0;
			} else if (fromRun) {
				rank = reader.readCount();
				if (rank >= MTF_SIZE) {
					throw invalidPicture(
						"The walk of the chunk names no place of its run of sixteen",
					);
				}
				value = first[rank] ?? 0;
			} else {
				const fromDelta = reader.nextBit();
				if (fromDelta) {
					const delta = reader.readCount();
					const behind = reader.nextBit();
					value = behind
						? (previous - delta) & 0xff
						: (previous + delta) & 0xff;
				} else {
					value = readAt(data, at);
					at += 1;
				}
				rank = rankOf(first, value);
			}
			if (0 !== rank) moveToFront(first, rank, value);
			for (let place = 0; place < count; place += 1) {
				if (written >= chunk.length) {
					throw invalidPicture(
						"The run of the walk stands past the places of the chunk",
					);
				}
				chunk[written] = value;
				written += 1;
			}
			rank = rankOf(second, value);
		}
		if (0 !== rank) moveToFront(second, rank, value);
		previous = value;
	}
	return at;
}

/**
 * `GccFormat.Reader.DecodeChunk`: the places of a chunk of a picture, read of the places of the chunk
 * itself: every place of it stands behind the place taking the byte before it, and the place the chunk
 * opens with names the place of the byte the walk stands at.
 */
function decodeChunk(chunk: Buffer, chunkSize: number): Buffer {
	const counts = new Uint16Array(0x100);
	for (let at = 0; at < chunkSize; at += 1) {
		const value = chunk[2 + at] ?? 0;
		counts[value] = ((counts[value] ?? 0) + 1) & 0xffff;
	}
	const base = new Uint16Array(0x100);
	let total = 0;
	for (let at = 0; at < 0x100; at += 1) {
		base[at] = total;
		total = (total + (counts[at] ?? 0)) & 0xffff;
		counts[at] = 0;
	}
	const next = new Uint16Array(0x10000);
	for (let at = 0; at < chunkSize; at += 1) {
		const value = chunk[2 + at] ?? 0;
		const rank = ((counts[value] ?? 0) + (base[value] ?? 0)) & 0xffff;
		if (rank >= next.length) {
			throw invalidPicture(
				"The walk of the chunk stands past the places of it",
			);
		}
		next[rank] = at;
		counts[value] = ((counts[value] ?? 0) + 1) & 0xffff;
	}
	const places: Buffer = Buffer.alloc(chunkSize, 0x00);
	// The place the chunk opens with names a place of the table of the walk of it, not a place of the
	// chunk itself: the reference stands the walk at `v17[a3]` before it reads the first place of it.
	const first = chunk.readUInt16LE(0);
	if (first >= next.length) {
		throw invalidPicture("The walk of the chunk stands past the places of it");
	}
	let at = next[first] ?? 0;
	for (let place = 0; place < chunkSize; place += 1) {
		if (2 + at >= chunk.length) {
			throw invalidPicture(
				"The walk of the chunk stands past the places of it",
			);
		}
		places[place] = chunk[2 + at] ?? 0;
		at = next[at] ?? 0;
	}
	return places;
}

/**
 * `GccFormat.Reader.AltUnpack`: the walk of the places of a picture of the second kind, which stands of
 * chunks of no more than sixty five thousand five hundred and thirty five places, every chunk standing
 * either of the places of the file itself or of the two runs of sixteen values behind it.
 */
function altUnpack(data: Buffer, layout: GccLayout, start: number): Buffer {
	if (data.length < 0x14) {
		throw invalidPicture("The head of the picture stands short of the file");
	}
	const total = layout.width * layout.height * COLOR_PLACES;
	const output: Buffer = Buffer.alloc(total, 0x00);
	const reader = new GccReader(data, start);
	const walk: ChunkWalk = { output, dst: 0 };
	let source = start + data.readInt32LE(0x10);
	let placed = 0;
	while (placed < total) {
		const chunkSize = Math.min(total - placed, CHUNK_LIMIT);
		if (reader.nextBit()) {
			const chunk: Buffer = Buffer.alloc(chunkSize + 2, 0x00);
			source = readCompressedChunk(data, reader, source, chunk, chunkSize + 2);
			const places = decodeChunk(chunk, chunkSize);
			if (walk.dst + chunkSize > output.length) {
				throw invalidPicture(
					"The places of the chunk stand past the places of the picture",
				);
			}
			places.copy(output, walk.dst);
			walk.dst += chunkSize;
		} else {
			source = readRawChunk(data, reader, source, walk, chunkSize);
		}
		placed += chunkSize;
	}
	return output;
}

/** `GccFormat.Reader.Unpack`: the places of the picture, handed over as a bitmap. */
export function unpackGccPicture(data: Buffer, layout: GccLayout): Buffer {
	const start = layout.masked ? MASKED_OFFSET : PLAIN_OFFSET;
	const expected = layout.width * layout.height * COLOR_PLACES;
	// The walks of the alpha of a picture stand behind the walk of the colours of it: the walk of the
	// colours stands of the places of the picture alone, as the walk of the reference stands of them.
	const pixels = layout.alt
		? altUnpack(data, layout, start)
		: inflateLzss(data.subarray(start), { outputLength: expected });
	const flipped = flipRows(pixels, layout.width * COLOR_PLACES, layout.height);
	if (!layout.masked) {
		return writeBmp24(layout.width, layout.height, flipped);
	}
	const alphaWidth = data.readUInt16LE(0x18);
	const alphaHeight = data.readUInt16LE(0x1a);
	const bitsAt = MASKED_OFFSET + data.readInt32LE(0x0c);
	const alphaAt = bitsAt + data.readInt32LE(0x1c);
	if (bitsAt < 0 || bitsAt > data.length) {
		throw invalidPicture("The walk of the alpha stands beyond the file");
	}
	const reader = new GccReader(data, bitsAt);
	const alpha = reader.unpackAlpha(alphaWidth, alphaHeight, alphaAt);
	if (
		alphaWidth < layout.offsetX + layout.width ||
		alphaHeight < layout.offsetY + layout.height
	) {
		return writeBmp24(layout.width, layout.height, flipped);
	}
	const converted = convertToBgra(
		pixels,
		alpha,
		layout,
		alphaWidth,
		alphaHeight,
	);
	return writeBmp32(layout.width, layout.height, converted);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const elfGccImageDescriptor: FormatDescriptor = {
	id: "elf-gcc-image",
	name: "AI5WIN engine image",
	extensions: ["g24", "r24"],
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
			source: "ArcFormats/elf/ImageGCC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const elfGccImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: elfGccImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("G24n", "latin1") },
			{ bytes: Buffer.from("G24m", "latin1") },
			{ bytes: Buffer.from("R24n", "latin1") },
			{ bytes: Buffer.from("R24m", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readGccLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readGccLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the AI5WIN engine");
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
					bitsPerPixel: layout.masked ? 32 : 24,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				bitsPerPixel: layout.masked ? 32 : 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGccLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the AI5WIN engine");
		return Readable.from([unpackGccPicture(data, layout)]);
	},
});
