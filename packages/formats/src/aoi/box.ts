// Format reference: GARBro ArcFormats/Aoi/ArcBOX.cs, classes `BoxOpener`, `AoiMyOpener` and
// `AoiMyUnicodeOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
const INDEX_OFFSET = 0x10;
const WORD_SIZE = 4;

const BOX_SIGNATURE = Buffer.from("AOIB", "ascii");
/** Every version announces itself with a four-byte tag right behind the signature, and each pair of versions
 * shares the single key byte the script payloads are exclusive-ored with. */
const VERSION_TAGS = [
	{ tag: "X10", version: 10 },
	{ tag: "X12", version: 12 },
	{ tag: "OX7\u0000", version: 7 },
	{ tag: "OX6\u0000", version: 6 },
	{ tag: "OX5 ", version: 5 },
	{ tag: "OX4 ", version: 4 },
] as const;
const VERSION_KEYS = new Map<number, number>([
	[4, 0xad],
	[5, 0xad],
	[6, 0xb4],
	[7, 0xb4],
	[10, 0xb2],
	[12, 0xa5],
]);
/** Versions above five keep their names in the records; the older ones use an offset ladder. */
const NAMED_VERSION_MINIMUM = 6;
const LADDER_NAME_DIGITS = 2;
const LADDER_NAME_EXTENSION = ".evt";

const AOIMY_SIGNATURE = Buffer.from("AOIM", "ascii");
const AOIMY_TAG = "Y01\u0000";
const BIG_ENDIAN_NAME_SIZE = 0x10;
const BIG_ENDIAN_RECORD_SIZE = 0x18;

const UNICODE_SIGNATURE = Buffer.from("A\u0000O\u0000", "latin1");
/** The unicode variant repeats its own tag as UTF-16 in the first sixteen bytes. */
const UNICODE_TAG = Buffer.from("AOIMY01\u0000", "utf16le");
const UNICODE_COUNT_OFFSET = 0x10;
const UNICODE_INDEX_OFFSET = 0x14;
const UNICODE_NAME_SIZE = 0x20;
const UNICODE_OFFSET_FIELD = 0x20;
const UNICODE_SIZE_FIELD = 0x24;
const UNICODE_RECORD_SIZE = 0x28;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Aoi/ArcBOX.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const boxDescriptor: FormatDescriptor = {
	id: "aoi-box",
	name: "Aoi engine script archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: ATTRIBUTION,
};

