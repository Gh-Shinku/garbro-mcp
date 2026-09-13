// Format reference: GARbro ArcFormats/Carriere/ArcARC.cs, classes `ArcOpener` and `ScenarioArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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

/** The first format's two-word magic. */
const ARC_SIGNATURE = Buffer.from([0x87, 0x9b, 0x94, 0x8f]);
const ARC_SECOND_WORD = Buffer.from([0x9a, 0x91, 0x9e, 0x86]);
const ARC_COUNT_FIELD = 8;
const ARC_INDEX_START = 0x0c;
const ARC_RECORD_SIZE = 0x110;
const ARC_NAME_SIZE = 0x104;

/** The script format's two-word magic: '~ARCHIVE' complement-encoded. */
const SCRIPT_SIGNATURE = Buffer.from([0xbe, 0xad, 0xbc, 0xb7]);
const SCRIPT_SECOND_WORD = Buffer.from([0xb6, 0xa9, 0xba, 0xff]);
const SCRIPT_HEADER_SIZE = 8;
/** The magic is followed by the index block's stored size at 0x08. */
const SCRIPT_PREFIX_SIZE = 12;
/** A data stream is a stored size, a flag word, an unpacked size and its payload. */
const STREAM_HEADER_SIZE = 12;
const STREAM_FLAG_XOR = 1;
const STREAM_FLAG_LZSS = 2;
/** The index of the script format uses the same fixed name block as the other format. */
const SCRIPT_RECORD_TAIL_SIZE = 8;

interface CarriereScenarioMetadata extends Record<string, unknown> {
	flags: number;
	unpackedSize: number;
}

/**
 * GARbro `ArcOpener.TryOpen`. Both words of the magic are checked, then a sane 32-bit count and
 * 0x110-byte records follow: a 0x104-byte name block, the payload offset, the unpacked size and the
 * stored size. An entry is LZSS-packed when the two sizes differ.
 */
