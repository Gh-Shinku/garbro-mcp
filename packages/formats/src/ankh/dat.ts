// Format reference: GARBro ArcFormats/Ankh/ArcDAT.cs, class `DatOpener`, which inherits the payload
// detection and the entry opener of `GrpOpener` in ArcFormats/Ankh/ArcGRP.cs.
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { detectFileTypes, grpEntryOpener } from "./grp.js";

const COUNT_OFFSET = 0;
const FIRST_OFFSET = 0x14;
const INDEX_START = 4;
const NAME_SIZE = 0xc;
const SIZE_OFFSET = 0xc;
const PAYLOAD_OFFSET = 0x10;
const RECORD_SIZE = 0x14;
const EXTENSION = "dat";

/**
 * GARBro `DatOpener.TryOpen`, which replaces the Ice archive's offset table with a full index. The file
 * has to carry the `.dat` extension, the entry count sits at 0x00, and the word at 0x14 has to be
 * exactly where an index of 0x14-byte records ends.
 *
 * Every record is a twelve-byte name — read up to its first zero byte, and rejected when empty — the
 * stored size at 0x0C and the payload offset at 0x10. The inherited detection pass then resolves
 * containers and types, and the inherited opener extracts them.
 */
async function readDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(FIRST_OFFSET) + 4n) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET + 4);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = header.readUInt32LE(FIRST_OFFSET);
	if (BigInt(firstOffset) !== BigInt(INDEX_START + count * RECORD_SIZE))
		return undefined;
	if (BigInt(firstOffset) > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + PAYLOAD_OFFSET));
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
	return entries;
}

export const ankhDatDescriptor: FormatDescriptor = {
	id: "ankh-dat",
	name: "Ankh resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Ankh/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ankhDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ankhDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readDatIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDatIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DAT layout");
		await detectFileTypes(source, entries);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: grpEntryOpener,
});
