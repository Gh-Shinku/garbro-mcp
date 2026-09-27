// Format reference: GARbro "ArcFormats/Mnp/ArcMMA.cs", class `MmaOpener` (listing, name list and
// payload unpacking; the `MmeImageDecoder` and `MmeMaskDecoder` image decoders are out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive starts with the little endian spelling of `ARC!`. */
const SIGNATURE = Buffer.from("ARC!", "latin1");
const INDEX_OFFSET_OFFSET = 4;
const VERSION_OFFSET = 0xc;
const VERSION = 1;
const COUNT_OFFSET = 0x10;
const RECORD_SIZE = 0x14;
/** The payload stream is masked with this repeating key. */
const DEFAULT_KEY = Buffer.from([
	0x77, 0x2c, 0x6f, 0x7a, 0x71, 0x4f, 0x25, 0x74, 0x6c, 0x28, 0x7a, 0x81, 0x4c,
	0x31, 0x81, 0x5b, 0x77, 0x81, 0x4d, 0x79, 0x29, 0x69, 0x45, 0x6b, 0x79, 0x7a,
	0x68, 0x2d, 0x69, 0x66, 0x29, 0x39,
]);
/** The two low flags decide how a payload is stored. */
const STORAGE_MASK = 6;
const STORAGE_LZ = 6;
const STORAGE_HEADER = 4;
/** The first entry can hold a packed list of names. */
const NAME_LIST_FLAGS = 0x2f;
/** Type hints from the upper flag bits. */
const TYPE_MASK = 0x38;
const IMAGE_FLAGS = [8, 0x10, 0x18, 0x38];
const AUDIO_FLAGS = 0x2d;
/** The LZ stream starts with this marker: stored, compressed, or masked. */
const LZ_MARKER = 0xc0;
const LZ_STORED = 0;
/** Literals are rotated the other way round, matches use the low bits for the count. */
const LITERAL_ROTATE = 5;
const MATCH_ROTATE = 3;
const MATCH_COUNT_MASK = 0x1f;
const MATCH_COUNT_BIAS = 3;
const MATCH_OFFSET_BIAS = 1;
const BIT_MSB = 0x80;

interface MmaEntry {
	path: string;
	offset: bigint;
	size: bigint;
	unpackedSize: number;
	headerSize: number;
	flags: number;
	type?: string;
}

function rotateRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

function rotateLeft(value: number, count: number): number {
	return ((value << count) | (value >>> (8 - count))) & 0xff;
}

/** GARbro `MmaOpener.Decrypt`: mask every byte then rotate it right. */
function decrypt(data: Buffer, offset: number, length: number): void {
	for (let i = 0; i < length; i += 1) {
		const position = offset + i;
		const value =
			(data[position] ?? 0) ^ (DEFAULT_KEY[i & (DEFAULT_KEY.length - 1)] ?? 0);
		data[position] = rotateRight(value, MATCH_ROTATE);
	}
}

/**
 * GARbro `MmaOpener.UnpackLz`: a marker byte selects a stored payload, a plain LZ stream, or a
 * masked one; the stream itself is read most significant bit first.
 */
function unpackLz(input: Buffer, outputLength: number): Buffer | undefined {
	if (input.length === 0) return undefined;
	const marker = input[0] ?? 0;
	let data = input;
	let position = 1;
	if (marker !== LZ_MARKER) {
		if ((marker ^ (DEFAULT_KEY[0] ?? 0)) === LZ_MARKER) {
			// The whole stream, marker included, is masked with the key.
			data = Buffer.from(input);
			for (let i = 0; i < data.length; i += 1)
				data[i] =
					(data[i] ?? 0) ^ (DEFAULT_KEY[i & (DEFAULT_KEY.length - 1)] ?? 0);
		} else if (marker !== LZ_STORED) {
			return undefined;
		} else {
			const output = Buffer.alloc(outputLength);
			Buffer.from(data.subarray(1, 1 + outputLength)).copy(output, 0);
			return output;
		}
	}
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	let mask = 0;
	let control = 0;
	while (destination < outputLength) {
		if (mask === 0) {
			if (position >= data.length) break;
			control = data[position] ?? 0;
			position += 1;
			mask = BIT_MSB;
		}
		if ((control & mask) !== 0) {
			if (position + 2 > data.length) break;
			let word = ((data[position] ?? 0) << 8) | (data[position + 1] ?? 0);
			position += 2;
			const count = (word & MATCH_COUNT_MASK) + MATCH_COUNT_BIAS;
			word = (word >> 5) + MATCH_OFFSET_BIAS;
			for (let i = 0; i < count && destination < outputLength; i += 1) {
				output[destination] = output[destination - word] ?? 0;
				destination += 1;
			}
		} else {
			if (position >= data.length) break;
			output[destination] = rotateLeft(data[position] ?? 0, LITERAL_ROTATE);
			destination += 1;
			position += 1;
		}
		mask >>= 1;
	}
	return output;
}