async function readCarriereIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(ARC_INDEX_START)) return undefined;
	const header = await source.readAt(0n, ARC_INDEX_START);
	if (!header.subarray(0, 4).equals(ARC_SIGNATURE)) return undefined;
	if (!header.subarray(4, 8).equals(ARC_SECOND_WORD)) return undefined;
	const count = header.readInt32LE(ARC_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * ARC_RECORD_SIZE;
	const indexEnd = BigInt(ARC_INDEX_START + indexSize);
	if (indexEnd > source.size) return undefined;
	const index = await source.readAt(BigInt(ARC_INDEX_START), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * ARC_RECORD_SIZE;
		const name = decodeCStringField(index, record, ARC_NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(record + ARC_NAME_SIZE));
		const unpackedSize = BigInt(index.readUInt32LE(record + ARC_NAME_SIZE + 4));
		const storedSize = BigInt(index.readUInt32LE(record + ARC_NAME_SIZE + 8));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const compressed = unpackedSize !== storedSize;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: compressed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARbro `ArcOpener.OpenEntry`: packed entries run through GARbro's default LZSS variant. */
const carriereEntryOpener: FixedEntryOpener = (source, entry) => {
	if (!entry.compressed)
		return Promise.resolve(
			source.createReadStream(entry.offset, entry.packedSize),
		);
	return source
		.readAt(entry.offset, Number(entry.packedSize))
		.then((stored) => Readable.from([inflateLzssAll(stored)]));
};

/**
 * GARbro `ScenarioArcOpener.OpenDataStream`. A data stream starts with its stored size, a flag word
 * and an unpacked size, and its payload follows behind those twelve bytes. Flag 1 exclusive-ors the
 * payload with 0xFF and flag 2 runs LZSS over the result, so the exclusive-or comes first.
 */
async function readScenarioDataStream(
	source: ByteSource,
	offset: bigint,
): Promise<Buffer | undefined> {
	if (offset + BigInt(STREAM_HEADER_SIZE) > source.size) return undefined;
	const header = await source.readAt(offset, STREAM_HEADER_SIZE);
	const storedSize = BigInt(header.readUInt32LE(0));
	const flags = header.readInt32LE(4);
	if (storedSize < BigInt(STREAM_HEADER_SIZE)) return undefined;
	const payloadSize = storedSize - BigInt(STREAM_HEADER_SIZE);
	const payloadOffset = offset + BigInt(STREAM_HEADER_SIZE);
	if (!checkPlacement(payloadOffset, payloadSize, source.size))
		return undefined;
	const payload = Buffer.from(
		await source.readAt(payloadOffset, Number(payloadSize)),
	);
	if ((flags & STREAM_FLAG_XOR) !== 0)
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ 0xff;
	return (flags & STREAM_FLAG_LZSS) !== 0 ? inflateLzssAll(payload) : payload;
}

/**
 * GARbro `ScenarioArcOpener.TryOpen`. The index is itself a data stream at 0x08, and the payloads
 * start behind the whole index block. Records repeat the 0x104-byte name block of the other format,
 * followed by an offset relative to the payload area and a stored size.
 */
async function readCarriereScenarioIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(SCRIPT_PREFIX_SIZE)) return undefined;
	const prefix = await source.readAt(0n, SCRIPT_PREFIX_SIZE);
	if (!prefix.subarray(0, 4).equals(SCRIPT_SIGNATURE)) return undefined;
	if (!prefix.subarray(4, 8).equals(SCRIPT_SECOND_WORD)) return undefined;
	// The index block's stored size doubles as its length, since the payloads start behind it.
	const indexLength = BigInt(prefix.readUInt32LE(SCRIPT_HEADER_SIZE));
	const index = await readScenarioDataStream(
		source,
		BigInt(SCRIPT_HEADER_SIZE),
	);
	if (!index) return undefined;
	if (index.length < 4) return undefined;
	const count = index.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(SCRIPT_HEADER_SIZE) + indexLength;
	if (dataOffset > source.size) return undefined;

	const entries: FixedEntry[] = [];
	let cursor = 4;
	for (let id = 0; id < count; id += 1) {
		if (cursor + ARC_NAME_SIZE > index.length) return undefined;
		const name = decodeCStringField(index, cursor, ARC_NAME_SIZE);
		cursor += ARC_NAME_SIZE;
		if (cursor + SCRIPT_RECORD_TAIL_SIZE > index.length) return undefined;
		const offset = dataOffset + BigInt(index.readUInt32LE(cursor));
		const storedSize = BigInt(index.readUInt32LE(cursor + 4));
		cursor += SCRIPT_RECORD_TAIL_SIZE;
		// The reference checks the record's own size even though extraction uses the stream header.
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		// Every entry carries its own data stream header, which the reference reads while extracting.
		if (offset + BigInt(STREAM_HEADER_SIZE) > source.size) return undefined;
		const streamHeader = await source.readAt(offset, STREAM_HEADER_SIZE);
		const packedSize = BigInt(streamHeader.readUInt32LE(0));
		const flags = streamHeader.readInt32LE(4);
		const unpackedSize = streamHeader.readInt32LE(8);
		if (packedSize < BigInt(STREAM_HEADER_SIZE)) return undefined;
		const payloadSize = packedSize - BigInt(STREAM_HEADER_SIZE);
		if (
			!checkPlacement(
				offset + BigInt(STREAM_HEADER_SIZE),
				payloadSize,
				source.size,
			)
		)
			return undefined;
		const compressed = (flags & STREAM_FLAG_LZSS) !== 0;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: BigInt(unpackedSize >>> 0),
				packedSize: payloadSize,
				compressed,
				encrypted: (flags & STREAM_FLAG_XOR) !== 0,
				metadata: { flags, unpackedSize } satisfies CarriereScenarioMetadata,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARbro `ScenarioArcOpener.OpenEntry`, which decodes the entry's own data stream header. */
const carriereScenarioEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await readScenarioDataStream(source, entry.offset);
	if (!payload)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Carriere scenario data stream",
		);
	return Readable.from([payload]);
};

export const carriereArcDescriptor: FormatDescriptor = {
	id: "carriere-arc",
	name: "Carriere resource archive",
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
			source: "ArcFormats/Carriere/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const carriereArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: carriereArcDescriptor,
	detection: { signatures: [{ bytes: ARC_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCarriereIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCarriereIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Carriere layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: carriereEntryOpener,
});

export const carriereScenarioDescriptor: FormatDescriptor = {
	id: "carriere-scenario-arc",
	name: "Carriere scripts archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Carriere/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const carriereScenarioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: carriereScenarioDescriptor,
	detection: { signatures: [{ bytes: SCRIPT_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCarriereScenarioIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCarriereScenarioIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Carriere scripts layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: carriereScenarioEntryOpener,
});
