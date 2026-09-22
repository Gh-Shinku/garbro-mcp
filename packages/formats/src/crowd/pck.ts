// Format reference: GARBro ArcFormats/Crowd/ArcPCK.cs, classes `PckOpener` and `PkwOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import {
	type ArchiveFormat,
	type ByteSource,
	decodeCp932,
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
} from "../shared/fixed-archive.js";

const ATTRIBUTION = {
	project: "GARbro",
	source: "ArcFormats/Crowd/ArcPCK.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

/** The resource archive version is gated by a count bound instead of the shared sanity check. */
const PCK_MAX_COUNT = 0xfffff;
const PCK_INDEX_START = 4;
const PCK_RECORD_SIZE = 0xc;
const PCK_OFFSET_FIELD = 4;
const PCK_SIZE_FIELD = 8;
/** Names follow the records as NUL-terminated CP932 strings inside a 260-byte window. */
const NAME_WINDOW = 260;

/**
 * GARBro `PckOpener.TryOpen`. A count opens the file, followed by 0x0C-byte records that hold a payload
 * offset and size; payloads must lie behind the index and inside the file. The entry names follow the records,
 * one NUL-terminated string per entry, and a name that fills the whole 260-byte window rejects the archive.
 */
async function readCrowdPck(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(PCK_INDEX_START)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(0);
	if (count <= 0 || count > PCK_MAX_COUNT) return undefined;
	const indexSize = BigInt(PCK_RECORD_SIZE * count);
	if (indexSize > source.size - BigInt(PCK_INDEX_START)) return undefined;

	const offsets: bigint[] = [];
	const sizes: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor = BigInt(PCK_INDEX_START) + BigInt(id * PCK_RECORD_SIZE);
		const record = await source.readAt(cursor, PCK_RECORD_SIZE);
		const offset = BigInt(record.readUInt32LE(PCK_OFFSET_FIELD));
		const storedSize = BigInt(record.readUInt32LE(PCK_SIZE_FIELD));
		// The reference compares the payload offset against the index size rather than its end offset.
		if (offset < indexSize) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		offsets.push(offset);
		sizes.push(storedSize);
	}

	const entries: FixedEntry[] = [];
	let cursor = BigInt(PCK_INDEX_START) + indexSize;
	for (let id = 0; id < count; id += 1) {
		const available = source.size - cursor;
		if (available <= 0n) return undefined;
		const window = Number(
			available > BigInt(NAME_WINDOW) ? NAME_WINDOW : available,
		);
		const buffer = await source.readAt(cursor, window);
		const terminator = buffer.indexOf(0);
		if (terminator <= 0 || terminator === window) return undefined;
		const name = decodeCp932(buffer.subarray(0, terminator));
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset: offsets[id] ?? 0n,
				size: sizes[id] ?? 0n,
				packedSize: sizes[id] ?? 0n,
			}),
		);
		cursor += BigInt(terminator + 1);
	}
	return entries;
}

const PKWV_MAGIC = Buffer.from("PKWV", "latin1");
const PKWV_INDEX_START = 8;
const PKWV_FORMAT_SIZE = 0x14;
const PKWV_ENTRY_SIZE = 0x18;
/** A RIFF header is prepended to every payload when it is opened. */
const WAVE_HEADER_SIZE = 0x2c;
const PKWV_NAME_SIZE = 0x0a;
const FORMAT_INDEX_FIELD = 0;
const NAME_FIELD = 2;
const SIZE_FIELD = 0x0c;
const OFFSET_FIELD = 0x10;

