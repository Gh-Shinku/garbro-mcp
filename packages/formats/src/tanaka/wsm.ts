// Format reference: GARBro ArcFormats/Tanaka/ArcWSM.cs, classes `Wsm2Opener`, `Wsm0Opener`, `Wsm1Opener`
// and `Wsm4Opener`, with `WaveAudio.WriteRiffHeader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
} from "../shared/fixed-archive.js";

const EXTENSION = "wsm";
/** Every version names its entries by appending this extension to the stored name. */
const AUDIO_EXTENSION = ".wav";

const WSM0_SIGNATURE = Buffer.from("WSM0", "ascii");
const WSM1_SIGNATURE = Buffer.from("WSM1", "ascii");
const WSM2_SIGNATURES = [
	Buffer.from("WSM2", "ascii"),
	Buffer.from("WSM3", "ascii"),
];
const WSM4_SIGNATURE = Buffer.from("WSM4", "ascii");

/** Versions zero and one keep their index from the start of the file and point into it per entry. */
const V0_INDEX_SIZE_OFFSET = 4;
const V0_COUNT_OFFSET = 8;
const V0_INDEX_OFFSET = 0x10;
const V0_POINTER_SIZE = 4;
/** The version one format block sits behind the name: channels, bits and the sample rate. */
const V1_CHANNELS_TAIL = 2;
const V1_BITS_TAIL = 3;
const V1_RATE_TAIL = 4;
const V1_OFFSET_TAIL = 8;
const V1_SIZE_TAIL = 12;
/** Version one's defaults when the entry stores no format: stereo, sixteen bits and 44.1 kHz. */
const DEFAULT_CHANNELS = 2;
const DEFAULT_BITS = 16;
const DEFAULT_RATE = 44100;
const BITS_PER_BYTE = 8;

/** Version two keeps its index behind a 0x40-byte head and its table in 0x20-byte records. */
const V2_INDEX_SIZE_OFFSET = 4;
const V2_COUNT_OFFSET = 0x0c;
const V2_TABLE_OFFSET_FIELD = 0x10;
const V2_TABLE_COUNT_FIELD = 0x14;
const V2_INDEX_OFFSET = 0x40;
const V2_TABLE_RECORD_SIZE = 0x20;
const V2_TABLE_OFFSET_TAIL = 0x14;
const V2_TABLE_SIZE_TAIL = 8;
const V2_TABLE_EXTRA_TAIL = 4;
const V2_VERSION_THREE = 3;
const V2_NAME_INDEX_TAIL = 3;
/** Version four stores its table in 0x24-byte records and its names at 0x1A8-byte strides. */
const V4_DATA_OFFSET_FIELD = 4;
const V4_COUNT_OFFSET = 0x0c;
const V4_TABLE_OFFSET_FIELD = 0x10;
const V4_TABLE_COUNT_FIELD = 0x14;
const V4_TABLE_RECORD_SIZE = 0x24;
const V4_NAME_OFFSET = 0x44;
const V4_NAME_SIZE = 0x40;
const V4_NAME_STRIDE = 0x1a8;
/** Names are generated with this many digits when their table entry has none. */
const GENERATED_NAME_DIGITS = 4;

/** The synthesized wave header is the canonical 44-byte RIFF layout. */
const WAV_HEADER_SIZE = 0x2c;
const WAV_DATA_SIZE_TAIL = 0x24;
const WAV_FORMAT_TAG = 1;
const WAV_FMT_SIZE = 0x10;
const WAV_DATA_FIELD = 0x28;
const WAV_BLOCK_ALIGN_OFFSET = 0x20;
const WAV_AVERAGE_OFFSET = 0x1c;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Tanaka/ArcWSM.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export interface WsmFormat {
	readonly channels: number;
	readonly bitsPerSample: number;
	readonly samplesPerSecond: number;
}

