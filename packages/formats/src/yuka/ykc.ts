// Format reference: GARbro ArcFormats/Yuka/ArcYKC.cs, class `YkcOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
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

/** 'YKC0', the format signature. */
const SIGNATURE = 0x30434b59;
/** The version word is either '01' or '02' followed by two zero bytes. */
const VERSION_CP932 = 0x3130;
const VERSION_UTF8 = 0x3230;
const VERSION_FIELD = 4;
/** The index offset and its length sit behind eight unused bytes. */
const INDEX_OFFSET_FIELD = 0x10;
const INDEX_LENGTH_FIELD = 0x14;
/** Index records hold two name fields, an offset, a size and an unused word. */
const RECORD_SIZE = 0x14;
/** Names are stored at their own offsets before the index. */
const NAME_OFFSET_FIELD = 0;
const NAME_LENGTH_FIELD = 4;
const ENTRY_OFFSET_FIELD = 8;
const ENTRY_SIZE_FIELD = 0xc;
/** Scripts are encrypted from the offset stored in their header onwards. */
const SCRIPT_EXTENSION = ".yks";
const SCRIPT_MAGIC = "YKS001";
const SCRIPT_MIN_SIZE = 0x24;
const SCRIPT_VERSION_FIELD = 6;
const SCRIPT_VERSION = 1;
const SCRIPT_TEXT_OFFSET_FIELD = 0x20;
const SCRIPT_XOR = 0xaa;

interface YkcEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

async function readYkc(source: ByteSource): Promise<YkcEntry[] | undefined> {
	if (source.size < BigInt(INDEX_LENGTH_FIELD + 4)) return undefined;
	const header = Buffer.from(await source.readAt(0n, 0x18));
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const version = header.readUInt32LE(VERSION_FIELD);
	if (version !== VERSION_CP932 && version !== VERSION_UTF8) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	const indexLength = BigInt(header.readUInt32LE(INDEX_LENGTH_FIELD));
	const count = Number(indexLength / BigInt(RECORD_SIZE));
	if (indexOffset >= source.size || !isSaneCount(count)) return undefined;
	if (indexOffset + indexLength > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(indexOffset, Number(indexLength)),
	);
	const entries: YkcEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const cursor = i * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(cursor + ENTRY_OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(cursor + ENTRY_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			name: "",
			offset,
			size,
		});
	}
	// Names are read after every placement check has passed, as in the reference.
	const utf8 = version === VERSION_UTF8;
	for (const [i, entry] of entries.entries()) {
		const cursor = i * RECORD_SIZE;
		const nameOffset = BigInt(index.readUInt32LE(cursor + NAME_OFFSET_FIELD));
		const nameLength = index.readUInt32LE(cursor + NAME_LENGTH_FIELD);
		if (nameOffset + BigInt(nameLength) > source.size) return undefined;
		const raw = Buffer.from(await source.readAt(nameOffset, nameLength));
		entry.name = utf8 ? raw.toString("utf8") : decodeCp932(raw);
	}
	return entries;
}

function toFixedEntries(entries: readonly YkcEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const normalized = normalizeEntryPath(entry.name);
		return createFixedEntry({
			id,
			path: normalized.path,
			...(normalized.rawPath === undefined
				? {}
				: { rawPath: normalized.rawPath }),
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.size,
			metadata: { type: "data" },
		});
	});
}

/**
 * GARbro `YkcOpener.OpenEntry`: script payloads keep their text behind a header and xor it from the offset
 * stored at 0x20 onwards, then clear the version word. Everything else is handed out as it is stored.
 */
async function openYkcEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const isScript =
		stored.length >= SCRIPT_MIN_SIZE &&
		entry.path.toLowerCase().endsWith(SCRIPT_EXTENSION) &&
		stored.subarray(0, SCRIPT_MAGIC.length).toString("latin1") ===
			SCRIPT_MAGIC &&
		stored.readUInt16LE(SCRIPT_VERSION_FIELD) === SCRIPT_VERSION;
	if (!isScript) return Readable.from([stored]);
	const textOffset = stored.readUInt32LE(SCRIPT_TEXT_OFFSET_FIELD);
	for (let i = textOffset; i < stored.length; i += 1)
		stored[i] = (stored[i] ?? 0) ^ SCRIPT_XOR;
	stored[SCRIPT_VERSION_FIELD] = 0;
	return Readable.from([stored]);
}

export const yukaYkcDescriptor: FormatDescriptor = {
	id: "yuka-ykc",
	name: "Yuka engine resource archive",
	extensions: ["ykc", "dat"],
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
			source: "ArcFormats/Yuka/ArcYKC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const yukaYkcFormat = defineFixedArchive({
	descriptor: yukaYkcDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("YKC0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readYkc(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readYkc(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yuka layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openYkcEntry,
});
