// LZ4, of the reference `ArcFormats/Lz4Stream.cs` (`Lz4FrameInfo`, `Lz4Stream`, `Lz4Compressor`) and the
// walk of the head of a frame of `ArcFormats/KiriKiri/CryptAlgorithms.cs` (`DecompressLz4`).
//
// The reference reads a frame block by block through a stream rather than into one buffer, and stands of
// the kinds of a frame of blocks standing apart and of no dictionary alone. This port walks the frame of a
// buffer, of the same walk of the places of it and of the same two kinds, and refuses the other two the way
// the reference stands of them as well.

import { GarbroError } from "@garbro-mcp/core";

const HEAD_SIZE = 6;
const VERSION = 1;
/** The places of a place of a match, of the count the format stands of. */
const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MF_LIMIT = 12;
const MATCH_LENGTH_BITS = 4;
const MATCH_LENGTH_MASK = 0x0f;
const RUN_MASK = 0x0f;
const FLAG_INDEPENDENT = 0x20;
const FLAG_BLOCK_CHECKSUM = 0x10;
const FLAG_CONTENT_LENGTH = 0x08;
const FLAG_CONTENT_CHECKSUM = 0x04;
const FLAG_DICTIONARY = 0x01;
/** The counts of a place of a block of the format, of the code of the head of the frame. */
const BLOCK_SIZES: Record<number, number> = {
	4: 0x10000,
	5: 0x40000,
	6: 0x100000,
	7: 0x400000,
};

