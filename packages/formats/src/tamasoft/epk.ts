// Format reference: GARBro ArcFormats/TamaSoft/ArcEPK.cs, class `PakOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	FileByteSource,
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("EPK ", "latin1");
const INDEX_START = 0x20;
const INDEX_SIZE_FIELD = 4;
const COUNT_FIELD = 0x18;
/** One index record: a name offset, eight unused bytes, a 64-bit offset and a 32-bit size. */
const RECORD_SIZE = 0x28;
const NAME_OFFSET_FIELD = 8;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x18;
/** Names are stored negated and decoded as CP932. */
const NAME_MASK = 0xff;
/** Sibling parts run from `.e01` to `.e09`. */
const MAX_PARTS = 9;
const PART_FORMAT_WIDTH = 2;

interface EpkMetadata extends Record<string, unknown> {
	arcNumber: number;
}

function epkMetadata(entry: FixedEntry): EpkMetadata {
	const metadata = entry.metadata ?? {};
	return { arcNumber: Number(metadata.arcNumber ?? 0) };
}

interface EpkRecord {
	name: string;
	offset: bigint;
	storedSize: bigint;
}

/**
 * GARBro `PakOpener.TryOpen`. A header holds the unpacked index size and the entry count; records name their
 * payload with an absolute offset into the index, and the payload offsets are virtual, continuing through the
 * sibling `.e01`…`.e09` parts of a multi-part archive.
 */
function readEpkRecords(
	header: Buffer,
	index: Buffer,
	sourceSize: bigint,
): { records: EpkRecord[]; indexSize: number } | undefined {
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexSize = (header.readUInt32LE(INDEX_SIZE_FIELD) - INDEX_START) >>> 0;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(indexSize) >= sourceSize) return undefined;
	if (BigInt(INDEX_START + indexSize) > sourceSize) return undefined;
	if (index.length < indexSize) return undefined;

	const records: EpkRecord[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor = id * RECORD_SIZE;
		if (cursor + RECORD_SIZE > indexSize) return undefined;
		const nameOffset = index.readUInt32LE(cursor + NAME_OFFSET_FIELD);
		// Names live inside the reserved index region, which is what bounds them in the reference.
		if (nameOffset < INDEX_START) return undefined;
		const relative = nameOffset - INDEX_START;
		if (relative + 4 > indexSize) return undefined;
		const nameLength = index.readInt32LE(relative);
		if (nameLength <= 0 || nameLength >= indexSize) return undefined;
		if (relative + 4 + nameLength > indexSize) return undefined;
		const name = Buffer.from(
			index.subarray(relative + 4, relative + 4 + nameLength),
		);
		for (let i = 0; i < name.length; i += 1)
			name[i] = (name[i] ?? 0) ^ NAME_MASK;
		records.push({
			name: decodeCp932(name),
			offset: index.readBigInt64LE(cursor + OFFSET_FIELD),
			storedSize: BigInt(index.readUInt32LE(cursor + SIZE_FIELD)),
		});
	}
	return { records, indexSize };
}

/** Opens the sibling parts that continue the archive's virtual offset space, in order. */
async function openParts(sourcePath: string): Promise<FileByteSource[]> {
	const directory = dirname(sourcePath);
	const base = basename(sourcePath, extname(sourcePath));
	const parts: FileByteSource[] = [];
	for (let number = 1; number <= MAX_PARTS; number += 1) {
		const name = `${base}.e${String(number).padStart(PART_FORMAT_WIDTH, "0")}`;
		const path = resolve(directory, name);
		if (!existsSync(path)) break;
		try {
			parts.push(await FileByteSource.open(path));
		} catch {
			break;
		}
	}
	return parts;
}

async function closeParts(parts: readonly FileByteSource[]): Promise<void> {
	await Promise.all(parts.map((part) => part.close().catch(() => undefined)));
}

