// Format reference: GARbro "ArcFormats/Kogado/ArcARC.cs", classes `ArcOpener`, `OvaEntry`,
// `DdsEntry`, `DdsInfo` and `ArcIndexReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const CHUNK_HEADER_SIZE = 0x0c;
const FILENAMES_OFFSET = 0x10;
/** The reference allows entries to run this far past the end of the archive. */
const PLACEMENT_SLACK = 0x14n;
const SECTION_HEADER_SIZE = 0x10;

interface DdsInfo {
	flags: number;
	width: number;
	height: number;
	bpp: number;
}

interface KogadoEntry {
	name: string;
	offset: bigint;
	/** Stored size of the payload. */
	storedSize: number;
	/** Declared size of the extracted stream. */
	unpackedSize: number;
	/** Inline header that is prepended to the extracted payload. */
	header?: Buffer;
	dds?: DdsInfo;
}

interface Chunk {
	data: Buffer;
	size: number;
}

/**
 * `ArcIndexReader.ReadChunk`: a size, a type and an unpacked size, followed by an XOR 0xFF masked
 * LZSS stream. `size` covers the twelve byte chunk header.
 */
async function readChunk(
	source: ByteSource,
	offset: number,
): Promise<Chunk | undefined> {
	if (BigInt(offset) + BigInt(CHUNK_HEADER_SIZE) > source.size)
		return undefined;
	const header = Buffer.from(
		await source.readAt(BigInt(offset), CHUNK_HEADER_SIZE),
	);
	const size = header.readInt32LE(0);
	const unpackedSize = header.readInt32LE(8);
	if (size <= CHUNK_HEADER_SIZE || unpackedSize <= 0) return undefined;
	if (BigInt(offset) + BigInt(size) > source.size) return undefined;
	const stored = Buffer.from(
		await source.readAt(
			BigInt(offset + CHUNK_HEADER_SIZE),
			size - CHUNK_HEADER_SIZE,
		),
	);
	for (let index = 0; index < stored.length; index += 1)
		stored[index] = (stored[index] ?? 0) ^ 0xff;
	let data: Buffer;
	try {
		data = inflateLzss(stored, { outputLength: unpackedSize });
	} catch {
		return undefined;
	}
	return { data, size };
}

/** `ArcIndexReader.ReadFileName`: a NUL terminated UTF-16LE name at a byte offset into the blob. */
function readUtf16Name(blob: Buffer, offset: number): string | undefined {
	if (offset < 0 || offset >= blob.length) return undefined;
	let end = offset;
	while (end + 1 < blob.length) {
		if (blob[end] === 0 && blob[end + 1] === 0) break;
		end += 2;
	}
	return blob.toString("utf16le", offset, Math.min(end, blob.length));
}

interface SectionReader {
	index: Buffer;
	names: Buffer;
	namePos: number;
	count: number;
}

function readName(reader: SectionReader, entry: number): string | undefined {
	const nameOffset = reader.index.readInt32LE(reader.namePos + 4 * entry);
	return readUtf16Name(reader.names, nameOffset);
}

function entriesOfSections(
	index: Buffer,
	names: Buffer,
): KogadoEntry[] | undefined {
	if (index.length < 4) return undefined;
	const sectionCount = index.readInt32LE(0);
	if (!isSaneCount(sectionCount)) return undefined;
	const entries: KogadoEntry[] = [];
	let position = 4;
	for (let section = 0; section < sectionCount; section += 1) {
		if (position + SECTION_HEADER_SIZE > index.length) return undefined;
		const kind = index.toString("latin1", position, position + 4);
		const count = index.readInt32LE(position + 8);
		const sectionSize = index.readInt32LE(position + 0xc);
		if (!isSaneCount(count) || sectionSize < 0) return undefined;
		const namePos = position + SECTION_HEADER_SIZE;
		const layoutPos = namePos + 4 * count;
		const reader: SectionReader = { index, names, namePos, count };
		const produced =
			kind === "DDS\0"
				? readDdsSection(reader, layoutPos)
				: kind === "OVA\0"
					? readOvaSection(reader, layoutPos)
					: readPlainSection(reader, layoutPos);
		if (!produced) return undefined;
		entries.push(...produced);
		position += SECTION_HEADER_SIZE + sectionSize;
	}
	return entries;
}

function readPlainSection(
	reader: SectionReader,
	layoutPos: number,
): KogadoEntry[] | undefined {
	if (layoutPos + reader.count * 0x10 > reader.index.length) return undefined;
	const entries: KogadoEntry[] = [];
	for (let entry = 0; entry < reader.count; entry += 1) {
		const name = readName(reader, entry);
		if (name === undefined) return undefined;
		const layout = layoutPos + entry * 0x10;
		entries.push({
			name,
			offset: BigInt(reader.index.readUInt32LE(layout)),
			storedSize: reader.index.readUInt32LE(layout + 4),
			unpackedSize: reader.index.readUInt32LE(layout + 0xc),
		});
	}
	return entries;
}

