// Format reference: GARbro ArcFormats/Foster/ArcFA2.cs, classes `Fa2Opener` and `Fa2Compression`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FA2\0", "latin1");
const FLAGS_FIELD = 4;
const INDEX_OFFSET_FIELD = 8;
const COUNT_FIELD = 0xc;
const HEADER_SIZE = 0x10;
/** The bit that marks a compressed index. */
const PACKED_INDEX_FLAG = 1;
/** Every record is 0x20 bytes: a name, a flags byte, eight unknown bytes and two sizes. */
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0xf;
const RECORD_FLAGS_FIELD = NAME_SIZE;
const PACKED_ENTRY_FLAG = 2;
const RECORD_SIZES_FIELD = NAME_SIZE + 9;
const UNPACKED_SIZE_FIELD = 0;
const SIZE_FIELD = 4;
/** Payloads are aligned to sixteen bytes and start behind the header. */
const PAYLOAD_ALIGNMENT = 0x10;
const ALIGNMENT_MASK = PAYLOAD_ALIGNMENT - 1;
/** The bit reader refills a whole 32 bit word at a time. */
const CHUNK_BITS = 32;
/** A back reference offset of 0x8FF or more ends the stream. */
const END_OFFSET = 0x8ff;
const LONG_OFFSET_BASE = 0x100;
const LADDER_SHIFTS = [1, 2, 3, 4] as const;
const COUNT_BASE = [3, 4, 5, 7, 11, 27] as const;
const COUNT_BITS = [0, 0, 1, 2, 4] as const;
const SHORT_COPY_OFFSET_BASE = 0x100;
const SHORT_COPY_LENGTH = 2;

interface Fa2Entry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	packed: boolean;
}

async function readRange(
	source: ByteSource,
	offset: number | bigint,
	length: number,
): Promise<Buffer | undefined> {
	const start = BigInt(offset);
	if (length < 0 || start < 0n) return undefined;
	if (start + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(start, length));
}

/**
 * `Fa2Compression`: the bits come from a 32 bit word that is refilled with a little endian read and consumed
 * from its most significant bit, so the four bytes of a chunk are used back to front. Control bytes and
 * literal payload bytes are read from the stream itself, which is why the reader has to track the same
 * position while it walks.
 */