interface PkwvMetadata extends Record<string, unknown> {
	formatIndex: number;
	formatTag: number;
	channels: number;
	samplesPerSecond: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

function pkwvMetadata(entry: FixedEntry): PkwvMetadata {
	const metadata = entry.metadata ?? {};
	return {
		formatIndex: Number(metadata.formatIndex ?? 0),
		formatTag: Number(metadata.formatTag ?? 0),
		channels: Number(metadata.channels ?? 0),
		samplesPerSecond: Number(metadata.samplesPerSecond ?? 0),
		averageBytesPerSecond: Number(metadata.averageBytesPerSecond ?? 0),
		blockAlign: Number(metadata.blockAlign ?? 0),
		bitsPerSample: Number(metadata.bitsPerSample ?? 0),
	};
}

/** GARBro `WaveAudio.WriteRiffHeader`: a fixed 0x2C-byte RIFF header for the entry's format. */
function buildRiffHeader(metadata: PkwvMetadata, pcmSize: bigint): Buffer {
	const header = Buffer.alloc(WAVE_HEADER_SIZE);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(Number(BigInt(0x24) + pcmSize) >>> 0, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 0x0c, "latin1");
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(metadata.formatTag, 0x14);
	header.writeUInt16LE(metadata.channels, 0x16);
	header.writeUInt32LE(metadata.samplesPerSecond, 0x18);
	header.writeUInt32LE(metadata.averageBytesPerSecond, 0x1c);
	header.writeUInt16LE(metadata.blockAlign, 0x20);
	header.writeUInt16LE(metadata.bitsPerSample, 0x22);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(Number(pcmSize) >>> 0, 0x28);
	return header;
}

/**
 * GARBro `PkwOpener.TryOpen`. A signature opens the file, then a wave format count and an entry count. The
 * format table holds 0x14-byte wave format records and the entry table 0x18-byte records whose payload offsets
 * are relative to the end of both tables. Every payload is stored as raw PCM and gains a RIFF header when it is
 * opened, so an entry reports its stored size as packed size and that size plus 0x2C as its size.
 */
async function readCrowdPkwv(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(PKWV_INDEX_START)) return undefined;
	const header = await source.readAt(0n, PKWV_INDEX_START);
	if (!header.subarray(0, 4).equals(PKWV_MAGIC)) return undefined;
	const formatCount = header.readUInt16LE(4);
	const count = header.readUInt16LE(6);
	if (formatCount === 0 || count === 0) return undefined;
	const baseOffset = BigInt(
		PKWV_INDEX_START + formatCount * PKWV_FORMAT_SIZE + count * PKWV_ENTRY_SIZE,
	);
	if (baseOffset >= source.size) return undefined;

	const formats: PkwvMetadata[] = [];
	for (let id = 0; id < formatCount; id += 1) {
		const cursor = BigInt(PKWV_INDEX_START) + BigInt(id * PKWV_FORMAT_SIZE);
		if (cursor + BigInt(PKWV_FORMAT_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, PKWV_FORMAT_SIZE);
		formats.push({
			formatIndex: id,
			formatTag: record.readUInt16LE(0),
			channels: record.readUInt16LE(2),
			samplesPerSecond: record.readUInt32LE(4),
			averageBytesPerSecond: record.readUInt32LE(8),
			blockAlign: record.readUInt16LE(14),
			bitsPerSample: record.readUInt16LE(12),
		});
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor =
			BigInt(PKWV_INDEX_START) +
			BigInt(formatCount * PKWV_FORMAT_SIZE) +
			BigInt(id * PKWV_ENTRY_SIZE);
		if (cursor + BigInt(PKWV_ENTRY_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, PKWV_ENTRY_SIZE);
		const formatIndex = record.readUInt16LE(FORMAT_INDEX_FIELD);
		// The reference indexes the format list unchecked, so an out-of-range index declines the archive.
		const format = formats[formatIndex];
		if (!format) return undefined;
		const name = decodeCStringField(record, NAME_FIELD, PKWV_NAME_SIZE);
		const storedSize = BigInt(record.readUInt32LE(SIZE_FIELD));
		const offset = baseOffset + record.readBigInt64LE(OFFSET_FIELD);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: `${name}.wav`,
				offset,
				size: storedSize + BigInt(WAVE_HEADER_SIZE),
				packedSize: storedSize,
				compressed: true,
				metadata: { ...format, formatIndex } satisfies PkwvMetadata,
			}),
		);
	}
	return entries;
}

/** GARBro `PkwOpener.OpenEntry`: prepend the RIFF header for the entry's wave format. */
const openCrowdPkwvEntry: FixedEntryOpener = async (source, entry) => {
	const metadata = pkwvMetadata(entry);
	const header = buildRiffHeader(metadata, entry.packedSize);
	const audio = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([header, audio]);
};

export const crowdPckDescriptor: FormatDescriptor = {
	id: "crowd-pck",
	name: "Crowd engine resource archive",
	extensions: ["pck"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const crowdPkwvDescriptor: FormatDescriptor = {
	id: "crowd-pkwv",
	name: "Crowd engine audio archive",
	extensions: ["pck"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const crowdPckFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdPckDescriptor,
	detection: { signatures: [], extensionOnly: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const entries = await readCrowdPck(source);
			return entries !== undefined && entries.length > 0;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readCrowdPck(source);
		if (!entries || entries.length === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd PCK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const crowdPkwvFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdPkwvDescriptor,
	detection: { signatures: [{ bytes: PKWV_MAGIC }], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const entries = await readCrowdPkwv(source);
			return entries !== undefined && entries.length > 0;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readCrowdPkwv(source);
		if (!entries || entries.length === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd PKWV layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openCrowdPkwvEntry,
});
