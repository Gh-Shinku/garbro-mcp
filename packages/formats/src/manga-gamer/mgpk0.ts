// Format reference: GARBro ArcFormats/MangaGamer/ArcMGPK.cs, classes `Mgpk0Opener` and `MgpkOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature spells `MGPK` as four bytes. */
const SIGNATURE = Buffer.from("MGPK", "ascii");
const EXTENSION = "pac";
const VERSION_OFFSET = 4;
const COUNT_OFFSET = 8;
/** This version's records start right behind the count and are 0x30 bytes wide. */
const INDEX_OFFSET = 0x0c;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const OFFSET_FIELD = 0x20;
/** The stored size sits at the end of the record; the word in between belongs to the newer version. */
const SIZE_FIELD = 0x2c;
/** Entries with these extensions are the ones the reference considers encrypted. */
const ENCRYPTED_EXTENSIONS = new Set(["png", "txt"]);

export const mgpk0Descriptor: FormatDescriptor = {
	id: "mangagamer-mgpk0",
	name: "MG resource archive, version 0",
	extensions: [EXTENSION],
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
			source: "ArcFormats/MangaGamer/ArcMGPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Mgpk0Opener.TryOpen`. The signature spells `MGPK` and the version word behind it must be zero, since
 * the base class serves every later version. The entry count sits at 8 and records begin at 0x0C with a
 * 0x30-byte stride: a 0x20-byte UTF-8 name field, the data offset, a word that belongs to the newer version,
 * and the stored size at the end of the record.
 *
 * The reference flags an archive as encrypted when any name carries a `png` or `txt` extension, and only then
 * looks up a key from the user's configuration. With no key configured it returns a plain archive whose payloads
 * are read verbatim, which is what this port does: the key comes from outside the archive and cannot be derived
 * from it. The same applies to the `txt` payloads, which the reference would decompress with an LZF routine once
 * a key were available; both the key scheme and that codec are left unported, so extraction here is always the
 * stored bytes.
 */
async function readMgpk0Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (header.readInt32LE(VERSION_OFFSET) !== 0) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	let encrypted = false;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameField = index.subarray(record, record + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = (
			terminator === -1 ? nameField : nameField.subarray(0, terminator)
		).toString("utf8");
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const flagged = ENCRYPTED_EXTENSIONS.has(sourceExtension(name));
		if (flagged) encrypted = true;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				...(flagged ? { encrypted: true } : {}),
				metadata: { needsUserKey: flagged },
			}),
		);
	}
	return entries;
}

export const mgpk0Format: ArchiveFormat = defineFixedArchive({
	descriptor: mgpk0Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMgpk0Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMgpk0Index(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid MG resource archive layout",
			);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				needsUserKey: entries.some(
					(entry) => entry.metadata?.needsUserKey === true,
				),
			},
		};
	},
});
