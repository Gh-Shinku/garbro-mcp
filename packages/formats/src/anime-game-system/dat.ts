// Format reference: GARbro ArcFormats/AnimeGameSystem/ArcDAT.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("pack", "latin1");
const INDEX_START = 6;
/** Every record is a sixteen byte name, an offset and a size. */
const RECORD_SIZE = 0x18;

/**
 * GARbro `DatOpener.TryOpen`. The archive is a `pack` marker, a 16-bit entry count at 0x04, and an
 * index of fixed records from 0x06: a sixteen byte CP932 name, the payload offset and the stored size.
 * Every entry is placement-checked, and the whole index has to be reserved.
 *
 * GARbro encrypts archives that its user scheme lists as encrypted, keyed by file name; the default
 * scheme leaves that list and its key map empty, which is the behavior the port implements. Payloads
 * are then stored as they are.
 */
async function readAgsDatIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(4);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_START) + BigInt(indexSize) > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_START), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * RECORD_SIZE;
		const name = decodeCStringField(index, position, 0x10);
		const offset = BigInt(index.readUInt32LE(position + 0x10));
		const size = BigInt(index.readUInt32LE(position + 0x14));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const animeGameSystemDatDescriptor: FormatDescriptor = {
	id: "ags-dat",
	name: "AnimeGameSystem resource archive",
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
			source: "ArcFormats/AnimeGameSystem/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const animeGameSystemDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: animeGameSystemDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAgsDatIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAgsDatIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DAT/AGS layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