export const wsm0Descriptor: FormatDescriptor = {
	id: "tanaka-wsm0",
	name: "Tanaka Tatsuhiro's engine music archive v0",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const wsm1Descriptor: FormatDescriptor = {
	id: "tanaka-wsm1",
	name: "Tanaka Tatsuhiro's engine music archive v1",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const wsm2Descriptor: FormatDescriptor = {
	id: "tanaka-wsm2",
	name: "Tanaka Tatsuhiro's engine music archive v2",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const wsm4Descriptor: FormatDescriptor = {
	id: "tanaka-wsm4",
	name: "Tanaka Tatsuhiro's engine music archive v4",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/**
 * GARBro `WaveAudio.WriteRiffHeader`. The canonical 44-byte wave header: `RIFF`, the total size as the data
 * length plus 0x24, `WAVE`, a sixteen-byte `fmt ` chunk holding the tag, channel count, sample rate, the derived
 * average byte rate and block alignment, and finally the `data` chunk with its length.
 */
export function buildRiffHeader(format: WsmFormat, dataSize: number): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	const blockAlign = Math.trunc(
		(format.channels * format.bitsPerSample) / BITS_PER_BYTE,
	);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(dataSize + WAV_DATA_SIZE_TAIL, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 0x0c, "ascii");
	header.writeUInt32LE(WAV_FMT_SIZE, 0x10);
	header.writeUInt16LE(WAV_FORMAT_TAG, 0x14);
	header.writeUInt16LE(format.channels, 0x16);
	header.writeUInt32LE(format.samplesPerSecond, 0x18);
	header.writeUInt32LE(
		format.samplesPerSecond * blockAlign,
		WAV_AVERAGE_OFFSET,
	);
	header.writeUInt16LE(blockAlign, WAV_BLOCK_ALIGN_OFFSET);
	header.writeUInt16LE(format.bitsPerSample, 0x22);
	header.write("data", 0x24, "ascii");
	header.writeUInt32LE(dataSize, WAV_DATA_FIELD);
	return header;
}

/** Reads the entry list versions zero and one share, differing only in where the format fields come from. */
function readV1Entries(
	index: Buffer,
	count: number,
	archiveSize: bigint,
	fromEntry: boolean,
): FixedEntry[] | undefined {
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const pointer = id * V0_POINTER_SIZE + V0_INDEX_OFFSET;
		if (pointer + V0_POINTER_SIZE > index.length) return undefined;
		let position = index.readInt32LE(pointer);
		if (position < 0 || position >= index.length) return undefined;
		const nameLength = index.readUInt8(position);
		if (nameLength <= 1) return undefined;
		const name = decodeCStringField(index, position + 1, nameLength - 1);
		if (name.length === 0) return undefined;
		position += nameLength;
		if (position + V1_SIZE_TAIL + 4 > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(position + V1_OFFSET_TAIL));
		const size = BigInt(index.readUInt32LE(position + V1_SIZE_TAIL));
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		const format: WsmFormat = fromEntry
			? {
					channels: index.readUInt8(position + V1_CHANNELS_TAIL),
					bitsPerSample: index.readUInt8(position + V1_BITS_TAIL),
					samplesPerSecond: index.readUInt32LE(position + V1_RATE_TAIL),
				}
			: {
					channels: DEFAULT_CHANNELS,
					bitsPerSample: DEFAULT_BITS,
					samplesPerSecond: DEFAULT_RATE,
				};
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${name}${AUDIO_EXTENSION}`),
				offset,
				size,
				metadata: {
					inferredType: "audio",
					channels: format.channels,
					bitsPerSample: format.bitsPerSample,
					samplesPerSecond: format.samplesPerSecond,
				},
			}),
		);
	}
	return entries;
}

/** GARBro `Wsm0Opener.TryOpen`: the index spans the file's first `index_size` bytes. */
async function readWsm0Index(
	source: ByteSource,
	signature: Buffer,
	fromEntry: boolean,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(V0_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, V0_INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(signature)) return undefined;
	const indexSize = BigInt(header.readUInt32LE(V0_INDEX_SIZE_OFFSET));
	if (indexSize >= source.size) return undefined;
	const count = header.readInt32LE(V0_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const index = await source.readAt(0n, Number(indexSize));
	return readV1Entries(index, count, source.size, fromEntry);
}

/**
 * GARBro `Wsm0Opener.OpenEntry`. A payload is emitted behind a synthesized wave header, so the extracted span is
 * 0x2C bytes longer than the stored one.
 */
async function openWsmEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const format: WsmFormat = {
		channels:
			typeof entry.metadata?.channels === "number"
				? entry.metadata.channels
				: DEFAULT_CHANNELS,
		bitsPerSample:
			typeof entry.metadata?.bitsPerSample === "number"
				? entry.metadata.bitsPerSample
				: DEFAULT_BITS,
		samplesPerSecond:
			typeof entry.metadata?.samplesPerSecond === "number"
				? entry.metadata.samplesPerSecond
				: DEFAULT_RATE,
	};
	const header = buildRiffHeader(format, Number(entry.size));
	const payload = source.createReadStream(entry.offset, entry.size);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of payload) yield chunk as Buffer;
		})(),
	);
}

/**
 * GARBro `Wsm2Opener.TryOpen`. Two signatures share the layout — `WSM2` and `WSM3`, the latter adding one more
 * size word to each entry — and the index lives behind a 0x40-byte head rather than at the start of the file.
 *
 * A table of 0x20-byte records at an announced offset holds each payload's span, biased by a fixed 0x14 bytes on
 * both ends. Names come from separate records that follow the table: each names an *entry index*, and a zero
 * there means "the entry with the same number as this record". The reference then checks whether those names are
 * unique, and if they are not it prefixes every name with its two-digit position, which the port reproduces.
 */
async function readWsm2Index(
	source: ByteSource,
	signature: Buffer,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(V2_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, V2_INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(signature)) return undefined;
	const indexSize = BigInt(header.readUInt32LE(V2_INDEX_SIZE_OFFSET));
	if (indexSize >= source.size - BigInt(V2_INDEX_OFFSET)) return undefined;
	const count = header.readInt32LE(V2_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const version = (header.readUInt8(3) - 0x30) | 0;
	const tableStart = header.readInt32LE(V2_TABLE_OFFSET_FIELD);
	const tableCount = header.readInt32LE(V2_TABLE_COUNT_FIELD);
	if (tableStart < 0 || BigInt(tableStart) >= indexSize) return undefined;
	if (!isSaneCount(tableCount)) return undefined;
	const index = await source.readAt(BigInt(V2_INDEX_OFFSET), Number(indexSize));

	const spans: { offset: bigint; size: bigint }[] = [];
	let position = tableStart;
	for (let id = 0; id < tableCount; id += 1) {
		if (position + V2_TABLE_RECORD_SIZE > index.length) return undefined;
		const offset =
			BigInt(index.readUInt32LE(position)) - BigInt(V2_TABLE_OFFSET_TAIL);
		let size =
			BigInt(index.readUInt32LE(position + V2_TABLE_SIZE_TAIL)) +
			BigInt(V2_TABLE_OFFSET_TAIL);
		if (version === V2_VERSION_THREE) {
			size += BigInt(index.readUInt32LE(position + V2_TABLE_EXTRA_TAIL));
		}
		if (offset < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		spans.push({ offset, size });
		position += V2_TABLE_RECORD_SIZE;
	}

	const names = new Map<number, string>();
	let namePosition = 0;
	for (let id = 0; id < count; id += 1) {
		if (namePosition + V0_POINTER_SIZE > index.length) return undefined;
		let entryPosition = index.readInt32LE(namePosition);
		namePosition += V0_POINTER_SIZE;
		if (entryPosition < 0 || entryPosition + 2 > index.length) return undefined;
		const nameLength = index.readUInt8(entryPosition + 1);
		if (nameLength <= 2) return undefined;
		const name = decodeCStringField(index, entryPosition + 2, nameLength - 2);
		if (name.length === 0) return undefined;
		entryPosition += nameLength;
		if (entryPosition + V2_NAME_INDEX_TAIL + 1 > index.length) return undefined;
		let target = index.readUInt8(entryPosition + V2_NAME_INDEX_TAIL);
		if (target >= spans.length) return undefined;
		if (target === 0) target = id;
		names.set(target, `${name}${AUDIO_EXTENSION}`);
	}

	const entries: FixedEntry[] = [];
	for (const [id, span] of spans.entries()) {
		const name =
			names.get(id) ??
			`${String(id).padStart(GENERATED_NAME_DIGITS, "0")}${AUDIO_EXTENSION}`;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: span.offset,
				size: span.size,
				metadata: { inferredType: "audio" },
			}),
		);
	}
	if (names.size !== spans.length) {
		// The reference makes filenames unique by prepending each entry's index.
		for (const [id, entry] of entries.entries()) {
			entry.path = `${String(id).padStart(2, "0")}_${entry.path}`;
		}
	}
	return entries;
}

/**
 * GARBro `Wsm4Opener.TryOpen`. The word at 4 is the payload start rather than an index size, the count sits at
 * 0x0C, and the table has 0x24-byte records at an announced offset holding an offset and a size. Names follow at
 * 0x44 with a 0x1A8-byte stride and a 0x40-byte field, one per *count*, so a table with fewer records than the
 * count would index past its end — the reference would throw there and the port rejects the archive instead.
 * Entries are read underneath for the table's own numbering, and payloads are stored verbatim.
 */
async function readWsm4Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(V4_NAME_OFFSET)) return undefined;
	const header = await source.readAt(0n, V4_NAME_OFFSET);
	if (!header.subarray(0, 4).equals(WSM4_SIGNATURE)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(V4_DATA_OFFSET_FIELD));
	if (dataOffset >= source.size) return undefined;
	const count = header.readInt32LE(V4_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const tableOffset = header.readInt32LE(V4_TABLE_OFFSET_FIELD);
	const tableCount = header.readInt32LE(V4_TABLE_COUNT_FIELD);
	if (tableOffset < 0 || BigInt(tableOffset) >= dataOffset) return undefined;
	if (!isSaneCount(tableCount)) return undefined;
	if (tableCount < count) return undefined;

	const spans: { offset: bigint; size: bigint }[] = [];
	const tableSize = tableCount * V4_TABLE_RECORD_SIZE;
	if (BigInt(tableOffset + tableSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(tableOffset), tableSize);
	for (let id = 0; id < tableCount; id += 1) {
		const record = id * V4_TABLE_RECORD_SIZE;
		const offset = BigInt(table.readUInt32LE(record));
		const size = BigInt(table.readUInt32LE(record + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		spans.push({ offset, size });
	}

	const namesSize = (count - 1) * V4_NAME_STRIDE + V4_NAME_SIZE;
	if (BigInt(V4_NAME_OFFSET + namesSize) > source.size) return undefined;
	const names = await source.readAt(BigInt(V4_NAME_OFFSET), namesSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const span = spans[id];
		if (!span) return undefined;
		const name = decodeCStringField(names, id * V4_NAME_STRIDE, V4_NAME_SIZE);
		if (name.length === 0) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: span.offset,
				size: span.size,
				metadata: { inferredType: "audio" },
			}),
		);
	}
	return entries;
}

export const wsm0Format: ArchiveFormat = defineFixedArchive({
	descriptor: wsm0Descriptor,
	detection: { signatures: [{ bytes: WSM0_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWsm0Index(source, WSM0_SIGNATURE, false)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWsm0Index(source, WSM0_SIGNATURE, false);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka WSM0 layout");
		for (const entry of entries) entry.sizeKnown = false;
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openWsmEntry,
});

export const wsm1Format: ArchiveFormat = defineFixedArchive({
	descriptor: wsm1Descriptor,
	detection: { signatures: [{ bytes: WSM1_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWsm0Index(source, WSM1_SIGNATURE, true)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWsm0Index(source, WSM1_SIGNATURE, true);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka WSM1 layout");
		for (const entry of entries) entry.sizeKnown = false;
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openWsmEntry,
});

export const wsm2Format: ArchiveFormat = defineFixedArchive({
	descriptor: wsm2Descriptor,
	detection: { signatures: WSM2_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		const header = await source.readAt(0n, 4);
		const signature = WSM2_SIGNATURES.find((bytes) => header.equals(bytes));
		if (!signature) return false;
		return (await readWsm2Index(source, signature)) !== undefined;
	},
	async read(source: ByteSource) {
		const header = await source.readAt(0n, 4);
		const signature = WSM2_SIGNATURES.find((bytes) => header.equals(bytes));
		if (!signature)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka WSM2 layout");
		const entries = await readWsm2Index(source, signature);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka WSM2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const wsm4Format: ArchiveFormat = defineFixedArchive({
	descriptor: wsm4Descriptor,
	detection: { signatures: [{ bytes: WSM4_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWsm4Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWsm4Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka WSM4 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