export const aoimyDescriptor: FormatDescriptor = {
	id: "aoi-aoimy",
	name: "Aoi engine script archive, newer layout",
	extensions: ["box"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: ATTRIBUTION,
};

export const aoimyUnicodeDescriptor: FormatDescriptor = {
	id: "aoi-aoimy-unicode",
	name: "Aoi engine script archive, unicode layout",
	extensions: ["box"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: ATTRIBUTION,
};

/**
 * GARBro `AoiMyOpener.KeyFromOffset`. A payload byte's key is a single byte of a bit-mixing function of its
 * *absolute* offset: five rounds fold the offset minus a constant into itself with shifts and rotations whose
 * amounts come from successive nibbles of the offset, and the byte finally taken is the top of the last round
 * shifted right by the low nibble.
 *
 * The reference computes this in unsigned arithmetic with shifts that JavaScript masks the same way, so the
 * port uses logical shifts and folds each result back to an unsigned value.
 */
export function keyFromOffset(offset: number): number {
	const base = (offset - 0x5cc8e9d7) >>> 0;
	const v1 =
		(base +
			(0xa3371629 >>> ((offset & 0x0f) + 1)) -
			(0x5cc8e9d7 << (31 - (offset & 0x0f)))) >>>
		0;
	const v3 = (v1 << (31 - ((offset >>> 4) & 0x0f))) >>> 0;
	const v4 = v1 >>> (((offset >>> 4) & 0x0f) + 1);
	const v5 =
		(base +
			((base + v3 + v4) << (31 - ((offset >>> 8) & 0x0f))) +
			((base + v3 + v4) >>> (((offset >>> 8) & 0x0f) + 1))) >>>
		0;
	const v6 =
		(base +
			(v5 << (31 - ((offset >>> 12) & 0x0f))) +
			(v5 >>> (((offset >>> 12) & 0x0f) + 1))) >>>
		0;
	const v7 =
		(base +
			(v6 << (31 - ((offset >>> 16) & 0x0f))) +
			(v6 >>> (((offset >>> 16) & 0x0f) + 1))) >>>
		0;
	const nibble = (offset >>> 20) & 0x0f;
	const folded = (base + (v7 << (31 - nibble)) + (v7 >>> (nibble + 1))) >>> 0;
	const v9 =
		(base +
			(folded << (31 - ((offset >>> 24) & 0x0f))) +
			(folded >>> (((offset >>> 24) & 0x0f) + 1))) >>>
		0;
	const key =
		(base + (v9 << (31 - (offset >>> 28))) + (v9 >>> ((offset >>> 28) + 1))) >>>
		(offset & 0x0f);
	return key & 0xff;
}

/** Exclusive-ors a payload with the offset-derived key stream the two newer layouts use. */
export function xorWithOffsetKey(data: Buffer, startOffset: number): Buffer {
	const output = Buffer.from(data);
	let offset = startOffset;
	for (let position = 0; position < output.length; position += 1) {
		output[position] = (output[position] ?? 0) ^ keyFromOffset(offset);
		offset += 1;
	}
	return output;
}

/** Exclusive-ors a payload with a single repeated key byte, as the older layout does. */
export function xorWithByteKey(data: Buffer, key: number): Buffer {
	const output = Buffer.from(data);
	for (let position = 0; position < output.length; position += 1)
		output[position] = (output[position] ?? 0) ^ key;
	return output;
}

/**
 * GARBro `BoxOpener.TryOpen`. The signature spells `AOIB` and a four-byte tag behind it names the version, one
 * of six accepted values. The entry count sits at 8 and each version pair shares a single key byte with which
 * the script payloads are exclusive-ored.
 *
 * Version six and above keep each name in its own record, a 0x10-byte field followed by the data offset and the
 * size. The older versions use an offset ladder instead: the word at 0x10 is the first payload's offset and one
 * more word follows per entry, so a size is the gap to the next offset and the last entry runs to the end of the
 * file. Those entries have no stored names, so the reference builds them from the archive name, a two-digit
 * index and an `.evt` extension.
 */
async function readBoxIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; key: number } | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(BOX_SIGNATURE)) return undefined;
	const tag = header.toString("latin1", 4, 8);
	const found = VERSION_TAGS.find((candidate) => candidate.tag === tag);
	if (!found) return undefined;
	const key = VERSION_KEYS.get(found.version);
	if (key === undefined) return undefined;
	const count = header.readInt32LE(8);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	if (found.version >= NAMED_VERSION_MINIMUM) {
		const indexSize = count * RECORD_SIZE;
		if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
		const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
		for (let id = 0; id < count; id += 1) {
			const record = id * RECORD_SIZE;
			const nameField = index.subarray(record, record + NAME_SIZE);
			const terminator = nameField.indexOf(0);
			const name = decodeCp932(
				terminator === -1 ? nameField : nameField.subarray(0, terminator),
			);
			if (name.length === 0) return undefined;
			const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
			const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(name),
					offset,
					size,
					encrypted: true,
					metadata: { inferredType: "script", key },
				}),
			);
		}
		return { entries, key };
	}

	// The ladder: one offset word per entry behind the first.
	const indexSize = count * WORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	let next = BigInt(index.readUInt32LE(0));
	for (let id = 0; id < count; id += 1) {
		const offset = next;
		next =
			id + 1 === count
				? source.size
				: BigInt(index.readUInt32LE((id + 1) * WORD_SIZE));
		if (next < offset) return undefined;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(LADDER_NAME_DIGITS, "0")}${LADDER_NAME_EXTENSION}`,
				),
				offset,
				size,
				encrypted: true,
				metadata: { inferredType: "script", key },
			}),
		);
	}
	return { entries, key };
}

/**
 * GARBro `AoiMyOpener.TryOpen`. The signature spells `AOIM`, the tag `Y01` follows it, and both the count and
 * every record field are big-endian. Records keep the 0x18-byte stride of the older family member with the same
 * field positions, so only the byte order and the tag differ.
 */
async function readAoimyIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(AOIMY_SIGNATURE)) return undefined;
	if (header.toString("latin1", 4, 8) !== AOIMY_TAG) return undefined;
	const count = header.readInt32BE(8);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * BIG_ENDIAN_RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * BIG_ENDIAN_RECORD_SIZE;
		const nameField = index.subarray(record, record + BIG_ENDIAN_NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32BE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32BE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
				metadata: { inferredType: "script" },
			}),
		);
	}
	return entries;
}

/**
 * GARBro `AoiMyUnicodeOpener.TryOpen`. Its first sixteen bytes repeat the archive's own tag as UTF-16, which is
 * why its signature word is the two letters `A` and `O` with a null byte after each. The count is big-endian at
 * 0x10 and records begin at 0x14 with a 0x28-byte stride: a 0x20-byte UTF-16 name field that ends at a double
 * null, then a big-endian offset and size. Payloads are decrypted with the same offset-derived key as its parent.
 */
async function readAoimyUnicodeIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(UNICODE_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, UNICODE_INDEX_OFFSET);
	if (!header.subarray(0, UNICODE_TAG.length).equals(UNICODE_TAG))
		return undefined;
	const count = header.readInt32BE(UNICODE_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * UNICODE_RECORD_SIZE;
	if (BigInt(UNICODE_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(UNICODE_INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * UNICODE_RECORD_SIZE;
		const nameField = index.subarray(record, record + UNICODE_NAME_SIZE);
		let end = nameField.length;
		for (let position = 0; position + 1 < nameField.length; position += 2) {
			if (nameField[position] === 0 && nameField[position + 1] === 0) {
				end = position;
				break;
			}
		}
		const name = nameField.toString("utf16le", 0, end);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32BE(record + UNICODE_OFFSET_FIELD));
		const size = BigInt(index.readUInt32BE(record + UNICODE_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
				metadata: { inferredType: "script" },
			}),
		);
	}
	return entries;
}

async function openBoxEntry(
	source: ByteSource,
	entry: FixedEntry,
	key: number,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([xorWithByteKey(stored, key)]);
}

export const boxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: boxDescriptor,
	detection: { signatures: [{ bytes: BOX_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBoxIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readBoxIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aoi BOX layout");
		return {
			entries: parsed.entries,
			metadata: { entryCount: parsed.entries.length, key: parsed.key },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const key =
			typeof entry.metadata?.key === "number" ? entry.metadata.key : 0;
		return openBoxEntry(source, entry, key);
	},
});

export const aoimyFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aoimyDescriptor,
	detection: { signatures: [{ bytes: AOIMY_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAoimyIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAoimyIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aoi AOIMY layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = await source.readAt(entry.offset, Number(entry.size));
		return Readable.from([xorWithOffsetKey(stored, Number(entry.offset))]);
	},
});

export const aoimyUnicodeFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aoimyUnicodeDescriptor,
	detection: { signatures: [{ bytes: UNICODE_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAoimyUnicodeIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAoimyUnicodeIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Aoi AOIMY unicode layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = await source.readAt(entry.offset, Number(entry.size));
		return Readable.from([xorWithOffsetKey(stored, Number(entry.offset))]);
	},
});
