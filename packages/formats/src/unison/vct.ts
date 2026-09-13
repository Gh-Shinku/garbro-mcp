// Format reference: GARBro Legacy/Unison/ArcVCT.cs, class `VctOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The header starts with a byte count whose entries occupy three bytes each. */
const SUBINDEX_STRIDE = 3;
const COUNT_SIZE = 4;
/** Index records are a fixed width: a 0x14-byte name, a 3-byte extension, then offset and size. */
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x14;
const EXTENSION_SIZE = 3;
const OFFSET_OFFSET = 0x18;
/** Payloads that start with this marker are packed. */
const LZS_MARKER = Buffer.from("LZS\0", "ascii");
const LZS_HEADER_SIZE = 16;
const LZS_UNPACKED_SIZE = 4;
const LZS_CONTROL_SIZE = 12;
/** The codec ring buffer and its first write position. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_START = 1;
/** The match length lives in the top nibble of the distance word and is offset by two. */
const MATCH_LENGTH_SHIFT = 12;
const MATCH_BASE_LENGTH = 2;
/** Bitmap repair: pixels are exchanged and their alpha inverted when this flag says thirty-two bit. */
const BMP_SIGNATURE = Buffer.from("BM", "ascii");
const BMP_BITS_OFFSET = 0x1c;
const BMP_PIXELS_OFFSET = 0x0a;
const BMP_ALPHA_OFFSET = 0x36;
const BMP_PALETTE_OFFSET = 0x3e;
const BMP_THIRTY_TWO_BITS = 32;
const BMP_ALPHA_VALUE = 0xff;
const BMP_PALETTE_ENTRY = 0xff0000;
const BMP_SWAPPED_PALETTE_ENTRY = 0x0000ff;

/** C# `string.IsNullOrWhiteSpace`, close enough for the whitespace the format stores. */
function isBlank(value: string): boolean {
	return /^\s*$/u.test(value);
}

/** GARbro `ReadString`: CP932 up to a null or the field width. */
function readField(buffer: Buffer, offset: number, size: number): string {
	const field = buffer.subarray(offset, offset + size);
	const terminator = field.indexOf(0);
	return decodeCp932(terminator === -1 ? field : field.subarray(0, terminator));
}

/**
 * GARBro `VctOpener.LzsUnpack`. A control byte array holds one bit per symbol, least significant bit
 * first, and a set bit emits a literal while a clear bit emits a ring match whose length sits in the
 * top nibble of its sixteen bit distance word.
 *
 * The reference would write past the declared output size, or read past the payload, on a malformed
 * stream; the port reports both as an invalid archive.
 */
