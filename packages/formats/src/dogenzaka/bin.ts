// Format reference: GARBro ArcFormats/Dogenzaka/ArcBIN.cs, classes `BinOpener` (BIN/Dogenzaka) and
// `GamedatOpener` (BIN/Dogenzaka/2).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** `BinOpener`: a count, then offset/size pairs that point at a second header. */
const BIN_INDEX_START = 4;
const BIN_RECORD_SIZE = 8;
const BIN_NAME_WIDTH = 5;
/** The second header holds a positive word, then the payload offset and the flagged stored size. */
const BIN_INNER_HEADER_SIZE = 12;
const BIN_INNER_OFFSET = 4;
const BIN_INNER_SIZE = 8;
const BIN_SIZE_MASK = 0x3fffffff;
const BIN_SIZE_SHIFT = 30;
/** A flag of two means the payload is not compressed. */
const BIN_STORED_FLAG = 2;

/** `GamedatOpener`: a count, a zero word, then cumulative end offsets. */
const GAME_INDEX_START = 4;
const GAME_NAME_WIDTH = 4;

/**
 * GARbro `BinOpener.TryOpen`. The outer index holds offset/size pairs whose offsets point at a second
 * header; that header carries a word that has to be positive, the real payload offset and a size whose
 * two high bits say whether the payload is compressed. Every offset has to sit behind the index, and
 * each range is placement-checked before and after the second header is resolved.
 *
 * The declared size is the stored one, because the reference hands compressed payloads to a stream that
 * decodes until its input ends; the unpacked size is not recorded anywhere. Payloads whose signature is
 * recognized are retyped, which also appends an extension to the generated name.
 */
async function readBinIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(BIN_INDEX_START)) return undefined;
	const header = await source.readAt(0n, BIN_INDEX_START);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexEnd = BigInt(BIN_INDEX_START + count * BIN_RECORD_SIZE);
	if (indexEnd > source.size) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const index = await source.readAt(
		BigInt(BIN_INDEX_START),
		count * BIN_RECORD_SIZE,
	);
	const records: { offset: bigint }[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * BIN_RECORD_SIZE));
		const size = BigInt(index.readUInt32LE(id * BIN_RECORD_SIZE + 4));
		if (offset < indexEnd) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		records.push({ offset });
	}

	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		if (record.offset + BigInt(BIN_INNER_HEADER_SIZE) > source.size)
			return undefined;
		const inner = await source.readAt(record.offset, BIN_INNER_HEADER_SIZE);
		if (inner.readInt32LE(0) <= 0) return undefined;
		const payloadOffset =
			record.offset + BigInt(inner.readUInt32LE(BIN_INNER_OFFSET));
		const packed = inner.readUInt32LE(BIN_INNER_SIZE);
		const storedSize = BigInt(packed & BIN_SIZE_MASK);
		if (!checkPlacement(payloadOffset, storedSize, source.size))
			return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(BIN_NAME_WIDTH, "0")}`,
			),
			offset: payloadOffset,
			size: storedSize,
			compressed: packed >>> BIN_SIZE_SHIFT !== BIN_STORED_FLAG,
		});
		if (entry.compressed) entry.sizeKnown = false;
		await applyDetectedType(source, entry);
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `GamedatOpener.TryOpen`. The count includes the leading zero word of the offset table, so the
 * entry count is one less; every following word is a cumulative payload end, relative to the table end.
 * A payload of zero length or one that falls outside the archive rejects the file, and payloads whose
 * signature is recognized are retyped.
 */
async function readGameDatIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(GAME_INDEX_START)) return undefined;
	const header = await source.readAt(0n, GAME_INDEX_START);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count - 1)) return undefined;
	const baseOffset = BigInt(GAME_INDEX_START + count * 4);
	if (baseOffset >= source.size) return undefined;

	const table = await source.readAt(BigInt(GAME_INDEX_START), count * 4);
	if (table.readUInt32LE(0) !== 0) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = baseOffset;
	for (let id = 0; id < count - 1; id += 1) {
		const nextOffset = baseOffset + BigInt(table.readUInt32LE((id + 1) * 4));
		const size = nextOffset - offset;
		if (size === 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(GAME_NAME_WIDTH, "0")}`,
			),
			offset,
			size,
		});
		await applyDetectedType(source, entry);
		entries.push(entry);
		offset = nextOffset;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `Entry.ChangeType`: the entry keeps its generated name and gains the detected extension, and
 * its type comes from the recognized signature. Only the signatures the shared helper knows are
 * recognized; the catalog-wide lookup the reference performs is not reproduced.
 */
async function applyDetectedType(
	source: ByteSource,
	entry: FixedEntry,
): Promise<void> {
	const available = Number(entry.size < 4n ? entry.size : 4n);
	if (available < 4) return;
	const signature = (await source.readAt(entry.offset, 4)).readUInt32LE(0);
	const detected = detectFileType(signature);
	if (!detected) return;
	entry.path = changeExtension(entry.path, detected.extension);
	entry.metadata = { ...entry.metadata, type: detected.type };
}

/** GARbro `BinOpener.OpenEntry`: stored payloads pass through, packed ones decode until input ends. */
const binEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([inflateLzssAll(stored)]);
};

/** The game data layout has no opener of its own, so payloads are handed out as stored. */
const rawGameEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

const attribution = {
	project: "GARbro",
	source: "ArcFormats/Dogenzaka/ArcBIN.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

export const dogenzakaBinDescriptor: FormatDescriptor = {
	id: "dogenzaka-bin",
	name: "Dogenzaka Lab audio archive",
	extensions: ["bin"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const dogenzakaGameDatDescriptor: FormatDescriptor = {
	id: "dogenzaka-bin-2",
	name: "Dogenzaka Lab archive",
	extensions: ["bin"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const dogenzakaBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dogenzakaBinDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBinIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readBinIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Dogenzaka BIN layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: binEntryOpener,
});

export const dogenzakaGameDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dogenzakaGameDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGameDatIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGameDatIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Dogenzaka game data layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: rawGameEntryOpener,
});
