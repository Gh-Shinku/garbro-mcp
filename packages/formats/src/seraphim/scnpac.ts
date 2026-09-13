// Format reference: GARbro ArcFormats/Seraphim/ArcSCN.cs, classes `ScnOpener` and `Scn95Opener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decompressArchAngelLz } from "./scn-lz.js";

/** Both openers only accept a file with this exact name. */
const ARCHIVE_NAME = "SCNPAC.DAT";
const NAME_DIGITS = 5;
const SCN_COUNT_FIELD = 0;
const SCN_INDEX_START = 4;
const SCN_INDEX_RECORD_SIZE = 4;
/** A payload of one byte 0x78 marks a zlib stream that has to be inflated before the script pass. */
const ZLIB_MARKER = 0x78;
const ZLIB_HEADER_SIGNATURE = 1;
/** Signatures below this value, or with a set top byte, go through the script decompressor. */
const RAW_SIGNATURE_LIMIT = 4;
const SIGNATURE_TOP_BYTE = 0xff000000;

interface ScriptEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

function archiveNameFrom(sourcePath: string): string {
	return sourcePath.split(/[\\/]/).pop() ?? "";
}

/** `ScnOpener.TryOpen`: a count followed by one offset per script. */
async function readScnEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<ScriptEntry[] | undefined> {
	if (archiveNameFrom(sourcePath).toUpperCase() !== ARCHIVE_NAME)
		return undefined;
	if (source.size < BigInt(SCN_INDEX_START)) return undefined;
	const header = await source.readAt(0n, SCN_INDEX_START);
	const count = header.readInt32LE(SCN_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = SCN_INDEX_RECORD_SIZE * count;
	// The table holds one more word than the entry count: it closes with the end of the last script.
	if (BigInt(SCN_INDEX_START + indexSize + SCN_INDEX_RECORD_SIZE) > source.size)
		return undefined;
	const index = await source.readAt(
		BigInt(SCN_INDEX_START),
		indexSize + SCN_INDEX_RECORD_SIZE,
	);
	const entries: ScriptEntry[] = [];
	let offset = BigInt(index.readUInt32LE(0));
	if (offset < BigInt(SCN_INDEX_START + indexSize)) return undefined;
	for (let id = 0; id < count; id += 1) {
		const following = BigInt(
			index.readUInt32LE((id + 1) * SCN_INDEX_RECORD_SIZE),
		);
		if (following < offset || following > source.size) return undefined;
		entries.push({
			name: String(id).padStart(NAME_DIGITS, "0"),
			offset,
			size: following - offset,
		});
		offset = following;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** `Scn95Opener.TryOpen`: the first word is the length of the size table that follows it. */
async function readScn95Entries(
	source: ByteSource,
): Promise<ScriptEntry[] | undefined> {
	if (source.size < BigInt(SCN_INDEX_START)) return undefined;
	const header = await source.readAt(0n, SCN_INDEX_START);
	const tableSize = header.readUInt32LE(0);
	const count = Math.floor(tableSize / SCN_INDEX_RECORD_SIZE);
	if (BigInt(tableSize) >= source.size || !isSaneCount(count)) return undefined;
	const indexSize = SCN_INDEX_RECORD_SIZE * count;
	if (BigInt(SCN_INDEX_START + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(SCN_INDEX_START), indexSize);
	const entries: ScriptEntry[] = [];
	let offset = BigInt(tableSize) + BigInt(SCN_INDEX_RECORD_SIZE);
	for (let id = 0; id < count; id += 1) {
		const size = BigInt(index.readUInt32LE(id * SCN_INDEX_RECORD_SIZE));
		if (size === 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push({
			name: String(id).padStart(NAME_DIGITS, "0"),
			offset,
			size,
		});
		offset += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * `ScnOpener.OpenEntry`: a zlib layer when the payload announces one, then the script decompressor,
 * which falls back to the stored bytes when the stream does not decode.
 */
export async function unwrapSeraphimScript(
	stored: Buffer,
	skipScriptPass: boolean,
): Promise<Buffer> {
	if (
		skipScriptPass &&
		stored.length > 4 &&
		stored.readUInt32LE(0) === ZLIB_HEADER_SIGNATURE &&
		stored[4] === ZLIB_MARKER
	) {
		return inflateZlibBuffer(stored.subarray(4));
	}
	const signature = stored.length >= 4 ? stored.readUInt32LE(0) : 0;
	let current = stored;
	if (
		signature < RAW_SIGNATURE_LIMIT ||
		(signature & SIGNATURE_TOP_BYTE) !== 0
	) {
		if ((signature & 0xff) !== ZLIB_MARKER) return current;
		current = await inflateZlibBuffer(stored);
	}
	try {
		return decompressArchAngelLz(current);
	} catch {
		return stored;
	}
}

export const seraphimScnDescriptor: FormatDescriptor = {
	id: "seraphim-scn",
	name: "Seraphim engine scripts archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Seraphim/ArcSCN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const seraphimScn95Descriptor: FormatDescriptor = {
	...seraphimScnDescriptor,
	id: "seraphim-scn95",
	name: "Archangel engine scripts archive",
};

export const seraphimScnFormat: ArchiveFormat = defineFixedArchive({
	descriptor: seraphimScnDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readScnEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readScnEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim SCN index");
		return {
			entries: entries.map((entry, id) => ({
				...createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					metadata: { type: "script" },
				}),
				sizeKnown: false,
			})),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (stored.length === 0) return Readable.from([Buffer.alloc(0)]);
		return Readable.from([await unwrapSeraphimScript(stored, true)]);
	},
});

export const seraphimScn95Format: ArchiveFormat = defineFixedArchive({
	descriptor: seraphimScn95Descriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (archiveNameFrom(sourcePath).toUpperCase() !== ARCHIVE_NAME)
			return false;
		return (await readScn95Entries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readScn95Entries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Archangel SCN index");
		return {
			entries: entries.map((entry, id) => ({
				...createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					metadata: { type: "script" },
				}),
				sizeKnown: false,
			})),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([await unwrapSeraphimScript(stored, false)]);
	},
});