interface EpkLayout {
	entries: FixedEntry[];
	parts: FileByteSource[];
	totalSize: bigint;
}

/**
 * Reads the index and rebases every payload offset into the part that holds it. Payload offsets are virtual:
 * the main file comes first and each part continues where the previous one ended, while the rebased offset is
 * relative to its own part.
 */
async function readEpk(
	source: ByteSource,
	sourcePath: string,
): Promise<EpkLayout | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	const indexSize = (header.readUInt32LE(INDEX_SIZE_FIELD) - INDEX_START) >>> 0;
	if (indexSize === 0 || BigInt(INDEX_START + indexSize) > source.size)
		return undefined;
	const parsed = readEpkRecords(
		header,
		Buffer.from(await source.readAt(BigInt(INDEX_START), indexSize)),
		source.size,
	);
	if (!parsed) return undefined;

	const parts = await openParts(sourcePath);
	const bounds: bigint[] = [source.size];
	let maxOffset = source.size;
	for (const part of parts) {
		maxOffset += part.size;
		bounds.push(maxOffset);
	}

	const entries: FixedEntry[] = [];
	for (const [id, record] of parsed.records.entries()) {
		if (record.offset + record.storedSize > maxOffset) {
			await closeParts(parts);
			return undefined;
		}
		// The part that holds the payload is the first whose end lies beyond the offset; -1 means the
		// reference found none, in which case it leaves the offset alone and reads from the main file.
		const arcNumber = bounds.findIndex((bound) => bound > record.offset);
		const base = arcNumber > 0 ? (bounds[arcNumber - 1] ?? 0n) : 0n;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: record.offset - base,
				size: record.storedSize,
				packedSize: record.storedSize,
				metadata: { arcNumber } satisfies EpkMetadata,
			}),
		);
	}
	return { entries, parts, totalSize: maxOffset };
}

/** Streams several streams in order, which is how the reference joins a payload that spans a part boundary. */
function concatStreams(streams: readonly Readable[]): Readable {
	return Readable.from(
		(async function* () {
			for (const stream of streams)
				for await (const chunk of stream) yield chunk;
		})(),
	);
}

class EpkArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = tamasoftEpkDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #parts: readonly FileByteSource[];

	constructor(source: ByteSource, sourcePath: string, layout: EpkLayout) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = layout.entries;
		this.#parts = layout.parts;
		this.metadata = {
			entryCount: layout.entries.length,
			partCount: layout.parts.length,
			totalSize: layout.totalSize,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const arcNumber = epkMetadata(entry).arcNumber;
		const part = arcNumber > 0 ? this.#parts[arcNumber - 1] : this.#source;
		if (!part)
			throw new GarbroError("INVALID_ARCHIVE", "Missing TamaSoft EPK part");
		if (entry.offset + entry.packedSize <= part.size)
			return part.createReadStream(entry.offset, entry.packedSize);
		const firstSize = part.size - entry.offset;
		const next = arcNumber < 0 ? undefined : this.#parts[arcNumber];
		if (!next)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"TamaSoft EPK payload spans a missing part",
			);
		return concatStreams([
			part.createReadStream(entry.offset, firstSize),
			next.createReadStream(0n, entry.packedSize - firstSize),
		]);
	}

	async close(): Promise<void> {
		await closeParts(this.#parts);
		await this.#source.close();
	}
}

export const tamasoftEpkDescriptor: FormatDescriptor = {
	id: "tamasoft-epk",
	name: "TamaSoft ADV system resource archive",
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
			source: "ArcFormats/TamaSoft/ArcEPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tamasoftEpkFormat: ArchiveFormat = {
	descriptor: tamasoftEpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			const layout = await readEpk(source, sourcePath);
			if (!layout) return false;
			await closeParts(layout.parts);
			return true;
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const layout = await readEpk(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft EPK layout");
		return new EpkArchiveHandle(source, sourcePath, layout);
	},
};