function readDdsSection(
	reader: SectionReader,
	layoutPos: number,
): KogadoEntry[] | undefined {
	if (layoutPos + 4 > reader.index.length) return undefined;
	const headerCount = reader.index.readInt32LE(layoutPos);
	if (
		headerCount < 0 ||
		layoutPos + 4 + headerCount * 0xc > reader.index.length
	)
		return undefined;
	const headers: DdsInfo[] = [];
	for (let header = 0; header < headerCount; header += 1) {
		const position = layoutPos + 4 + header * 0xc;
		headers.push({
			flags: reader.index.readUInt32LE(position),
			width: reader.index.readUInt32LE(position + 4),
			height: reader.index.readUInt32LE(position + 8),
			bpp: 32,
		});
	}
	const entriesPos = layoutPos + 4 + headerCount * 0xc;
	if (entriesPos + reader.count * 0x14 > reader.index.length) return undefined;
	const entries: KogadoEntry[] = [];
	for (let entry = 0; entry < reader.count; entry += 1) {
		const name = readName(reader, entry);
		if (name === undefined) return undefined;
		const layout = entriesPos + entry * 0x14;
		const headerId = reader.index.readInt32LE(layout + 0x10);
		const dds = headers[headerId];
		if (!dds) return undefined;
		entries.push({
			name,
			offset: BigInt(reader.index.readUInt32LE(layout)),
			storedSize: reader.index.readUInt32LE(layout + 4),
			unpackedSize: reader.index.readUInt32LE(layout + 0xc),
			dds,
		});
	}
	return entries;
}

function readOvaSection(
	reader: SectionReader,
	layoutPos: number,
): KogadoEntry[] | undefined {
	if (layoutPos + 8 > reader.index.length) return undefined;
	const headerCount = reader.index.readInt32LE(layoutPos + 4);
	if (headerCount < 0) return undefined;
	const headers: Buffer[] = [];
	let position = layoutPos + 8;
	for (let header = 0; header < headerCount; header += 1) {
		if (position + 12 > reader.index.length) return undefined;
		const headerLength = reader.index.readInt32LE(position + 8);
		if (headerLength < 0 || position + 12 + headerLength > reader.index.length)
			return undefined;
		headers.push(
			reader.index.subarray(position + 12, position + 12 + headerLength),
		);
		position += 12 + headerLength;
	}
	if (position + reader.count * 0xc > reader.index.length) return undefined;
	const entries: KogadoEntry[] = [];
	for (let entry = 0; entry < reader.count; entry += 1) {
		const name = readName(reader, entry);
		if (name === undefined) return undefined;
		const layout = position + entry * 0xc;
		const headerId = reader.index.readInt32LE(layout + 8);
		const header = headers[headerId];
		if (!header) return undefined;
		const unpackedSize = reader.index.readUInt32LE(layout + 4);
		entries.push({
			name,
			offset: BigInt(reader.index.readUInt32LE(layout)),
			// The stored payload excludes the inline header.
			storedSize: unpackedSize - header.length,
			unpackedSize,
			header,
		});
	}
	return entries;
}

async function buildKogadoEntries(
	source: ByteSource,
): Promise<KogadoEntry[] | undefined> {
	if (source.size < BigInt(FILENAMES_OFFSET)) return undefined;
	const baseOffset = BigInt(
		Buffer.from(await source.readAt(0xcn, 4)).readUInt32LE(0),
	);
	let position = FILENAMES_OFFSET;
	const filenames = await readChunk(source, position);
	if (!filenames) return undefined;
	position += filenames.size;
	const index = await readChunk(source, position);
	if (!index) return undefined;
	const entries = entriesOfSections(index.data, filenames.data);
	if (!entries) return undefined;
	// Entries may run a little past the end of the archive, so the placement bound is relaxed the
	// same way the reference relaxes it.
	const limit = source.size + PLACEMENT_SLACK;
	for (const entry of entries) {
		const offset = baseOffset + entry.offset;
		if (!checkPlacement(offset, BigInt(entry.storedSize), limit))
			return undefined;
	}
	return entries.map((entry) => ({
		...entry,
		offset: baseOffset + entry.offset,
	}));
}

function metadataOf(entry: KogadoEntry): Record<string, unknown> | undefined {
	if (entry.dds) return { dds: { ...entry.dds } };
	// OVA headers live in the index chunk and are prepended to the decoded payload on extraction.
	if (entry.header) return { ovaHeader: Buffer.from(entry.header) };
	return undefined;
}

export const kogadoArcDescriptor: FormatDescriptor = {
	id: "kogado-arc",
	name: "Kogado engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Kogado/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kogadoArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kogadoArcDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0xbe, 0xad, 0xbc, 0xa8]) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await buildKogadoEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await buildKogadoEntries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kogado index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const metadata = metadataOf(entry);
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.unpackedSize),
				packedSize: BigInt(entry.storedSize),
				compressed: true,
				...(metadata ? { metadata } : {}),
			});
			// The payload is an LZSS stream, so the declared unpacked size is only an upper bound.
			return { ...created, sizeKnown: false };
		});
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.packedSize === 0n) return Readable.from([]);
		const offset = entry.offset ?? 0n;
		const available = Number(source.size) - Number(offset);
		const size = Math.min(Number(entry.packedSize), Math.max(available, 0));
		if (size <= 0) return Readable.from([]);
		const stored = Buffer.from(await source.readAt(offset, size));
		for (let index = 0; index < stored.length; index += 1)
			stored[index] = (stored[index] ?? 0) ^ 0xff;
		const decoded = inflateLzss(stored, {
			outputLength: Number(entry.size),
		});
		const metadata = entry.metadata as { ovaHeader?: Buffer } | undefined;
		const header = metadata?.ovaHeader;
		if (!header || header.length === 0)
			return Readable.from([Buffer.from(decoded)]);
		return Readable.from([Buffer.concat([header, Buffer.from(decoded)])]);
	},
});
