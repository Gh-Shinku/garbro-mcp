// Format reference: GARBro ArcFormats/Cromwell/ArcPAK.cs, class `OpkOpener`.
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
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("VoiceOggPackFile", "ascii");
const COUNT_OFFSET = 0x10;
const TABLE_OFFSET = 0x14;
const OFFSET_SIZE = 4;
const NAME_SIZE = 8;
const NAME_EXTENSION = ".ogg";

/**
 * GARbro `OpkOpener.TryOpen`. The `VoiceOggPackFile` signature is followed by a record count at 0x10
 * and an offset table of `count + 1` words at 0x14. Each entry spans from its own word to the next
 * one, and the final word doubles as the position of the name table, where 8-byte C strings follow
 * one another and gain an `.ogg` extension.
 */
async function readCromwellOpkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(TABLE_OFFSET)) return undefined;
	const header = await source.readAt(0n, TABLE_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const offsets: bigint[] = [];
	const tableLength = (count + 1) * OFFSET_SIZE;
	if (BigInt(TABLE_OFFSET + tableLength) > source.size) return undefined;
	const table = await source.readAt(BigInt(TABLE_OFFSET), tableLength);
	for (let id = 0; id <= count; id += 1) {
		offsets.push(BigInt(table.readUInt32LE(id * OFFSET_SIZE)));
	}

	const namesOffset = offsets[count] ?? 0n;
	const nameLength = count * NAME_SIZE;
	if (namesOffset < 0n || namesOffset + BigInt(nameLength) > source.size)
		return undefined;
	const names = await source.readAt(namesOffset, nameLength);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = offsets[id] ?? 0n;
		const nextOffset = offsets[id + 1] ?? 0n;
		// The reference derives extents from neighbouring offsets and rejects anything that does not
		// fit, including descending pairs whose subtraction would wrap.
		if (nextOffset < offset) return undefined;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const name = decodeCStringField(names, id * NAME_SIZE, NAME_SIZE);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${name}${NAME_EXTENSION}`),
				offset,
				size,
				packedSize: size,
				metadata: { type: "audio" },
			}),
		);
	}
	return entries;
}

/** The reference leaves payloads uncompressed and relies on the base class for raw ranges. */
const cromwellOpkEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.size);

export const cromwellOpkDescriptor: FormatDescriptor = {
	id: "cromwell-opk",
	name: "cromwell audio resource archive",
	extensions: ["opk"],
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
			source: "ArcFormats/Cromwell/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cromwellOpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cromwellOpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCromwellOpkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCromwellOpkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid cromwell OPK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: cromwellOpkEntryOpener,
});
