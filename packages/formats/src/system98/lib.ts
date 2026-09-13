// Format reference: GARbro Legacy/System98/ArcLIB.cs, class `LibOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** 'Lib0' */
const LIB_SIGNATURE = Buffer.from("Lib0", "latin1");
const LIB_INDEX_START = 6;
/** The index lives in a sibling file with this extension. */
const CAT_EXTENSION = "CAT";
/** `Cat0` keeps a plain index inside the LIB, `Cat1` a packed one in the CAT. */
const CAT_PLAIN = Buffer.from("Cat0", "latin1");
const CAT_PACKED = Buffer.from("Cat1", "latin1");
const CAT_COUNT_FIELD = 4;
const CAT_INDEX_START = 6;
const RECORD_SIZE = 0x16;
/** A record is a 0x0C-byte name, a packed flag, the stored size and the offset. */
const NAME_SIZE = 0x0c;
const PACKED_FLAG_FIELD = 0x0c;
const SIZE_FIELD = 0x0e;
const OFFSET_FIELD = 0x12;
/** A packed payload is a 10-byte prefix holding its unpacked size at +6. */
const PAYLOAD_PREFIX_SIZE = 10;
const PAYLOAD_SIZE_FIELD = 6;
/** The codec's ring buffer, whose write position starts at one. */
const FRAME_SIZE = 0x1000;

interface LibMetadata extends Record<string, unknown> {
	/** The payload's declared unpacked size, which packed entries carry in front of the stream. */
	unpackedSize?: number;
}

/**
 * GARbro `LibOpener.LzssUnpack`. Control bits are read from the least significant bit up, a match reads
 * two bytes whose nibbles split into a length biased by three and a 12-bit offset, and the ring buffer
 * starts at position one. The loop stops as soon as the input runs dry at a command boundary, and the
 * number of decoded bytes is returned so that both callers can decide how much of their buffer is real.
 *
 * A match that would write past the declared output length throws, where the reference would run off the
 * end of its array.
 */
function unpackLibLzss(
	input: Buffer,
	outputLength: number,
): { data: Buffer; length: number } {
	const data = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = 1;
	let source = 0;
	let destination = 0;
	let control = 0;
	let mask = 0;
	while (destination < outputLength) {
		mask = (mask << 1) & 0xff;
		if (mask === 0) {
			if (source >= input.length) break;
			control = input[source++] ?? 0;
			mask = 1;
		}
		// The reference peeks before every command and stops when the input is exhausted.
		if (source >= input.length) break;
		if ((control & mask) !== 0) {
			const value = input[source++] ?? 0;
			frame[framePosition++ & (FRAME_SIZE - 1)] = value;
			data[destination++] = value;
		} else {
			const low = input[source++] ?? 0;
			if (source >= input.length) break;
			const high = input[source++] ?? 0;
			let count = (low & 0x0f) + 3;
			let offset = (high << 4) | (low >> 4);
			while (count > 0) {
				if (destination >= outputLength)
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"System-98 LZSS match exceeds the declared output size",
					);
				const value = frame[offset++ & (FRAME_SIZE - 1)] ?? 0;
				data[destination++] = value;
				frame[framePosition++ & (FRAME_SIZE - 1)] = value;
				count -= 1;
			}
		}
	}
	return { data, length: destination };
}

/**
 * GARbro `LibOpener.TryOpen`. The archive's index lives in a sibling `.CAT` file: `Cat0` means the
 * **LIB** itself carries the plain index at 0x06, while `Cat1` means the CAT carries an LZSS-packed one
 * behind the same offset. Records are 0x16 bytes with a 12-byte name field whose trailing whitespace is
 * trimmed, a packed flag, the stored size and the offset.
 */
async function readLibIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(LIB_INDEX_START)) return undefined;
	const header = await source.readAt(0n, LIB_INDEX_START);
	if (!header.subarray(0, 4).equals(LIB_SIGNATURE)) return undefined;

	const catName = basename(changeExtension(sourcePath, CAT_EXTENSION));
	if (catName === basename(sourcePath)) return undefined;
	const cat = await readCompanionFile(sourcePath, catName);
	if (!cat || cat.length < CAT_INDEX_START) return undefined;
	const count = cat.readInt16LE(CAT_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;

	let index: Buffer;
	if (cat.subarray(0, 4).equals(CAT_PLAIN)) {
		if (BigInt(LIB_INDEX_START + indexSize) > source.size) return undefined;
		index = Buffer.from(
			await source.readAt(BigInt(LIB_INDEX_START), indexSize),
		);
	} else if (cat.subarray(0, 4).equals(CAT_PACKED)) {
		index = unpackLibLzss(cat.subarray(CAT_INDEX_START), indexSize).data;
	} else {
		return undefined;
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE).trimEnd();
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = (index[record + PACKED_FLAG_FIELD] ?? 0) !== 0;
		if (packed) {
			if (
				storedSize < BigInt(PAYLOAD_PREFIX_SIZE) ||
				offset + BigInt(PAYLOAD_PREFIX_SIZE) > source.size
			)
				return undefined;
		}
		const unpackedSize = packed
			? BigInt(
					(await source.readAt(offset, PAYLOAD_PREFIX_SIZE)).readUInt32LE(
						PAYLOAD_SIZE_FIELD,
					),
				)
			: storedSize;
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset: packed ? offset + BigInt(PAYLOAD_PREFIX_SIZE) : offset,
				size: unpackedSize,
				packedSize: packed
					? storedSize - BigInt(PAYLOAD_PREFIX_SIZE)
					: storedSize,
				compressed: packed,
				...(packed
					? {
							metadata: {
								unpackedSize: Number(unpackedSize),
							} satisfies LibMetadata,
						}
					: {}),
			}),
		);
	}
	return entries;
}

/**
 * GARbro `LibOpener.OpenEntry`. A packed payload is decoded to the declared unpacked size, but the
 * reference returns only the bytes the stream actually produced, so a truncated stream yields a shorter
 * entry.
 */
const libEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const { data, length } = unpackLibLzss(
		Buffer.from(stored),
		Number(entry.size),
	);
	return Readable.from([data.subarray(0, length)]);
};

export const system98LibDescriptor: FormatDescriptor = {
	id: "system98-lib",
	name: "System-98 engine resource archive",
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
			source: "Legacy/System98/ArcLIB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const system98LibFormat: ArchiveFormat = defineFixedArchive({
	descriptor: system98LibDescriptor,
	detection: { signatures: [{ bytes: LIB_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLibIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readLibIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System-98 LIB layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: libEntryOpener,
});
