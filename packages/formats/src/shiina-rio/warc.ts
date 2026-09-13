// Format reference: GARbro ArcFormats/ShiinaRio/ArcWARC1.0.cs, classes `War0Opener` and `Ylz16Reader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("WARC 1.0", "latin1");
/** The index is read up to this size, so an archive holds at most 2048 records. */
const INDEX_LIMIT = 0xc000;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
/** Every second byte of the index is exclusive-ored with one of these values. */
const INDEX_KEY_EVEN = 0xfe;
const INDEX_KEY_ODD = 0xe5;
/** A packed payload opens with this marker, its unpacked size and an exclusive-ored stream. */
const PACKED_MARKER = "Ylz";
const PACKED_HEADER_SIZE = 8;
/** The unpacked size follows the marker, which is three bytes long, at a four byte boundary. */
const UNPACKED_SIZE_FIELD = 4;
const STREAM_KEY = 0xe6;
/** Control words are sixteen bits wide and are consumed least significant bit first. */
const CONTROL_BITS = 16;
/** The first match form copies at least two bytes from a distance of at most 256. */
const SHORT_MATCH_BASE = 2;
const SHORT_MATCH_DISTANCE = 0x100;
/** The long form keeps the distance in thirteen bits and the count in the low three bits of its second byte. */
const LONG_MATCH_DISTANCE = 0x2000;
const LONG_MATCH_BASE = 2;
const LONG_MATCH_EXTENDED_BASE = 9;

/**
 * GARbro `Ylz16Reader`. The whole stream is exclusive-ored with 0xE6 first. Control words and payload bytes share
 * one cursor: a word is read whenever the previous sixteen control bits are used up, and literals, distances and
 * extended counts are read from wherever that cursor has arrived. The reader consumes one control bit before it
 * starts decoding, and a zero extended count ends the stream, leaving the rest of the output zeroed.
 */
export function unpackYlz16(
	data: Buffer,
	unpackedSize: number,
): Buffer | undefined {
	const input = Buffer.from(data);
	for (let i = 0; i < input.length; i += 1)
		input[i] = ((input[i] ?? 0) ^ STREAM_KEY) & 0xff;
	const output = Buffer.alloc(unpackedSize);
	let source = 0;
	let control = 0;
	let available = 0;
	const nextBit = (): number | undefined => {
		const bit = control & 1;
		control >>= 1;
		available -= 1;
		if (available <= 0) {
			if (source + 2 > input.length) return undefined;
			control = (input[source] ?? 0) | ((input[source + 1] ?? 0) << 8);
			source += 2;
			available = CONTROL_BITS;
		}
		return bit;
	};

	nextBit(); // the reference primes its bit reader with one discarded bit
	let target = 0;
	while (target < unpackedSize) {
		const flag = nextBit();
		if (flag === undefined) return undefined;
		if (flag !== 0) {
			if (source >= input.length) return undefined;
			output[target] = input[source] ?? 0;
			target += 1;
			source += 1;
			continue;
		}
		const selector = nextBit();
		if (selector === undefined) return undefined;
		let count: number;
		let offset: number;
		if (selector === 0) {
			const high = nextBit();
			const low = nextBit();
			if (high === undefined || low === undefined) return undefined;
			count = ((high << 1) | low) + SHORT_MATCH_BASE;
			if (source >= input.length) return undefined;
			offset = (input[source] ?? 0) - SHORT_MATCH_DISTANCE;
			source += 1;
		} else {
			if (source + 2 > input.length) return undefined;
			const low = input[source] ?? 0;
			const high = input[source + 1] ?? 0;
			source += 2;
			offset = (low | ((high & ~7) << 5)) - LONG_MATCH_DISTANCE;
			count = high & 7;
			if (count === 0) {
				if (source >= input.length) return undefined;
				count = input[source] ?? 0;
				source += 1;
				if (count === 0) break;
				count += LONG_MATCH_EXTENDED_BASE;
			} else count += LONG_MATCH_BASE;
		}
		const from = target + offset;
		// The reference copies into a fixed-size buffer and would throw on either overflow.
		if (from < 0 || target + count > unpackedSize) return undefined;
		for (let i = 0; i < count; i += 1) {
			output[target] = output[from + i] ?? 0;
			target += 1;
		}
	}
	return output;
}

/** Decodes the index of an old ShiinaRio archive. */
function decryptIndex(index: Buffer): boolean {
	if (index.length % 2 !== 0) return false;
	for (let i = 0; i < index.length; i += 2) {
		index[i] = ((index[i] ?? 0) ^ INDEX_KEY_EVEN) & 0xff;
		index[i + 1] = ((index[i + 1] ?? 0) ^ INDEX_KEY_ODD) & 0xff;
	}
	return true;
}

/** Reports the unpacked size of a payload that opens with the packing marker. */
async function readPackedSize(
	source: ByteSource,
	offset: bigint,
	storedSize: bigint,
): Promise<bigint | undefined> {
	if (storedSize < BigInt(PACKED_HEADER_SIZE)) return undefined;
	const header = await source.readAt(offset, PACKED_HEADER_SIZE);
	if (
		header.subarray(0, PACKED_MARKER.length).toString("latin1") !==
		PACKED_MARKER
	)
		return undefined;
	return BigInt(header.readUInt32LE(UNPACKED_SIZE_FIELD));
}

/**
 * GARBro `War0Opener.TryOpen`. The index lives at the offset the header declares and is masked with a two byte
 * pattern before its records are read.
 */
async function readWarc(source: ByteSource): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(SIGNATURE.length + 4)) return undefined;
	const header = await source.readAt(0n, SIGNATURE.length + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(SIGNATURE.length));
	if (indexOffset >= source.size) return undefined;
	const available = source.size - indexOffset;
	const indexSize = Number(
		available < BigInt(INDEX_LIMIT) ? available : BigInt(INDEX_LIMIT),
	);
	const count = Math.floor(indexSize / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;
	const index = Buffer.from(await source.readAt(indexOffset, indexSize));
	if (!decryptIndex(index)) return undefined;

	const entries: FixedEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const cursor = i * RECORD_SIZE;
		const name = decodeCStringField(index, cursor, NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(cursor + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(cursor + SIZE_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const unpackedSize = await readPackedSize(source, offset, storedSize);
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset,
				size: unpackedSize ?? storedSize,
				packedSize: storedSize,
				...(unpackedSize === undefined ? {} : { compressed: true }),
			}),
		);
	}
	return entries;
}

/** GARBro `War0Opener.OpenEntry`: a payload that opens with the packing marker is an exclusive-ored Ylz stream. */
async function openWarcEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const header = await source.readAt(entry.offset, PACKED_HEADER_SIZE);
	const unpackedSize = header.readUInt32LE(UNPACKED_SIZE_FIELD);
	const data = Buffer.from(
		await source.readAt(
			entry.offset + BigInt(PACKED_HEADER_SIZE),
			Number(entry.packedSize) - PACKED_HEADER_SIZE,
		),
	);
	const decoded = unpackYlz16(data, unpackedSize);
	if (!decoded)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid ShiinaRio packed payload",
		);
	return Readable.from([decoded]);
}

export const shiinaRioWarcDescriptor: FormatDescriptor = {
	id: "shiina-rio-warc",
	name: "ShiinaRio engine resource archive",
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
			source: "ArcFormats/ShiinaRio/ArcWARC1.0.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const shiinaRioWarcFormat = defineFixedArchive({
	descriptor: shiinaRioWarcDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readWarc(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readWarc(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ShiinaRio WARC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openWarcEntry,
});