function invalidBlock(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedFrame(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** The head of a frame of the format, of the flags of it and of the counts of a block of it. */
export interface Lz4FrameInfo {
	/** The counts of a block of the frame, of the code of the head of it. */
	blockSize: number;
	/** Whether the blocks of the frame stand of no place of the block in front of them. */
	independentBlocks: boolean;
	hasBlockChecksum: boolean;
	hasContentLength: boolean;
	hasContentChecksum: boolean;
	hasDictionary: boolean;
	originalLength: number;
	dictionaryId: number;
}

/** `Lz4FrameInfo.Lz4FrameInfo (byte flags)`: the flags of the head of a frame. */
export function readLz4FrameInfo(flags: number): Lz4FrameInfo | undefined {
	if (VERSION !== flags >> 6) return undefined;
	return {
		blockSize: 0,
		independentBlocks: 0 !== (flags & FLAG_INDEPENDENT),
		hasBlockChecksum: 0 !== (flags & FLAG_BLOCK_CHECKSUM),
		hasContentLength: 0 !== (flags & FLAG_CONTENT_LENGTH),
		hasContentChecksum: 0 !== (flags & FLAG_CONTENT_CHECKSUM),
		hasDictionary: 0 !== (flags & FLAG_DICTIONARY),
		originalLength: 0,
		dictionaryId: 0,
	};
}

/** `Lz4FrameInfo.SetBlockSize (int code)`: the counts of a block of the place of the head of a frame. */
export function readLz4BlockSize(code: number): number | undefined {
	return BLOCK_SIZES[(code >> 4) & 7];
}

/**
 * `Lz4Compressor.DecompressBlock`: the places of a block of the format, of the places of the block of it.
 * Every place of a run of the places of the reference stands held within the block and within the places of
 * the picture of it, where the reference stands of the bounds of its own places of a stream.
 */
export function decompressLz4Block(block: Buffer, outputSize: number): Buffer {
	const output: Buffer = Buffer.alloc(outputSize, 0x00);
	const iend = block.length;
	const oend = outputSize;
	let src = 0;
	let dst = 0;
	for (;;) {
		if (src >= iend) throw invalidBlock("LZ4 block stands short of its places");
		const token = block[src++] ?? 0;
		let length = token >> MATCH_LENGTH_BITS;
		if (RUN_MASK === length) {
			let place = 0;
			do {
				if (src >= iend)
					throw invalidBlock("LZ4 block stands short of its places");
				place = block[src++] ?? 0;
				length += place;
			} while (src < iend - RUN_MASK && 0xff === place);
			if (dst + length < dst || src + length < src) {
				throw invalidBlock("LZ4 block stands of a count of no end");
			}
		}
		// The places of a run of the block in front of the places of a match of it.
		const copyEnd = dst + length;
		if (
			copyEnd > oend - MF_LIMIT ||
			src + length > iend - (3 + LAST_LITERALS)
		) {
			if (src + length !== iend || copyEnd > oend) {
				throw invalidBlock("LZ4 block stands short of its places");
			}
			block.copy(output, dst, src, src + length);
			src += length;
			dst += length;
			break;
		}
		block.copy(output, dst, src, src + length);
		src += length;
		dst = copyEnd;
		if (src + 2 > iend)
			throw invalidBlock("LZ4 block stands short of its places");
		const offset = block.readUInt16LE(src);
		src += 2;
		const match = dst - offset;
		if (match < 0)
			throw invalidBlock("LZ4 block stands of a place of no match");
		length = token & MATCH_LENGTH_MASK;
		if (MATCH_LENGTH_MASK === length) {
			let place = 0;
			do {
				if (src >= iend)
					throw invalidBlock("LZ4 block stands short of its places");
				place = block[src++] ?? 0;
				if (src > iend - LAST_LITERALS) {
					throw invalidBlock("LZ4 block stands short of its places");
				}
				length += place;
			} while (0xff === place);
			if (dst + length < dst) {
				throw invalidBlock("LZ4 block stands of a count of no end");
			}
		}
		length += MIN_MATCH;
		if (dst + length > oend) {
			throw invalidBlock("LZ4 block stands past the places of its picture");
		}
		// The places of a match stand of the places of the picture in front of them, of the two of them
		// standing over each other of every count of them.
		for (let place = 0; place < length; place += 1) {
			output[dst + place] = output[match + place] ?? 0;
		}
		dst += length;
	}
	return output.subarray(0, dst);
}

/**
 * The walk of the head of a frame of `DecompressLz4`: the word of the format, the flags of the frame, the
 * counts of a block of it, the counts of the picture of it and the place of the walk of it where they stand,
 * and then the blocks of the frame up to the block of no places at all.
 */
export function readLz4FrameHead(data: Buffer): Lz4FrameInfo | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	// The word of a frame of the format, of the places of the other way of the engine.
	if (data.readUInt32LE(0) !== 0x184d2204) return undefined;
	const info = readLz4FrameInfo(data[4] ?? 0);
	if (!info) return undefined;
	const blockSize = readLz4BlockSize(data[5] ?? 0);
	if (undefined === blockSize) return undefined;
	info.blockSize = blockSize;
	return info;
}

/** `Lz4Stream`: the places of a frame of the format, of the blocks of it. */
export function decompressLz4Frame(data: Buffer): Buffer {
	const info = readLz4FrameHead(data);
	if (!info) throw invalidBlock("Not a frame of LZ4");
	if (!info.independentBlocks) {
		throw unsupportedFrame("LZ4 frame of linked blocks stands unported");
	}
	if (info.hasDictionary) {
		throw unsupportedFrame("LZ4 frame of a dictionary stands unported");
	}
	let at = HEAD_SIZE;
	if (info.hasContentLength) {
		if (at + 8 > data.length)
			throw invalidBlock("LZ4 frame stands short of its head");
		info.originalLength = Number(data.readBigUInt64LE(at));
		at += 8;
	}
	if (info.hasDictionary) at += 4;
	// The place of the walk of the head of the frame stands of a count of its own.
	at += 1;
	const parts: Buffer[] = [];
	for (;;) {
		if (at + 4 > data.length)
			throw invalidBlock("LZ4 frame stands short of its places");
		const size = data.readInt32LE(at);
		at += 4;
		if (0 === size) {
			if (info.hasContentChecksum) at += 4;
			break;
		}
		if (size < 0) {
			// The places of a block standing as they stand stand of no walk of the format.
			const length = size & 0x7fffffff;
			if (at + length > data.length) {
				throw invalidBlock("LZ4 frame stands short of its places");
			}
			parts.push(Buffer.from(data.subarray(at, at + length)));
			at += length;
		} else {
			if (at + size > data.length) {
				throw invalidBlock("LZ4 frame stands short of its places");
			}
			parts.push(
				decompressLz4Block(data.subarray(at, at + size), info.blockSize),
			);
			at += size;
		}
		if (info.hasBlockChecksum) at += 4;
	}
	return Buffer.concat(parts);
}
