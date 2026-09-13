// Format reference: GARbro ArcFormats/Xuse/ArcXuse.cs, classes `ArcOpener` and `KotoriOpener`.
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MIKO_SIGNATURES = [
	Buffer.from("MIKO", "latin1"),
	Buffer.from("XARC", "latin1"),
];
const MIKO_VERSION_FIELD = 0xa;
const MIKO_VERSION = 0x1001;
const MIKO_MODE_FIELD = 0xc;
const MIKO_COUNT_FIELD = 0x10;
const MIKO_MODE_MASK = 0xf;
const MIKO_NAMES_MARKER = Buffer.from("DFNM", "latin1");
const MIKO_NAMES_MARKER_OFFSET = 0x16;
const MIKO_CADR_POINTER_FIELD = 0x1a;
const MIKO_INDEX_MARKER = Buffer.from("NDIX", "latin1");
const MIKO_INDEX_OFFSET = 0x24;
const MIKO_INDEX_MARKER_SIZE = 6;
const MIKO_RECORD_SIZE = 8;
const MIKO_NAMES_MARKER2 = Buffer.from("CTIF", "latin1");
const MIKO_CADR_MARKER = Buffer.from("CADR", "latin1");
const MIKO_CADR_SIZE_FIELD = 4;
const MIKO_CADR_RECORD_SIZE = 12;
const MIKO_NAME_MARKER = 0x1001;
const MIKO_NAME_LENGTH_FIELD = 6;
const MIKO_NAME_FIELD = 0xa;
const MIKO_NAME_KEY = 0x56;
const MIKO_DATA_MARKER = Buffer.from("DATA", "latin1");
const MIKO_DATA_SIZE_FIELD = 0x18;
const MIKO_DATA_OFFSET = 0x1e;
const KOTORI_SIGNATURE = Buffer.from("KOTORI", "latin1");
/** Entry payloads spell the marker with a lowercase last letter. */
const KOTORI_ENTRY_SIGNATURE = Buffer.from("KOTORi", "latin1");
const KOTORI_MARKER_FIELD = 6;
const KOTORI_MARKER = 0x1a1a00;
const KOTORI_CODE_FIELD = 0x10;
const KOTORI_CODE = 0x0100a618;
const KOTORI_COUNT_FIELD = 0x14;
const KOTORI_INDEX_OFFSET = 0x18;
const KOTORI_RECORD_SIZE = 6;
const KOTORI_HEADER_SIZE = 0x32;
const KOTORI_KEY_SIZE = 0x10;
const KOTORI_KEY_FIELD = 0x20;
const KOTORI_NAME_DIGITS = 4;
const MAX_NAME_SIZE = 0x100;

interface XuseEntry {
	name: string;
	offset: bigint;
	size: bigint;
	packedSize: bigint;
	packed: boolean;
}

