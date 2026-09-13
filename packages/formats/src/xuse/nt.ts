// Format reference: GARbro ArcFormats/Xuse/ArcNT.cs, classes `BgOpener` and `HOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Xuse bitmap archives are split into equally sized records without any index. */
const BG_PREFIXES = ["bg00", "sbg"];
const BG_SMALL_SIZE = 0x4b400;
const BG_LARGE_SIZE = 0x96400;
/** The reference compares the raw first character, so only a lowercase prefix selects the larger record. */
const BG_LARGE_PREFIX = "s";
const H_PREFIX = "H";
const H_SMALL_SIZE = 0x25480;
const H_LARGE_SIZE = 0x2a700;
/** The reference compares the trailing character of the whole file name, extension included. */
const H_LARGE_SUFFIX = "W";
const NAME_DIGITS = 4;

function archiveNameFrom(sourcePath: string): string {
	return sourcePath.split(/[\\/]/).pop() ?? "";
}

/**
 * `BgOpener.TryOpen`: the file has to divide into equal records whose size depends on the name prefix.
 */
export function splitFixedRecords(
	totalSize: bigint,
	entrySize: number,
): { offset: bigint; size: bigint }[] | undefined {
	if (entrySize <= 0) return undefined;
	const size = BigInt(entrySize);
	if (totalSize === 0n || totalSize % size !== 0n) return undefined;
	const count = Number(totalSize / size);
	if (!isSaneCount(count)) return undefined;
	const entries: { offset: bigint; size: bigint }[] = [];
	for (let id = 0; id < count; id += 1)
		entries.push({ offset: BigInt(id) * size, size });
	return entries;
}

function bgRecordSize(archiveName: string): number | undefined {
	if (archiveName.length === 0) return undefined;
	const lower = archiveName.toLowerCase();
	if (!BG_PREFIXES.some((prefix) => lower.startsWith(prefix))) return undefined;
	return archiveName[0] === BG_LARGE_PREFIX ? BG_LARGE_SIZE : BG_SMALL_SIZE;
}

function hRecordSize(archiveName: string): number | undefined {
	if (!archiveName.toLowerCase().startsWith(H_PREFIX.toLowerCase()))
		return undefined;
	if (archiveName.length === 0) return undefined;
	return archiveName.endsWith(H_LARGE_SUFFIX) ? H_LARGE_SIZE : H_SMALL_SIZE;
}

function buildEntries(
	records: readonly { offset: bigint; size: bigint }[],
	archiveName: string,
): FixedEntry[] {
	return records.map((record, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(
				`${archiveName}#${String(id).padStart(NAME_DIGITS, "0")}`,
			),
			offset: record.offset,
			size: record.size,
			metadata: { type: "image" },
		}),
	);
}

async function readRecords(
	source: ByteSource,
	sourcePath: string,
	sizeFor: (archiveName: string) => number | undefined,
): Promise<FixedEntry[] | undefined> {
	const archiveName = archiveNameFrom(sourcePath);
	const entrySize = sizeFor(archiveName);
	if (entrySize === undefined) return undefined;
	const records = splitFixedRecords(source.size, entrySize);
	if (!records) return undefined;
	return buildEntries(records, archiveName);
}

export const xuseBgDescriptor: FormatDescriptor = {
	id: "xuse-bg",
	name: "Xuse bitmap archive",
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
			source: "ArcFormats/Xuse/ArcNT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const xuseHDescriptor: FormatDescriptor = {
	...xuseBgDescriptor,
	id: "xuse-h",
	name: "Xuse bitmap archive",
};

export const xuseBgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseBgDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readRecords(source, sourcePath, bgRecordSize)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readRecords(source, sourcePath, bgRecordSize);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse bitmap layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});

export const xuseHFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseHDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readRecords(source, sourcePath, hRecordSize)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readRecords(source, sourcePath, hRecordSize);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse bitmap layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
