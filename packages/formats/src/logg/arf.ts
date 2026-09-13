// Format reference: GARBro Legacy/Logg/ArcARF.cs, class `ArfOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const INDEX_START = 4;
/** Every record is an offset, an unpacked size, a name length and the name itself. */
const RECORD_HEADER_SIZE = 9;
const MAX_UNPACKED_SIZE = 0x7fffffff;

/**
 * GARBro `LsbBitStream`: bits are consumed from the least significant bit of each byte, and the value
 * a read returns has the first bit it consumed as its least significant bit. A stream that ends before
 * a read completes reports `-1`, which the codec treats as corruption.
 */
class LsbBitReader {
	readonly #input: Buffer;
	#position = 0;
	#offset = 0;

	constructor(input: Uint8Array) {
		this.#input = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	}

	tryReadBits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			if (this.#position >= this.#input.length) return -1;
			const byte = this.#input[this.#position] ?? 0;
			value |= ((byte >> this.#offset) & 1) << index;
			this.#offset += 1;
			if (this.#offset === 8) {
				this.#offset = 0;
				this.#position += 1;
			}
		}
		return value;
	}
}

/**
 * GARBro `ArfOpener.Decompress`. A literal is a clear bit followed by eight bits of data. A set bit
 * starts a match whose length and distance each come from a ladder of bits: two, three, four and five
 * byte matches cost a single bit apiece, and longer ones escalate through two, four and ten bit
 * fields. Distances escalate the same way, from eight bits up to twelve.
 *
 * Copies are byte wise and may overlap, so a distance of zero repeats the previous byte. The reference
 * writes into a fixed output buffer, and reads behind it when the distance is too large; the port
 * reports both, and a stream that ends mid-symbol, as an invalid archive.
 */
/**
 * Reads the match length ladder: length 2 through 5 each cost a single bit, and longer ones escape
 * into a selector with two, four and ten bit fields. The bit order matters, so every level returns
 * as soon as it is taken.
 */
function readMatchLength(
	nextBit: () => number,
	nextBits: (count: number) => number,
): number {
	if (nextBit() === 0) return 2;
	if (nextBit() === 0) return 3;
	if (nextBit() === 0) return 4;
	if (nextBit() === 0) return 5;
	const selector = nextBits(2);
	if (selector === 0) return 6;
	if (selector === 1) return nextBits(2) + 7;
	if (selector === 2) return nextBits(4) + 11;
	return nextBits(10) + 26;
}

/** Reads the match distance ladder, from eight bits up to twelve. */
function readMatchDistance(
	nextBit: () => number,
	nextBits: (count: number) => number,
): number {
	if (nextBit() === 0) return nextBits(8);
	if (nextBit() === 0) return nextBits(10) + 0x100;
	return nextBits(12) + 0x500;
}

export function decompressArf(input: Uint8Array, outputLength: number): Buffer {
	const bits = new LsbBitReader(input);
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	const nextBit = (): number => {
		const bit = bits.tryReadBits(1);
		if (bit === -1)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated ARF stream");
		return bit;
	};
	const nextBits = (count: number): number => {
		const value = bits.tryReadBits(count);
		if (value === -1)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated ARF stream");
		return value;
	};
	while (destination < outputLength) {
		if (nextBit() === 0) {
			if (destination >= outputLength)
				throw new GarbroError("INVALID_ARCHIVE", "ARF literal overflow");
			output[destination++] = nextBits(8);
			continue;
		}
		const count = readMatchLength(nextBit, nextBits);
		const distance = readMatchDistance(nextBit, nextBits);
		const source = destination - distance - 1;
		if (source < 0 || destination + count > outputLength)
			throw new GarbroError("INVALID_ARCHIVE", "ARF match out of range");
		for (let index = 0; index < count; index += 1)
			output[destination + index] = output[source + index] ?? 0;
		destination += count;
	}
	return output;
}

/** Reads a CP932 name out of its length-prefixed field. */
function readName(record: Buffer, offset: number, length: number): string {
	const field = record.subarray(offset, offset + length);
	const terminator = field.indexOf(0);
	return decodeCp932(terminator === -1 ? field : field.subarray(0, terminator));
}

/**
 * GARBro `ArfOpener.TryOpen`. Records are walked rather than indexed: a payload offset that has to
 * point behind the record itself, the unpacked size, a one byte name length and the name. The walk has
 * to stay inside the first payload's offset, which the reference uses as the end of the index.
 *
 * Stored sizes are not in the index at all. The reference walks the records backwards from the end of
 * the file, so each entry is stored from its own offset up to the next entry's — or to the end of the
 * file for the last one. An entry whose name is empty is dropped after it has delimited the one behind
 * it.
 *
 * The stored size is compared against the unpacked size to decide whether an entry is compressed, and
 * because the reverse walk can produce a wrapped size for offsets that do not increase, the port keeps
 * the reference's 32-bit wrap.
 */
async function readArfIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const countBuffer = await source.readAt(0n, INDEX_START);
	const count = countBuffer.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;

	interface Record {
		offset: bigint;
		unpackedSize: bigint;
		name: string;
	}
	const records: Record[] = [];
	let index = BigInt(INDEX_START);
	for (let id = 0; id < count; id += 1) {
		if (index + BigInt(RECORD_HEADER_SIZE) > source.size) return undefined;
		const header = await source.readAt(index, RECORD_HEADER_SIZE);
		const offset = BigInt(header.readUInt32LE(0));
		const unpackedSize = BigInt(header.readUInt32LE(4));
		const nameLength = header[8] ?? 0;
		if (offset <= index || offset > source.size) return undefined;
		if (index + BigInt(RECORD_HEADER_SIZE + nameLength) > source.size)
			return undefined;
		const nameField = await source.readAt(
			index + BigInt(RECORD_HEADER_SIZE),
			nameLength,
		);
		const name = readName(nameField, 0, nameLength);
		records.push({ offset, unpackedSize, name });
		index += BigInt(RECORD_HEADER_SIZE + nameLength);
		const firstOffset = records[0]?.offset;
		if (firstOffset !== undefined && index > firstOffset) return undefined;
	}
	if (records.length === 0) return undefined;

	// Walk backwards to give every record the range up to the next one, or to the end of the file.
	const sizes = new Array<bigint>(records.length);
	let lastOffset = source.size;
	for (let id = records.length - 1; id >= 0; id -= 1) {
		const record = records[id];
		if (!record) return undefined;
		sizes[id] = BigInt.asUintN(32, lastOffset - record.offset);
		lastOffset = record.offset;
	}

	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		if (record.name.length === 0) continue;
		const storedSize = sizes[id] ?? 0n;
		const compressed = storedSize !== record.unpackedSize;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: record.offset,
				size: compressed ? record.unpackedSize : storedSize,
				packedSize: storedSize,
				compressed,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARBro `ArfOpener.OpenEntry`: stored payloads pass through, compressed ones use the bit codec. */
const arfEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	if (entry.size > MAX_UNPACKED_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ARF output size");
	return Readable.from([decompressArf(stored, Number(entry.size))]);
};

export const loggArfDescriptor: FormatDescriptor = {
	id: "logg-arf",
	name: "Logg archive file",
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
			source: "Legacy/Logg/ArcARF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const loggArfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: loggArfDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArfIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readArfIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ARF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: arfEntryOpener,
});