/** `ArcOpener.TryOpen`: a `MIKO` or `XARC` header over an index and a separate offset table. */
async function readMiko(source: ByteSource): Promise<XuseEntry[] | undefined> {
	if (source.size < BigInt(MIKO_INDEX_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, MIKO_INDEX_OFFSET + 4);
	if (
		!MIKO_SIGNATURES.some((signature) =>
			header.subarray(0, 4).equals(signature),
		)
	)
		return undefined;
	if (header.readUInt16LE(MIKO_VERSION_FIELD) !== MIKO_VERSION)
		return undefined;
	if ((header.readInt32LE(MIKO_MODE_FIELD) & MIKO_MODE_MASK) !== 0)
		return undefined;
	if (
		!header
			.subarray(MIKO_NAMES_MARKER_OFFSET, MIKO_NAMES_MARKER_OFFSET + 4)
			.equals(MIKO_NAMES_MARKER)
	)
		return undefined;
	const count = header.readInt32LE(MIKO_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const cadrOffset = header.readBigInt64LE(MIKO_CADR_POINTER_FIELD);
	if (cadrOffset <= 0n || cadrOffset > source.size) return undefined;
	if (
		!header
			.subarray(MIKO_INDEX_OFFSET, MIKO_INDEX_OFFSET + 4)
			.equals(MIKO_INDEX_MARKER)
	)
		return undefined;
	const indexLength = MIKO_RECORD_SIZE * count;
	const namesOffset = MIKO_INDEX_OFFSET + MIKO_INDEX_MARKER_SIZE + indexLength;
	if (BigInt(namesOffset) + 4n > source.size) return undefined;
	const index = await source.readAt(
		BigInt(MIKO_INDEX_OFFSET + MIKO_INDEX_MARKER_SIZE),
		indexLength,
	);
	const tail = await source.readAt(BigInt(namesOffset), 4);
	if (!tail.equals(MIKO_NAMES_MARKER2)) return undefined;
	const cadrSize = MIKO_CADR_SIZE_FIELD + MIKO_CADR_RECORD_SIZE * count;
	if (cadrOffset + BigInt(cadrSize) > source.size) return undefined;
	const cadr = await source.readAt(cadrOffset, cadrSize);
	if (!cadr.subarray(0, 4).equals(MIKO_CADR_MARKER)) return undefined;
	const entries: XuseEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const nameOffset = BigInt(index.readUInt32LE(id * MIKO_RECORD_SIZE));
		if (nameOffset + BigInt(MIKO_NAME_FIELD) > source.size) return undefined;
		const nameHeader = await source.readAt(nameOffset, MIKO_NAME_FIELD);
		if (nameHeader.readUInt16LE(0) !== MIKO_NAME_MARKER) return undefined;
		const nameLength = nameHeader.readUInt16LE(MIKO_NAME_LENGTH_FIELD);
		if (nameLength === 0 || nameLength > MAX_NAME_SIZE) return undefined;
		if (nameOffset + BigInt(MIKO_NAME_FIELD + nameLength) > source.size)
			return undefined;
		const rawName = Buffer.from(
			await source.readAt(nameOffset + BigInt(MIKO_NAME_FIELD), nameLength),
		);
		for (let position = 0; position < rawName.length; position += 1)
			rawName[position] = (rawName[position] ?? 0) ^ MIKO_NAME_KEY;
		const name = decodeCp932(rawName);
		const dataOffset = cadr.readBigInt64LE(
			MIKO_CADR_SIZE_FIELD + id * MIKO_CADR_RECORD_SIZE,
		);
		if (
			dataOffset <= 0n ||
			dataOffset + BigInt(MIKO_DATA_SIZE_FIELD + 4) > source.size
		)
			return undefined;
		const dataHeader = await source.readAt(
			dataOffset,
			MIKO_DATA_SIZE_FIELD + 4,
		);
		if (!dataHeader.subarray(0, 4).equals(MIKO_DATA_MARKER)) return undefined;
		const size = BigInt(dataHeader.readUInt32LE(MIKO_DATA_SIZE_FIELD));
		const payload = dataOffset + BigInt(MIKO_DATA_OFFSET);
		if (!checkPlacement(payload, size, source.size)) return undefined;
		entries.push({
			name,
			offset: payload,
			size,
			packedSize: size,
			packed: false,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** `KotoriOpener.TryOpen`: a flat offset table over keyed audio records. */
async function readKotori(
	source: ByteSource,
	sourcePath: string,
): Promise<XuseEntry[] | undefined> {
	if (source.size < BigInt(KOTORI_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, KOTORI_INDEX_OFFSET);
	if (!header.subarray(0, KOTORI_SIGNATURE.length).equals(KOTORI_SIGNATURE))
		return undefined;
	if (header.readInt32LE(KOTORI_MARKER_FIELD) !== KOTORI_MARKER)
		return undefined;
	if (header.readUInt32LE(KOTORI_CODE_FIELD) !== KOTORI_CODE) return undefined;
	const count = header.readUInt16LE(KOTORI_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const tableSize = KOTORI_RECORD_SIZE * count;
	if (BigInt(KOTORI_INDEX_OFFSET) + BigInt(tableSize) > source.size)
		return undefined;
	const table = await source.readAt(BigInt(KOTORI_INDEX_OFFSET), tableSize);
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: XuseEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * KOTORI_RECORD_SIZE));
		const next =
			id + 1 === count
				? source.size
				: BigInt(table.readUInt32LE((id + 1) * KOTORI_RECORD_SIZE));
		if (next < offset) return undefined;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const packed = size >= BigInt(KOTORI_HEADER_SIZE);
		entries.push({
			name: `${baseName}#${String(id).padStart(KOTORI_NAME_DIGITS, "0")}.ogg`,
			offset,
			size: packed ? size - BigInt(KOTORI_HEADER_SIZE) : size,
			packedSize: size,
			packed,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(
	entries: readonly XuseEntry[],
	type: string,
	unknownSize = false,
): FixedEntry[] {
	return entries.map((entry, id) => {
		const created = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.packedSize,
			compressed: entry.packed,
			metadata: { type },
		});
		return unknownSize ? { ...created, sizeKnown: false } : created;
	});
}

/** `KotoriOpener.OpenEntry`: a keyed record, or the plain payload when the marker is missing. */
export function decryptKotoriEntry(stored: Buffer): Buffer {
	if (
		stored.length < KOTORI_HEADER_SIZE ||
		!stored
			.subarray(0, KOTORI_ENTRY_SIGNATURE.length)
			.equals(KOTORI_ENTRY_SIGNATURE) ||
		stored.readInt32LE(KOTORI_MARKER_FIELD) !== KOTORI_MARKER ||
		stored.readUInt32LE(KOTORI_CODE_FIELD) !== KOTORI_CODE
	)
		return stored;
	const key = stored.subarray(
		KOTORI_KEY_FIELD,
		KOTORI_KEY_FIELD + KOTORI_KEY_SIZE,
	);
	const output = Buffer.from(stored.subarray(KOTORI_HEADER_SIZE));
	for (let position = 0; position < output.length; position += 1)
		output[position] =
			(output[position] ?? 0) ^ (key[position % KOTORI_KEY_SIZE] ?? 0);
	return output;
}

export const xuseArcDescriptor: FormatDescriptor = {
	id: "xuse-arc",
	name: "Xuse/Eternal resource archive",
	extensions: ["arc", "xarc"],
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
			source: "ArcFormats/Xuse/ArcXuse.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const xuseKotoriDescriptor: FormatDescriptor = {
	...xuseArcDescriptor,
	id: "xuse-kotori",
	name: "Xuse/Eternal audio archive",
	extensions: ["bin"],
};

export const xuseArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseArcDescriptor,
	detection: { signatures: MIKO_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMiko(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readMiko(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse archive layout");
		return {
			entries: toFixedEntries(entries, "data"),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.packedSize))),
		]);
	},
});

export const xuseKotoriFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseKotoriDescriptor,
	detection: { signatures: [{ bytes: KOTORI_SIGNATURE.subarray(0, 4) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readKotori(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readKotori(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse audio layout");
		return {
			entries: toFixedEntries(entries, "audio", true),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		return Readable.from([decryptKotoriEntry(stored)]);
	},
});
