// Format reference: GARbro "ArcFormats/Software House Parsley/ArcCG.cs", classes `CgOpener` and
// `CgV1Opener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const YANE_MARKER = "yane";
const YANE_PACK_MARKER = "pack";
const YANE_COUNT_FIELD = 8;
const YANE_FIRST_OFFSET_FIELD = 0x2c;
const YANE_INDEX_START = 0xc;
const YANE_RECORD_SIZE = 0x28;
const YANE_NAME_SIZE = 0x20;
const YANE_OFFSET_FIELD = 0x20;
const YANE_SIZE_FIELD = 0x24;
const YANE_SIGNATURES = [Buffer.from("yane", "latin1"), Buffer.alloc(4)];

const CG_COUNT_FIELD = 0;
const CG_INDEX_START = 4;
const CG_NAME_LIMIT = 0x100;
const CG_OFFSET_SIZE = 4;
/** The second Parsley variant packs its payloads; the marker names are compared like the reference. */
const CG_ARCHIVE_NAME = "CG";
const UCG_PREFIX = "UCG";

interface ParsleyEntry {
	name: string;
	offset: bigint;
	size: bigint;
	type: string | undefined;
	compressed: boolean;
}

function archiveNameFrom(sourcePath: string): string {
	return sourcePath.split(/[\\/]/).pop() ?? "";
}

/** `CgOpener.TryOpen`: a YaneSDK archive with a fixed size name record per entry. */
async function readYanepackEntries(
	source: ByteSource,
): Promise<ParsleyEntry[] | undefined> {
	if (source.size < BigInt(YANE_INDEX_START)) return undefined;
	const header = await source.readAt(0n, YANE_INDEX_START);
	const text = header.toString("latin1");
	if (text.startsWith(YANE_MARKER)) {
		const marker = await source.readAt(
			BigInt(YANE_MARKER.length),
			YANE_PACK_MARKER.length,
		);
		if (marker.toString("latin1") !== YANE_PACK_MARKER) return undefined;
	}
	if (source.size < BigInt(YANE_FIRST_OFFSET_FIELD + 4)) return undefined;
	const count = header.readInt32LE(YANE_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = (
		await source.readAt(BigInt(YANE_FIRST_OFFSET_FIELD), 4)
	).readInt32LE(0);
	if (YANE_INDEX_START + count * YANE_RECORD_SIZE !== firstOffset)
		return undefined;
	if (BigInt(YANE_INDEX_START + count * YANE_RECORD_SIZE) > source.size)
		return undefined;
	const index = await source.readAt(
		BigInt(YANE_INDEX_START),
		count * YANE_RECORD_SIZE,
	);
	const entries: ParsleyEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * YANE_RECORD_SIZE;
		const name = decodeCStringField(index, base, YANE_NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(base + YANE_OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(base + YANE_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ name, offset, size, type: undefined, compressed: false });
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** `CgV1Opener.TryOpen`: a NUL terminated name and an offset per entry, sizes derived from the next one. */
async function readCgV1Entries(
	source: ByteSource,
	sourcePath: string,
): Promise<ParsleyEntry[] | undefined> {
	if (source.size < BigInt(CG_INDEX_START)) return undefined;
	const header = await source.readAt(0n, CG_INDEX_START);
	const count = header.readInt32LE(CG_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const archiveName = archiveNameFrom(sourcePath);
	const isUcg = archiveName.toUpperCase().startsWith(UCG_PREFIX);
	const isCg = isUcg || archiveName === CG_ARCHIVE_NAME;
	let cursor = BigInt(CG_INDEX_START);
	const names: string[] = [];
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		if (cursor >= source.size) return undefined;
		const remaining = source.size - cursor;
		const limit = BigInt(CG_NAME_LIMIT + 1);
		const available = Number(remaining < limit ? remaining : limit);
		const chunk = await source.readAt(cursor, available);
		const terminator = chunk.indexOf(0);
		if (terminator <= 0 || terminator > CG_NAME_LIMIT) return undefined;
		const name = decodeCp932(chunk.subarray(0, terminator));
		cursor += BigInt(terminator + 1);
		if (cursor + BigInt(CG_OFFSET_SIZE) > source.size) return undefined;
		const offsetField = await source.readAt(cursor, CG_OFFSET_SIZE);
		const offset = BigInt(offsetField.readUInt32LE(0));
		if (offset >= source.size) return undefined;
		cursor += BigInt(CG_OFFSET_SIZE);
		names.push(name);
		offsets.push(offset);
	}
	const indexEnd = cursor;
	const entries: ParsleyEntry[] = [];
	let next = source.size;
	for (let id = count - 1; id >= 0; id -= 1) {
		const offset = offsets[id] ?? 0n;
		if (offset < indexEnd) return undefined;
		entries.push({
			name: names[id] ?? "",
			offset,
			size: next - offset,
			type: isCg ? "image" : undefined,
			compressed: isUcg,
		});
		next = offset;
	}
	entries.reverse();
	return entries;
}

function toFixedEntries(entries: readonly ParsleyEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const created = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			compressed: entry.compressed,
			...(entry.type === undefined ? {} : { metadata: { type: entry.type } }),
		});
		// Packed entries are unwrapped by the image decoder, which this port does not reproduce.
		return entry.compressed ? { ...created, sizeKnown: false } : created;
	});
}

export const parsleyYanepackDescriptor: FormatDescriptor = {
	id: "parsley-yanepack",
	name: "YaneSDK resource archive",
	extensions: ["", "dat"],
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
			source: "ArcFormats/Software House Parsley/ArcCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const parsleyCgV1Descriptor: FormatDescriptor = {
	...parsleyYanepackDescriptor,
	id: "parsley-cg-v1",
	name: "Software House Parsley CG archive",
	extensions: [],
};

export const parsleyYanepackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: parsleyYanepackDescriptor,
	detection: {
		signatures: YANE_SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readYanepackEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readYanepackEntries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YaneSDK index");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});

export const parsleyCgV1Format: ArchiveFormat = defineFixedArchive({
	descriptor: parsleyCgV1Descriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCgV1Entries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCgV1Entries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley CG index");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