export function inflateFa2(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(Math.max(outputLength, 0));
	let position = 0;
	let bits = 0;
	let available = 0;
	const fetch = (): void => {
		bits = 0;
		for (let index = 0; index < CHUNK_BITS / 8; index += 1)
			bits = (bits | ((input[position + index] ?? 0) << (8 * index))) >>> 0;
		position += CHUNK_BITS / 8;
		available = CHUNK_BITS;
	};
	const nextBit = (): number => {
		if (available === 0) fetch();
		const bit = (bits >>> (CHUNK_BITS - 1)) & 1;
		bits = (bits << 1) >>> 0;
		available -= 1;
		return bit;
	};
	const nextBits = (count: number): number => {
		let value = 0;
		let wanted = count;
		const take = Math.min(wanted, available);
		if (take > 0) {
			value = bits >>> (CHUNK_BITS - take);
			bits = (bits << take) >>> 0;
			available -= take;
			wanted -= take;
		}
		if (wanted > 0) {
			fetch();
			value = ((value << wanted) | (bits >>> (CHUNK_BITS - wanted))) >>> 0;
			bits = (bits << wanted) >>> 0;
			available -= wanted;
		}
		return value >>> 0;
	};
	const readByte = (): number => {
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	const copy = (source: number, target: number, count: number): void => {
		for (let index = 0; index < count; index += 1) {
			const from = source + index;
			if (target + index >= output.length) return;
			output[target + index] = from < 0 ? 0 : (output[from] ?? 0);
		}
	};
	let target = 0;
	while (target < output.length) {
		if (nextBit() !== 0) {
			output[target] = readByte();
			target += 1;
			continue;
		}
		if (nextBit() !== 0) {
			let offset: number;
			if (nextBit() !== 0) {
				offset = (readByte() << 3) | nextBits(3);
				offset += LONG_OFFSET_BASE;
				if (offset >= END_OFFSET) break;
			} else {
				offset = readByte();
			}
			copy(target - offset - 1, target, SHORT_COPY_LENGTH);
			target += SHORT_COPY_LENGTH;
			continue;
		}
		let offset: number;
		if (nextBit() !== 0) {
			offset = ((readByte() << (LADDER_SHIFTS[0] ?? 1)) | nextBit()) >>> 0;
		} else {
			offset = SHORT_COPY_OFFSET_BASE | readByte();
			let shift = LADDER_SHIFTS[LADDER_SHIFTS.length - 1] ?? 0;
			for (let index = 0; index < LADDER_SHIFTS.length - 1; index += 1) {
				if (nextBit() === 0) continue;
				shift = LADDER_SHIFTS[index] ?? 0;
				break;
			}
			offset = ((offset << shift) | nextBits(shift)) >>> 0;
		}
		let length = 0;
		let matched = false;
		for (let index = 0; index < COUNT_BASE.length - 1; index += 1) {
			if (nextBit() === 0) continue;
			const extra = COUNT_BITS[index] ?? 0;
			length = (COUNT_BASE[index] ?? 0) + (extra > 0 ? nextBits(extra) : 0);
			matched = true;
			break;
		}
		if (!matched)
			length = (COUNT_BASE[COUNT_BASE.length - 1] ?? 0) + readByte();
		copy(target - offset - 1, target, length);
		target += length;
	}
	return output.subarray(0, Math.min(target, output.length));
}

/**
 * GARbro `Fa2Opener.TryOpen`. The index sits at an offset from the header and holds one record per entry;
 * payload offsets are not stored but walk through the data area in sixteen byte steps.
 */
async function readFa2Index(
	source: ByteSource,
): Promise<Fa2Entry[] | undefined> {
	const header = await readRange(source, 0, HEADER_SIZE);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const packedIndex = (header[FLAGS_FIELD] ?? 0) & PACKED_INDEX_FLAG;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset > source.size) return undefined;
	const stored = await readRange(
		source,
		indexOffset,
		Number(source.size - indexOffset),
	);
	if (!stored) return undefined;
	let index: Buffer;
	try {
		index =
			packedIndex !== 0 ? inflateFa2(stored, count * RECORD_SIZE) : stored;
	} catch {
		return undefined;
	}
	if (index.length < count * RECORD_SIZE) return undefined;
	const entries: Fa2Entry[] = [];
	let dataOffset = BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		const position = id * RECORD_SIZE;
		const nameField = index.subarray(position, position + NAME_SIZE);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		const flags = index[position + RECORD_FLAGS_FIELD] ?? 0;
		const sizes = position + RECORD_SIZES_FIELD;
		const unpackedSize = BigInt(
			index.readUInt32LE(sizes + UNPACKED_SIZE_FIELD),
		);
		const size = BigInt(index.readUInt32LE(sizes + SIZE_FIELD));
		if (dataOffset + size > source.size) return undefined;
		entries.push({
			name,
			offset: dataOffset,
			size,
			unpackedSize,
			packed: (flags & PACKED_ENTRY_FLAG) !== 0,
		});
		const aligned = (size + BigInt(ALIGNMENT_MASK)) & ~BigInt(ALIGNMENT_MASK);
		dataOffset += aligned;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly Fa2Entry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const size = entry.unpackedSize > 0n ? entry.unpackedSize : entry.size;
		const fixed = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size,
			packedSize: entry.size,
			compressed: entry.packed,
			metadata: { type: "data" },
		});
		return entry.packed && entry.unpackedSize === 0n
			? { ...fixed, sizeKnown: false }
			: fixed;
	});
}

export const fa2Descriptor: FormatDescriptor = {
	id: "foster-fa2",
	name: "Foster game engine resource archive",
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
			source: "ArcFormats/Foster/ArcFA2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fa2Format = defineFixedArchive({
	descriptor: fa2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFa2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFa2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster FA2 layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		try {
			return Readable.from([inflateFa2(stored, Number(entry.size))]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster payload");
		}
	},
});
