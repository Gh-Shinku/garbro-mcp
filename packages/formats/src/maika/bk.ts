// Format reference: GARBro ArcFormats/Maika/ArcBK.cs, class `BkOpener` and its `LzBitsDecompressor`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "@garbro-mcp/codecs";
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

const INDEX_OFFSET_OFFSET = 0;
const INDEX_SIZE_OFFSET = 4;
const INDEX_COUNT_SIZE = 4;
/** Records are a fixed width: three words plus a padded name field. */
const RECORD_HEADER_SIZE = 12;
const NAME_SIZE = 0x104;
const RECORD_SIZE = RECORD_HEADER_SIZE + NAME_SIZE;
/** The ring buffer of the bit codec. */
const FRAME_SIZE = 0x400;
const FRAME_MASK = FRAME_SIZE - 1;
/** The match length is five bits wider than its smallest value. */
const MATCH_BASE_LENGTH = 2;
/** Text of an image entry. */
const IMAGE_EXTENSION = ".gpt";
/** Entries with this extension are stored bitwise inverted. */
const XOR_EXTENSION = ".gpa";
const XOR_KEY = 0xff;

function hasExtension(path: string, extension: string): boolean {
	return path.toLowerCase().endsWith(extension);
}

/** GARbro `Decompressor` output plumbing, bounded only by the input stream. */
class OutputBuffer {
	readonly #chunks: Buffer[] = [];
	#chunk = Buffer.alloc(0x10000);
	#length = 0;
	#total = 0;

	push(value: number): void {
		if (this.#length === this.#chunk.length) {
			this.#chunks.push(this.#chunk);
			this.#chunk = Buffer.alloc(0x10000);
			this.#length = 0;
		}
		this.#chunk[this.#length] = value;
		this.#length += 1;
		this.#total += 1;
	}

	toBuffer(): Buffer {
		this.#chunks.push(this.#chunk.subarray(0, this.#length));
		return Buffer.concat(this.#chunks, this.#total);
	}
}

/**
 * GARbro `LzBitsDecompressor`. A most-significant-bit-first stream mixes literals with ring-buffer
 * matches: a set bit introduces an eight bit literal, a clear bit a ten bit distance and a five bit
 * length. Both the literal and every copied byte are appended to a 0x400-byte ring whose write
 * position starts at one, and a match reads from the ring while writing back into it, so matches that
 * overlap their own output see the bytes they just produced.
 *
 * The reference treats a stream that ends mid-symbol as a complete stream, so the port stops at
 * whichever symbol the input ran out in and returns what it decoded.
 */
export function decompressLzBits(input: Uint8Array): Buffer {
	const reader = new MsbBitReader(input);
	const frame = Buffer.alloc(FRAME_SIZE);
	const output = new OutputBuffer();
	let framePosition = 1;
	for (;;) {
		const bit = reader.tryReadBits(1);
		if (bit === -1) break;
		if (bit !== 0) {
			const value = reader.tryReadBits(8);
			if (value === -1) break;
			output.push(value);
			frame[framePosition++ & FRAME_MASK] = value;
			continue;
		}
		const distance = reader.tryReadBits(10);
		if (distance === -1) break;
		const lengthBits = reader.tryReadBits(5);
		if (lengthBits === -1) break;
		let count = lengthBits + MATCH_BASE_LENGTH;
		let position = distance;
		while (count > 0) {
			count -= 1;
			const value = frame[position++ & FRAME_MASK] ?? 0;
			output.push(value);
			frame[framePosition++ & FRAME_MASK] = value;
		}
	}
	return output.toBuffer();
}

/** Reads a null-terminated CP932 name out of a fixed-width field. */
function readName(buffer: Buffer, offset: number): string {
	const field = buffer.subarray(offset, offset + NAME_SIZE);
	const terminator = field.indexOf(0);
	return decodeCp932(terminator === -1 ? field : field.subarray(0, terminator));
}

/**
 * GARbro `BkOpener.TryOpen`. The archive ends with its index, which is itself compressed with the bit
 * codec: the offset and size at 0x00 have to describe exactly the tail of the file. The decompressed
 * index holds a count and fixed-width records of payload offset, stored size, unpacked size and a
 * padded name.
 *
 * A record is compressed exactly when its two sizes differ, entries named `.gpt` are images, and the
 * payload of a compressed entry is limited to the declared unpacked size before an `.gpa` name has the
 * output inverted.
 */
async function readBkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < 8n) return undefined;
	const header = await source.readAt(0n, 8);
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_OFFSET));
	if (indexOffset + indexSize !== source.size) return undefined;
	if (indexSize < BigInt(INDEX_COUNT_SIZE) || indexSize > BigInt(0x7fffffff))
		return undefined;

	const storedIndex = await source.readAt(indexOffset, Number(indexSize));
	const index = decompressLzBits(storedIndex);
	if (index.length < INDEX_COUNT_SIZE) return undefined;
	const count = index.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	if (INDEX_COUNT_SIZE + count * RECORD_SIZE > index.length) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = INDEX_COUNT_SIZE + id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + 4));
		const unpackedSize = BigInt(index.readUInt32LE(record + 8));
		const name = readName(index, record + RECORD_HEADER_SIZE);
		const compressed = size !== unpackedSize;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: compressed ? unpackedSize : size,
			packedSize: size,
			compressed,
		});
		if (hasExtension(name, IMAGE_EXTENSION))
			entry.metadata = { ...entry.metadata, type: "image" };
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `BkOpener.OpenEntry`: stored payloads pass through, compressed ones run through the bit codec,
 * are limited to the unpacked size and are inverted when the name says so.
 */
const bkEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	const decoded = decompressLzBits(stored).subarray(0, Number(entry.size));
	if (hasExtension(entry.path, XOR_EXTENSION)) {
		for (let index = 0; index < decoded.length; index += 1)
			decoded[index] = (decoded[index] ?? 0) ^ XOR_KEY;
	}
	return Readable.from([decoded]);
};

export const maikaBkDescriptor: FormatDescriptor = {
	id: "maika-bk",
	name: "Maika resource archive",
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
			source: "ArcFormats/Maika/ArcBK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const maikaBkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maikaBkDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readBkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readBkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Maika BK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: bkEntryOpener,
});
