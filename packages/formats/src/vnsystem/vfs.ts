// Format reference: GARBro ArcFormats/VnSystem/ArcVFS.cs, class `VfsOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("VFS File", "ascii");
const COMPRESSED_FIELD = 8;
const COUNT_FIELD = 0xc;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x14;
const OFFSET_SIZE = 8;
const RECORD_SIZE = NAME_SIZE + OFFSET_SIZE;
/** Packed entries keep a four-byte unpacked size in front of the bit stream. */
const PACKED_PREFIX_SIZE = 4;
/** The reference's sliding dictionary is 16 bytes wide. */
const DICTIONARY_SIZE = 0x10;
const DICTIONARY_MASK = 0x0f;
const BYTE_BITS = 8;

/**
 * GARbro's `MsbBitStream`: bits are consumed most-significant first, a byte at a time. `GetBits`
 * returns -1 once the stream is exhausted, which `GetNextBit` turns into the match flag the reference
 * tests against zero, so the port keeps the same signed return instead of failing early.
 */
class MsbBitReader {
	readonly #data: Buffer;
	#position = 0;
	#bits = 0;
	#cached = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	getBits(count: number): number {
		while (this.#cached < count) {
			if (this.#position >= this.#data.length) return -1;
			this.#bits = (this.#bits << 8) | (this.#data[this.#position++] ?? 0);
			this.#cached += 8;
		}
		const mask = (1 << count) - 1;
		this.#cached -= count;
		return (this.#bits >> this.#cached) & mask;
	}

	/** GARbro `GetBitLength`: a unary count of zero bits followed by that many value bits. */
	getLength(): number {
		let count = 0;
		while (this.getBits(1) === 0) count += 1;
		let value = 1 << count;
		if (count > 0) value |= this.getBits(count);
		return value;
	}
}

/**
 * GARbro `VfsOpener.UnpackEntry`. A flag bit selects between a literal byte and a back reference into
 * a 16-byte dictionary: a set flag reads a bit length, moves that far back from the current dictionary
 * position (wrapping once) and emits that byte, while a clear flag reads eight literal bits. Every
 * emitted byte lands in the dictionary, which is what makes short-distance repeats possible.
 */
export function unpackVnsEntry(input: Buffer, unpackedSize: number): Buffer {
	const output = Buffer.alloc(unpackedSize);
	const bits = new MsbBitReader(input);
	const dictionary = Buffer.alloc(DICTIONARY_SIZE);
	let dictionaryPosition = 0;
	for (let destination = 0; destination < output.length; destination += 1) {
		let value: number;
		if (bits.getBits(1) !== 0) {
			const offset = bits.getLength();
			let position = dictionaryPosition - offset;
			if (position < 0) position += DICTIONARY_SIZE;
			if (position < 0 || position >= DICTIONARY_SIZE)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid compressed data");
			value = dictionary[position] ?? 0;
		} else {
			value = bits.getBits(BYTE_BITS) & 0xff;
		}
		output[destination] = value;
		dictionary[dictionaryPosition] = value;
		dictionaryPosition = (dictionaryPosition + 1) & DICTIONARY_MASK;
	}
	return output;
}

/**
 * GARBro `VfsOpener.TryOpen`. The `VFS File` signature is followed by an archive-wide compressed flag
 * and a record count. Index records start at 0x10 and hold a 0x14-byte CP932 name, a payload offset
 * relative to the end of the index and a stored size.
 *
 * When the archive is compressed every entry keeps its declared unpacked size in the first payload
 * word, which the reference reads lazily; the port reads it while parsing so listing and extraction
 * agree, and drops the four-byte prefix from the stored extent.
 */
async function readVnsIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const compressed = header.readInt32LE(COMPRESSED_FIELD) !== 0;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexLength = count * RECORD_SIZE;
	const dataOffset = BigInt(INDEX_OFFSET + indexLength);
	if (dataOffset > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_OFFSET), indexLength);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const offset = dataOffset + BigInt(index.readUInt32LE(record + NAME_SIZE));
		const storedSize = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		if (!compressed) {
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(name),
					offset,
					size: storedSize,
					packedSize: storedSize,
				}),
			);
			continue;
		}
		if (storedSize < BigInt(PACKED_PREFIX_SIZE)) return undefined;
		const unpackedSize = BigInt(
			(await source.readAt(offset, PACKED_PREFIX_SIZE)).readUInt32LE(0),
		);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: offset + BigInt(PACKED_PREFIX_SIZE),
				size: unpackedSize,
				packedSize: storedSize - BigInt(PACKED_PREFIX_SIZE),
				compressed: true,
			}),
		);
	}
	return entries;
}

/**
 * GARBro `VfsOpener.OpenEntry`. Uncompressed archives emit plain byte ranges; compressed ones decode
 * the bit stream behind the four-byte unpacked size into exactly that many bytes.
 */
const vnsEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "VNSystem entry"),
	);
	return Readable.from([unpackVnsEntry(stored, Number(entry.size))]);
};

export const vnsystemVfsDescriptor: FormatDescriptor = {
	id: "vnsystem-vfs",
	name: "VNSystem engine resource archive",
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
			source: "ArcFormats/VnSystem/ArcVFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vnsystemVfsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vnsystemVfsDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readVnsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readVnsIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid VNSystem VFS layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: vnsEntryOpener,
});