/** GARbro `MmaOpener.UnpackEntry`: the flags select stored, header offset or LZ payloads. */
function unpackEntry(data: Buffer, entry: MmaEntry): Buffer | undefined {
	const storage = entry.flags & STORAGE_MASK;
	if (storage === STORAGE_LZ && entry.headerSize === 0)
		return unpackLz(data, entry.unpackedSize);
	if (storage === STORAGE_HEADER) {
		const start = entry.headerSize;
		const output = Buffer.alloc(entry.unpackedSize);
		Buffer.from(data.subarray(start, start + entry.unpackedSize)).copy(
			output,
			0,
		);
		decrypt(output, 0, output.length);
		return output;
	}
	return Buffer.from(data);
}

function typeOf(flags: number): string | undefined {
	if (IMAGE_FLAGS.includes(flags & TYPE_MASK)) return "image";
	if (flags === AUDIO_FLAGS) return "audio";
	return undefined;
}

/** GARbro `MmaOpener.TryOpen` and `ReadMmaList`. */
async function readMmaLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<MmaEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET) + 4n) return undefined;
	const head = Buffer.from(await source.readAt(0n, COUNT_OFFSET + 4));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (head.readInt32LE(VERSION_OFFSET) !== VERSION) return undefined;
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(head.readUInt32LE(INDEX_OFFSET_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(RECORD_SIZE * count) > source.size) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(indexOffset, RECORD_SIZE * count));
	} catch {
		return undefined;
	}
	const base = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
	const entries: MmaEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const entry: MmaEntry = {
			path: `${base}#${String(i).padStart(5, "0")}`,
			offset: BigInt(index.readUInt32LE(position)),
			unpackedSize: index.readUInt32LE(position + 4),
			size: BigInt(index.readUInt32LE(position + 8)),
			headerSize: index.readUInt32LE(position + 0x0c),
			flags: index.readUInt32LE(position + 0x10),
		};
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
		const type = typeOf(entry.flags);
		if (type !== undefined) entry.type = type;
		entries.push(entry);
	}
	const first = entries[0];
	if (first && first.flags === NAME_LIST_FLAGS) {
		const packed = Buffer.from(
			await source.readAt(first.offset, Number(first.size)),
		);
		const unpacked = unpackEntry(packed, first);
		if (!unpacked) return undefined;
		const names = decodeCp932(unpacked).split(/\r\n|\n|\r/);
		for (let i = 0; i < entries.length; i += 1) {
			const line = names[i];
			if (line === undefined) break;
			const entry = entries[i];
			if (entry) entry.path = line.replace(/^.*[/\\]/, "");
		}
	}
	return entries.length > 0 ? entries : undefined;
}

/** `MmeImageDecoder`: a picture of this engine stands of twenty four or thirty two places of a colour. */
const MME_IMAGE_FLAG = 8;
/** `MmeMaskDecoder`: a picture of a covering place stands of eight places of a colour, one to a pixel. */
const MME_MASK_FLAGS = [0x10, 0x18];
/** The head of a picture of this engine: its counts, of four words. */
const MME_HEAD_SIZE = 0x10;

/** The colour map of a picture of a covering place, which the engine reads as a picture of grey. */
function greyColourMap(): Buffer {
	const entries = Buffer.alloc(256 * 4);
	for (let level = 0; level < 256; level += 1) {
		entries[level * 4] = level;
		entries[level * 4 + 1] = level;
		entries[level * 4 + 2] = level;
	}
	return entries;
}

/**
 * `MmaOpener.OpenImage` and the two decoders behind it: the counts of the picture stand of the head of the entry,
 * at nought, and its places stand behind the head the entry declares, of the walk its flags of storage name. A
 * picture of a covering place stands of eight places of a colour, one to a pixel, and every other picture stands
 * of twenty four or of thirty two; a picture of any other count stands turned away here, where the reference
 * would hand it over as a picture of thirty two places of a colour over a row of its own count.
 */