export function unpackVctLzs(input: Buffer): Buffer {
	if (input.length < LZS_HEADER_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated VCT LZS header");
	const unpackedSize = input.readUInt32LE(LZS_UNPACKED_SIZE);
	const controlSize = input.readUInt32LE(LZS_CONTROL_SIZE);
	let position = LZS_HEADER_SIZE;
	if (controlSize > input.length - position)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated VCT LZS control");
	const control = input.subarray(position, position + controlSize);
	position += controlSize;
	if (unpackedSize > 0x7fffffff)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid VCT LZS size");

	const frame = Buffer.alloc(FRAME_SIZE);
	const output = Buffer.alloc(unpackedSize);
	let framePosition = FRAME_START;
	let controlPosition = 0;
	let destination = 0;
	let bits = 2;
	while (destination < unpackedSize) {
		bits >>= 1;
		if (bits === 1) {
			if (controlPosition >= control.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated VCT LZS control");
			bits = (control[controlPosition++] ?? 0) | 0x100;
		}
		if ((bits & 1) !== 0) {
			if (position >= input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated VCT LZS stream");
			const value = input[position++] ?? 0;
			output[destination++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
			continue;
		}
		if (position + 2 > input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated VCT LZS match");
		let distance = input.readUInt16LE(position);
		position += 2;
		let count = (distance >> MATCH_LENGTH_SHIFT) + MATCH_BASE_LENGTH;
		while (count > 0) {
			count -= 1;
			if (destination >= unpackedSize)
				throw new GarbroError("INVALID_ARCHIVE", "VCT LZS match overflow");
			const value = frame[distance++ & FRAME_MASK] ?? 0;
			output[destination++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
		}
	}
	return output;
}

/**
 * GARBro `VctOpener.FixBitmapAlpha`: pixels are stored with exchanged red and blue channels and an
 * inverted alpha, and one particular header shape stores its palette in the opposite order.
 *
 * The reference walks four byte pixels without checking that the last one is complete; the port leaves
 * a trailing partial pixel alone.
 */
function fixBitmapAlpha(bitmap: Buffer): void {
	const pixelsOffset = bitmap.readInt32LE(BMP_PIXELS_OFFSET);
	if (pixelsOffset < 0) return;
	for (
		let position = pixelsOffset;
		position + 4 <= bitmap.length;
		position += 4
	) {
		const red = bitmap[position] ?? 0;
		bitmap[position] = bitmap[position + 2] ?? 0;
		bitmap[position + 2] = red;
		bitmap[position + 3] = (bitmap[position + 3] ?? 0) ^ 0xff;
	}
	if (
		pixelsOffset === BMP_ALPHA_OFFSET &&
		bitmap.length >= BMP_PALETTE_OFFSET + 4 &&
		bitmap.readInt32LE(BMP_ALPHA_OFFSET) === BMP_ALPHA_VALUE &&
		bitmap.readInt32LE(BMP_PALETTE_OFFSET) === BMP_PALETTE_ENTRY
	) {
		bitmap.writeInt32LE(BMP_PALETTE_ENTRY, BMP_ALPHA_OFFSET);
		bitmap.writeInt32LE(BMP_SWAPPED_PALETTE_ENTRY, BMP_PALETTE_OFFSET);
	}
}

interface IndexLayout {
	entries: FixedEntry[];
	/** Stored sizes of the compressed entries, keyed by entry id. */
	packedSizes: Map<string, bigint>;
}

/**
 * GARbro `VctOpener.TryOpen`. The file opens with a byte count whose three-byte records precede the
 * entry count, then a table of 0x20-byte records: a name field of 0x14 bytes, a three character
 * extension and the payload offset and size. Names are trimmed and extensions are appended as they
 * are stored, so a padded extension ends up inside the name.
 *
 * Packed payloads only reveal themselves through their marker and header, which the port reads while
 * listing so the declared size and the extraction agree.
 */
async function readVctIndex(
	source: ByteSource,
): Promise<IndexLayout | undefined> {
	if (source.size < 1n) return undefined;
	const head = await source.readAt(0n, 1);
	const subindexCount = head[0] ?? 0;
	if (subindexCount === 0) return undefined;
	const countOffset = BigInt(1 + subindexCount * SUBINDEX_STRIDE);
	if (countOffset + BigInt(COUNT_SIZE) > source.size) return undefined;
	const countBuffer = await source.readAt(countOffset, COUNT_SIZE);
	const count = countBuffer.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexStart = countOffset + BigInt(COUNT_SIZE);
	const indexSize = BigInt(count * RECORD_SIZE);
	if (indexStart + indexSize > source.size) return undefined;

	const index = await source.readAt(indexStart, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	const packedSizes = new Map<string, bigint>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = readField(index, record, NAME_SIZE).replace(/\s+$/u, "");
		if (isBlank(name)) return undefined;
		const extension = readField(index, record + NAME_SIZE, EXTENSION_SIZE);
		const path = isBlank(extension) ? name : `${name}.${extension}`;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(record + OFFSET_OFFSET + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(path),
			offset,
			size,
		});
		const packed = await readPackedSize(source, offset, size);
		if (packed !== undefined) {
			packedSizes.set(entry.id, size);
			entry.size = packed;
			entry.packedSize = size;
			entry.compressed = true;
		}
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return { entries, packedSizes };
}

/** Reads the unpacked size out of a packed payload's header, when the payload is packed at all. */
async function readPackedSize(
	source: ByteSource,
	offset: bigint,
	size: bigint,
): Promise<bigint | undefined> {
	if (size < BigInt(LZS_HEADER_SIZE)) return undefined;
	const marker = await source.readAt(offset, LZS_MARKER.length);
	if (!marker.equals(LZS_MARKER)) return undefined;
	const header = await source.readAt(offset, LZS_HEADER_SIZE);
	return BigInt(header.readUInt32LE(LZS_UNPACKED_SIZE));
}

/** GARbro `VctOpener.OpenEntry`: packed payloads are unpacked and bitmaps repaired. */
const vctEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	const unpacked = unpackVctLzs(stored);
	if (
		unpacked.subarray(0, BMP_SIGNATURE.length).equals(BMP_SIGNATURE) &&
		unpacked.length >= BMP_BITS_OFFSET + 2 &&
		unpacked.readUInt16LE(BMP_BITS_OFFSET) === BMP_THIRTY_TWO_BITS
	) {
		fixBitmapAlpha(unpacked);
	}
	return Readable.from([unpacked]);
};

export const unisonVctDescriptor: FormatDescriptor = {
	id: "unison-vct",
	name: "Unison Shift resource archive",
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
			source: "Legacy/Unison/ArcVCT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unisonVctFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unisonVctDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readVctIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const layout = await readVctIndex(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid VCT layout");
		return {
			entries: layout.entries,
			metadata: { entryCount: layout.entries.length },
		};
	},
	openEntry: vctEntryOpener,
});
