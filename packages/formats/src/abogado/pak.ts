// Format reference: GARbro "ArcFormats/Abogado/ArcPAK.cs", classes `PakOpener` and `Fs8Archive` (Abogado
// Powers resource archive). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
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
import { KEY_TABLE, KEY_TABLE_COUNT } from "./keytable.js";

const COUNT_FIELD = 0;
const ENCRYPTION_FIELD = 2;
/** The records of the index begin behind the two words of the header. */
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x48;
const NAME_LENGTH = 0x40;
const OFFSET_FIELD = 0x40;
const SIZE_FIELD = 0x44;
/** The archives stand either as they are or with every byte of theirs put through a substitution table. */
const ENCRYPTION_NONE = 0;
const ENCRYPTION_FS8 = 1;
/** The place of the substitution table stands right behind each entry, as a thirty two bit word. */
const KEY_INDEX_SIZE = 4;

export interface AbogadoEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

export interface AbogadoIndex {
	entries: AbogadoEntry[];
	/** Whether the entries are put through a substitution table when they are opened. */
	encoded: boolean;
}

/**
 * `PakOpener.TryOpen`: a count of records and a word that says how the archive stands — nothing, or the
 * substitution of the FS8 archives — and then one record each: a name of sixty four bytes, cut at its first
 * NUL, and the place and the length of the entry. A blank name or a record that leaves the file turns the
 * whole attempt down, and the index has to fit the file as well. The measure a record is checked against is
 * the length of the whole archive, which a caller passes in because the index alone cannot tell it.
 */
export function readAbogadoIndex(
	data: Buffer,
	fileLength: bigint,
): AbogadoIndex | undefined {
	if (data.length < INDEX_OFFSET) return undefined;
	const count = data.readInt16LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const encryption = data.readInt16LE(ENCRYPTION_FIELD);
	if (encryption !== ENCRYPTION_NONE && encryption !== ENCRYPTION_FS8) {
		return undefined;
	}
	if (INDEX_OFFSET + count * RECORD_SIZE > data.length) return undefined;
	const entries: AbogadoEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		const at = INDEX_OFFSET + index * RECORD_SIZE;
		const name = decodeCStringField(data, at, NAME_LENGTH);
		if (name.trim() === "") return undefined;
		const offset = BigInt(data.readUInt32LE(at + OFFSET_FIELD));
		const size = BigInt(data.readUInt32LE(at + SIZE_FIELD));
		if (!checkPlacement(offset, size, fileLength)) return undefined;
		entries.push({ name, offset, size });
	}
	return { entries, encoded: ENCRYPTION_FS8 === encryption };
}

/** `PakOpener.FsDecrypt`: every byte of an entry is the table's entry for it. */
export function decryptFs8(data: Buffer, table: Buffer): void {
	for (let index = 0; index < data.length; index += 1) {
		data[index] = table[data[index] ?? 0] ?? 0;
	}
}

/**
 * `PakOpener.OpenEntry`: where the archive stands as it is, the entry does too. Behind every entry of an FS8
 * archive stands the number of the table it is put through, and where that number is below nothing or past the
 * tables the reference hands the entry out **as it stands** rather than failing; where the number is one of
 * them, every byte of the entry is the table's entry for it.
 */
async function openAbogadoEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	if (!entry.compressed) return Readable.from([stored]);
	const keyPosition = entry.offset + entry.size;
	if (keyPosition + BigInt(KEY_INDEX_SIZE) > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Abogado entry carries no substitution table number",
		);
	}
	const key = Buffer.from(
		await source.readAt(keyPosition, KEY_INDEX_SIZE),
	).readInt32LE(0);
	if (key < 0 || key >= KEY_TABLE_COUNT) return Readable.from([stored]);
	decryptFs8(stored, KEY_TABLE.subarray(key * 0x100, key * 0x100 + 0x100));
	return Readable.from([stored]);
}

export const abogadoPakDescriptor: FormatDescriptor = {
	id: "abogado-pak",
	name: "AbogadoPowers resource archive",
	extensions: [],
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
			source: "ArcFormats/Abogado/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The index of an archive: only the records are read, and their own lengths say how many bytes that is. */
async function readAbogado(
	source: ByteSource,
): Promise<AbogadoIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, INDEX_OFFSET));
	const count = head.readInt16LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const length = INDEX_OFFSET + count * RECORD_SIZE;
	if (BigInt(length) > source.size) return undefined;
	const records = Buffer.from(await source.readAt(0n, length));
	return readAbogadoIndex(records, source.size);
}

export const abogadoPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abogadoPakDescriptor,
	// The reference registers the word of nothing, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAbogado(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readAbogado(source);
		if (!index) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AbogadoPowers layout");
		}
		return {
			entries: index.entries.map((entry, id) =>
				createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					compressed: index.encoded,
					metadata: { type: "data" },
				}),
			),
			metadata: {
				entryCount: index.entries.length,
				encrypted: index.encoded,
			},
		};
	},
	openEntry: openAbogadoEntry,
});