function readMmePicture(
	data: Buffer,
	entry: {
		path: string;
		headerSize: number;
		unpackedSize: number;
		flags: number;
	},
): Buffer | undefined {
	const kind = entry.flags & TYPE_MASK;
	const isMask = MME_MASK_FLAGS.includes(kind);
	if (MME_IMAGE_FLAG !== kind && !isMask) return undefined;
	if (data.length < MME_HEAD_SIZE) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of too few places of the file`,
		);
	}
	const width = data.readInt32LE(0);
	const height = data.readInt32LE(4);
	const bpp = isMask ? 8 : data.readInt32LE(8);
	const stride = isMask ? width : data.readInt32LE(0xc);
	if (width <= 0 || height <= 0 || stride <= 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of no places of the file`,
		);
	}
	const places = 8 === bpp ? 1 : 24 === bpp ? 3 : 32 === bpp ? 4 : 0;
	if (places === 0) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`The picture ${entry.path} stands of ${bpp} places of a colour`,
		);
	}
	if (stride < width * places || stride * height > entry.unpackedSize) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of a row of the wrong count`,
		);
	}
	// `MmeBaseDecoder.GetImageData`: the places stand of the walk the flags of storage name.
	const output = Buffer.alloc(entry.unpackedSize, 0x00);
	const storage = entry.flags & STORAGE_MASK;
	const stored = data.subarray(Math.min(entry.headerSize, data.length));
	if (2 === storage) {
		stored.copy(output, 0, 0, Math.min(stored.length, output.length));
	} else if (4 === storage) {
		const length = Math.min(stored.length, output.length);
		stored.copy(output, 0, 0, length);
		decrypt(output, 0, length);
	} else if (6 === storage) {
		const unpacked = unpackLz(stored, output.length);
		if (!unpacked) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`The picture ${entry.path} stands of no walk of the compressed streams`,
			);
		}
		unpacked.copy(output);
	} else {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of no walk of its places`,
		);
	}
	// A row of the file stands of the count of its own places, of which a bitmap holds the places of the picture.
	const pixels = Buffer.alloc(width * height * places, 0x00);
	for (let row = 0; row < height; row += 1) {
		output.copy(
			pixels,
			row * width * places,
			row * stride,
			row * stride + width * places,
		);
	}
	if (isMask) {
		return writeBmp8Palette(width, height, pixels, greyColourMap());
	}
	if (24 === bpp) return writeBmp24(width, height, pixels);
	// `Bgr32` stands of no covering place, so the fourth place of every pixel stands of the whole of itself.
	for (let at = 3; at < pixels.length; at += 4) pixels[at] = 0xff;
	return writeBmp32(width, height, pixels);
}

export const mmaDescriptor: FormatDescriptor = {
	id: "mnp-mma",
	name: "MNP engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Mnp/ArcMMA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mmaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mmaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMmaLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readMmaLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MNP MMA layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				compressed: (entry.flags & STORAGE_MASK) !== 0,
				encrypted: (entry.flags & STORAGE_MASK) === STORAGE_HEADER,
				metadata: {
					unpackedSize: entry.unpackedSize,
					headerSize: entry.headerSize,
					flags: entry.flags,
					...(entry.type !== undefined ? { type: entry.type } : {}),
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { unpackedSize?: number; headerSize?: number; flags?: number }
			| undefined;
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const output = unpackEntry(data, {
			path: entry.path,
			offset: entry.offset,
			size: entry.size,
			unpackedSize: metadata?.unpackedSize ?? Number(entry.size),
			headerSize: metadata?.headerSize ?? 0,
			flags: metadata?.flags ?? 0,
		});
		if (!output)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MNP MMA payload");
		// A picture of this engine stands of its own head, which the walk of the pictures of this engine reads;
		// every other entry stands of the places of the file as they are.
		const picture = readMmePicture(data, {
			path: entry.path,
			headerSize: metadata?.headerSize ?? 0,
			unpackedSize: metadata?.unpackedSize ?? Number(entry.size),
			flags: metadata?.flags ?? 0,
		});
		if (picture) return Readable.from([picture]);
		// The stored and header branches yield exactly the declared unpacked size.
		return Readable.from([Buffer.from(output)]);
	},
});
