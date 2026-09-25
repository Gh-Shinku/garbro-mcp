// Format reference: GARbro ArcFormats/Kaguya/ArcLIN2.cs, class `Lin2Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
} from "../shared/fixed-archive.js";

/** 'LIN2' */
const SIGNATURE = Buffer.from("LIN2", "latin1");
const COUNT_FIELD = 4;
const INDEX_START = 8;
/** A record's offset, stored size and type word follow its name. */
const RECORD_TAIL_SIZE = 10;
/** Packed payloads carry their unpacked size in front of the stream. */
const PACKED_PREFIX_SIZE = 4;
/** The type word: 1 marks a packed payload, 2 an audio one. */
const TYPE_PACKED = 1;
const TYPE_AUDIO = 2;
/** Names are stored exclusive-ored with 0xFF. */
const NAME_MASK = 0xff;
/** The codec's ring buffer, whose position starts near its end. */
const FRAME_SIZE = 0x100;
const FRAME_INITIAL_POSITION = 0xef;

interface Lin2Metadata extends Record<string, unknown> {
	/** The record's type word, absent when it is zero. */
	type?: string;
}

/**
 * GARbro `Lin2Opener.UnpackLzss`. This is not the engine-default LZSS variant: control bits are read from
 * the most significant bit down, and a match's length nibble is shared between two consecutive matches —
 * the first match reads a byte and takes its low nibble, the second takes the high nibble of the same
 * byte. Lengths are biased by two and copies may overlap.
 *
 * The reference allocates the declared output and stops when the control byte runs out, which leaves the
 * remainder zeroed; a literal or match byte that runs out instead throws.
 */
export function unpackLin2(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INITIAL_POSITION;
	let source = 0;
	let destination = 0;
	let control = 0;
	let bit = 0;
	let previousCount = -1;

	const truncated = (): never => {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Truncated Kaguya LIN2 LZSS stream",
		);
	};

	while (destination < output.length) {
		bit >>= 1;
		if (bit === 0) {
			// A clean end of stream at a control boundary leaves the rest of the output zeroed.
			if (source >= input.length) break;
			control = input[source++] ?? 0;
			bit = 0x80;
		}
		if ((control & bit) !== 0) {
			if (source >= input.length) truncated();
			const value = input[source++] ?? 0;
			frame[framePosition++ & (FRAME_SIZE - 1)] = value;
			output[destination++] = value;
		} else {
			if (source >= input.length) truncated();
			let offset = input[source++] ?? 0;
			let count: number;
			if (previousCount === -1) {
				if (source >= input.length) truncated();
				previousCount = input[source++] ?? 0;
				count = previousCount & 0x0f;
			} else {
				count = previousCount >> 4;
				previousCount = -1;
			}
			count += 2;
			while (count > 0 && destination < output.length) {
				const value = frame[offset++ & (FRAME_SIZE - 1)] ?? 0;
				frame[framePosition++ & (FRAME_SIZE - 1)] = value;
				output[destination++] = value;
				count -= 1;
			}
		}
	}
	return output;
}

/**
 * GARbro `Lin2Opener.TryOpen`. Records hold a 16-bit name length, a name masked with 0xFF, the payload
 * offset, the stored size and a type word. A packed payload begins with its unpacked size, which the
 * reference reads while extracting; the port resolves it while listing so both steps agree.
 */
async function readLin2Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_START);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + 2n > source.size) return undefined;
		const nameLength = (await source.readAt(indexOffset, 2)).readUInt16LE(0);
		indexOffset += 2n;
		const recordSize = nameLength + RECORD_TAIL_SIZE;
		if (indexOffset + BigInt(recordSize) > source.size) return undefined;
		const record = Buffer.from(await source.readAt(indexOffset, recordSize));
		for (let position = 0; position < nameLength; position += 1)
			record[position] = (record[position] ?? 0) ^ NAME_MASK;
		const name = decodeCStringField(record, 0, nameLength);
		if (name.length === 0) return undefined;
		const offset = BigInt(record.readUInt32LE(nameLength));
		const storedSize = BigInt(record.readUInt32LE(nameLength + 4));
		const type = record.readInt16LE(nameLength + 8);
		indexOffset += BigInt(recordSize);

		const packed = type === TYPE_PACKED;
		if (packed) {
			if (
				storedSize < BigInt(PACKED_PREFIX_SIZE) ||
				offset + BigInt(PACKED_PREFIX_SIZE) > source.size
			)
				return undefined;
		}
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const unpackedSize = packed
			? BigInt(
					(await source.readAt(offset, PACKED_PREFIX_SIZE)).readUInt32LE(0),
				)
			: storedSize;
		const metadata: Lin2Metadata = {};
		if (type === TYPE_AUDIO) metadata.type = "audio";
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset: packed ? offset + BigInt(PACKED_PREFIX_SIZE) : offset,
				size: unpackedSize,
				packedSize: packed
					? storedSize - BigInt(PACKED_PREFIX_SIZE)
					: storedSize,
				compressed: packed,
				...(Object.keys(metadata).length > 0 ? { metadata } : {}),
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARbro `Lin2Opener.OpenEntry`: packed payloads run through the format's own LZSS variant. */
const lin2EntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([unpackLin2(Buffer.from(stored), Number(entry.size))]);
};

export const kaguyaLin2Descriptor: FormatDescriptor = {
	id: "kaguya-lin2",
	name: "KaGuYa script engine resource archive",
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
			source: "ArcFormats/Kaguya/ArcLIN2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaguyaLin2Format: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaLin2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLin2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLin2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kaguya LIN2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: lin2EntryOpener,
});
