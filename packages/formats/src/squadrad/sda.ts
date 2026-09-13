// Format reference: GARBro Legacy/SquadraD/ArcSDA.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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

const SIGNATURE = Buffer.from("SA\0", "latin1");
const DATA_OFFSET_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x14;
const NAME_SIZE = 0x10;
const OFFSET_OFFSET = 0x0c;
const SIZE_OFFSET = 0x10;
const CG_NAME = "g";
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_INIT_POSITION = 0xfc0;
const MATCH_BASE = 3;
const SHORT_COUNT_BITS = 4;
const LONG_COUNT_BITS = 6;

export const sdaSdDescriptor: FormatDescriptor = {
	id: "squadrad-sda",
	name: "Squadra D resource archive",
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
			source: "Legacy/SquadraD/ArcSDA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `LsbBitStream`: bits are consumed least-significant first. */
class LsbBitReader {
	readonly #buffer: Buffer;
	#position = 0;
	#bits = 0;
	#available = 0;

	constructor(buffer: Buffer) {
		this.#buffer = buffer;
	}

	getBits(count: number): number {
		while (this.#available < count) {
			if (this.#position >= this.#buffer.length) return -1;
			this.#bits |= (this.#buffer[this.#position++] ?? 0) << this.#available;
			this.#available += 8;
		}
		const value = this.#bits & ((1 << count) - 1);
		this.#bits >>>= count;
		this.#available -= count;
		return value;
	}

	getNextBit(): number {
		return this.getBits(1);
	}
}

/**
 * GARBro `LzssDecompress`. The payload starts with the unpacked size, followed by an LSB-first bit
 * stream: a zero bit introduces a literal byte, a one bit introduces a match whose offset is twelve
 * bits wide and whose length is three plus a four- or six-bit field. The ring buffer starts writing
 * at 0xfc0.
 */
function lzssDecompress(payload: Buffer): Buffer {
	const unpackedSize = payload.readInt32LE(0);
	if (unpackedSize < 0) throw new Error("invalid unpacked size");
	const output = Buffer.alloc(unpackedSize);
	const bits = new LsbBitReader(payload.subarray(4));
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INIT_POSITION;
	let destination = 0;
	while (destination < unpackedSize) {
		if (bits.getNextBit() === 0) {
			const value = bits.getBits(8);
			if (value < 0) break;
			output[destination++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
			continue;
		}
		const countBits =
			bits.getNextBit() === 0 ? SHORT_COUNT_BITS : LONG_COUNT_BITS;
		let offset = bits.getBits(12);
		if (offset < 0) break;
		let count = bits.getBits(countBits);
		if (count < 0) break;
		count = Math.min(count + MATCH_BASE, unpackedSize - destination);
		while (count > 0) {
			const value = frame[offset++ & FRAME_MASK] ?? 0;
			output[destination++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
			count -= 1;
		}
	}
	return output;
}

/**
 * GARBro `SdaOpener.TryOpen`. The `SA\0` signature is followed by the data offset at 4; the record
 * count is derived from the index size, and records are 0x14 bytes with a 0x10-byte name, a data
 * offset relative to the data area, and the stored size. Every payload is LZSS-compressed and starts
 * with its unpacked size, which the port reads while listing so entry sizes stay verifiable.
 */
async function readSdaIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dataOffset = header.readInt32LE(DATA_OFFSET_OFFSET);
	if (dataOffset <= INDEX_OFFSET || BigInt(dataOffset) >= source.size)
		return undefined;
	const count = Math.floor((dataOffset - INDEX_OFFSET) / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const isCg = sourcePath
		.replace(/\.[^.]*$/, "")
		.toLowerCase()
		.endsWith(CG_NAME);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		// The offset field overlaps the last four bytes of the name field, as in GARbro.
		const name = decodeCStringField(index, record, NAME_SIZE).trim();
		const offset =
			BigInt(dataOffset) + BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const packed =
			size >= 4n ? (await source.readAt(offset, 4)).readInt32LE(0) : -1;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed >= 0 ? BigInt(packed) : size,
			packedSize: size,
			compressed: true,
		});
		if (isCg) entry.metadata = { image: true };
		entries.push(entry);
	}
	return entries;
}

/** GARbro `SdaOpener.OpenEntry`: every payload is LZSS-compressed. */
const sdaEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([lzssDecompress(payload)]);
};

export const sdaSdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sdaSdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSdaIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSdaIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Squadra D SDA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: sdaEntryOpener,
});
