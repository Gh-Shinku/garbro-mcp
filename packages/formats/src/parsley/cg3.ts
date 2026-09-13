// Format reference: GARbro "ArcFormats/Software House Parsley/ArcCG3.cs", class `DesertCgOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferByteSource,
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import { findExecutableAddressOffset } from "../shared/exe.js";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive has to be called `CG`; the reference compares only the last path component. */
const ARCHIVE_NAME = "CG";
/** File name table inside the game executable, relative to the archive directory. */
const NAME_TABLE_FILE = "../DTime.exe";
const NAME_TABLE_ADDRESS = 0x49e348;
const NAME_ENTRY_SIZE = 0x104;
const OFFSET_TABLE_START = 4;
const OFFSET_RECORD_SIZE = 4;
const NAME_DIGITS = 4;

interface DesertEntry {
	name: string | undefined;
	offset: bigint;
	size: bigint;
}

function archiveNameFrom(sourcePath: string): string {
	return sourcePath.split(/[\\/]/).pop() ?? "";
}

/** `DesertCgOpener.LookupFileNameTable`: an optional table of names stored inside the game executable. */
async function readNameTable(
	sourcePath: string,
	count: number,
): Promise<string[] | undefined> {
	const executable = await readCompanionFile(sourcePath, NAME_TABLE_FILE);
	if (!executable) return undefined;
	const source = new BufferByteSource(executable);
	const tableOffset = await findExecutableAddressOffset(
		source,
		NAME_TABLE_ADDRESS,
	);
	if (tableOffset === undefined) return undefined;
	if (tableOffset + BigInt(NAME_ENTRY_SIZE * count) > source.size)
		return undefined;
	const table = await source.readAt(tableOffset, NAME_ENTRY_SIZE * count);
	const names: string[] = [];
	for (let id = 0; id < count; id += 1) {
		const field = table.subarray(
			id * NAME_ENTRY_SIZE,
			(id + 1) * NAME_ENTRY_SIZE,
		);
		const end = field.indexOf(0);
		names.push(decodeCp932(end === -1 ? field : field.subarray(0, end)));
	}
	return names;
}

/**
 * `DesertCgOpener.TryOpen`: a plain offset table in a file called `CG`, with names optionally taken
 * from the game executable.
 */
async function readEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<DesertEntry[] | undefined> {
	if (archiveNameFrom(sourcePath).toLowerCase() !== ARCHIVE_NAME.toLowerCase())
		return undefined;
	if (source.size < BigInt(OFFSET_TABLE_START)) return undefined;
	const header = await source.readAt(0n, OFFSET_TABLE_START);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const tableSize = OFFSET_RECORD_SIZE * count;
	if (BigInt(OFFSET_TABLE_START + tableSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(OFFSET_TABLE_START), tableSize);
	const offsets: bigint[] = [];
	let lastOffset = BigInt(OFFSET_TABLE_START + tableSize);
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * OFFSET_RECORD_SIZE));
		if (offset === 0n) break;
		if (offset <= lastOffset || offset >= source.size) return undefined;
		offsets.push(offset);
		lastOffset = offset;
	}
	if (offsets.length === 0) return undefined;
	const names = await readNameTable(sourcePath, count);
	const entries: DesertEntry[] = [];
	let next = source.size;
	for (let id = offsets.length - 1; id >= 0; id -= 1) {
		const offset = offsets[id] ?? 0n;
		const name = names?.[id];
		entries.push({
			name: name === undefined || name.length === 0 ? undefined : name,
			offset,
			size: next - offset,
		});
		next = offset;
	}
	entries.reverse();
	return entries;
}

export const parsleyDesertCgDescriptor: FormatDescriptor = {
	id: "parsley-desert-cg",
	name: "Software House Parsley CG archive",
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
			source: "ArcFormats/Software House Parsley/ArcCG3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const parsleyDesertCgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: parsleyDesertCgDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley CG layout");
		const named = entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(
					entry.name ?? `CG#${String(id).padStart(NAME_DIGITS, "0")}`,
				),
				offset: entry.offset,
				size: entry.size,
				metadata: { type: "image" },
			}),
		);
		return { entries: named, metadata: { entryCount: named.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
