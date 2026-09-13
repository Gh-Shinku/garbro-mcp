// Format reference: GARBro ArcFormats/RealLive/ArcSEEN.cs, class `SeenOpener`.
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

const SIGNATURE = Buffer.from("PACL", "ascii");
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
const UNPACKED_SIZE_FIELD = 0x18;
const PACKED_FLAG_FIELD = 0x1c;
/** Packed entries wrap their payload in a `PACK` container. */
const PACK_SIGNATURE = Buffer.from("PACK", "ascii");
const PACK_SIZE_FIELD = 8;
const PACK_DATA_OFFSET = 0x10;

/**
 * GARbro `SeenOpener.LzDecompress`. Control bytes are consumed most-significant bit first: a set bit
 * emits one literal byte, a clear bit reads a little-endian word whose low nibble is the match length
 * minus two and whose remaining bits address the output backwards from one byte before the cursor.
 */
export function decompressSeen(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	let bits = 0;
	let mask = 0;
	let position = 0;
	while (destination < output.length) {
		mask >>= 1;
		if (mask === 0) {
			if (position >= input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated SEEN stream");
			bits = input[position] ?? 0;
			position += 1;
			mask = 0x80;
		}
		if ((bits & mask) !== 0) {
			if (position >= input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated SEEN stream");
			output[destination] = input[position] ?? 0;
			destination += 1;
			position += 1;
			continue;
		}
		if (position + 2 > input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated SEEN stream");
		const word = (input[position] ?? 0) | ((input[position + 1] ?? 0) << 8);
		position += 2;
		const count = (word & 0xf) + 2;
		const offset = word >> 4;
		const source = destination - offset - 1;
		// The reference copies without clipping and fails when the match overruns the output.
		if (source < 0 || destination + count > output.length)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SEEN match");
		for (let index = 0; index < count; index += 1) {
			output[destination] = output[source + index] ?? 0;
			destination += 1;
		}
	}
	return output;
}

/**
 * GARbro `SeenOpener.TryOpen`. The `PACL` signature is followed by a count at 0x10 and 0x20-byte
 * records from 0x20: a 0x10-byte CP932 name, the payload offset, the stored size, the unpacked size
 * and a packed flag. Records with a zero stored size are skipped, and every other record must pass
 * the reference's placement check.
 */
async function readSeenIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	if (!(await source.readAt(0n, SIGNATURE.length)).equals(SIGNATURE))
		return undefined;
	const count = (await source.readAt(BigInt(COUNT_OFFSET), 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const indexEnd = BigInt(INDEX_OFFSET + indexSize);
	if (indexEnd > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const compressed = index.readUInt32LE(record + PACKED_FLAG_FIELD) !== 0;
		if (storedSize === 0n) continue;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size: unpackedSize,
			packedSize: storedSize,
			compressed,
		});
		// The reference takes the decoded length from the PACK container, not from the index.
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/**
 * GARbro `SeenOpener.OpenEntry`. Flagged entries whose stored bytes start with `PACK` carry a signed
 * unpacked size at offset 8 and a private LZ stream from offset 0x10; everything else, including
 * flagged entries without the container signature, is emitted verbatim.
 */
const seenEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "RealLive SEEN entry"),
	);
	if (!stored.subarray(0, PACK_SIGNATURE.length).equals(PACK_SIGNATURE))
		return Readable.from([stored]);
	if (stored.length < PACK_DATA_OFFSET)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated PACK container");
	const unpackedSize = stored.readInt32LE(PACK_SIZE_FIELD);
	if (unpackedSize < 0)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PACK unpacked size");
	return Readable.from([
		decompressSeen(stored.subarray(PACK_DATA_OFFSET), unpackedSize),
	]);
};

export const seenDescriptor: FormatDescriptor = {
	id: "reallive-seen",
	name: "AVG32 engine scripts archive",
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
			source: "ArcFormats/RealLive/ArcSEEN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const seenFormat: ArchiveFormat = defineFixedArchive({
	descriptor: seenDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSeenIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSeenIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SEEN layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: seenEntryOpener,
});
