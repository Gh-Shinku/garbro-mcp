// Format reference: GARbro ArcFormats/Circus/ArcCRM.cs
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CRXB", "ascii");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;
const NAME_OFFSET = 8;
const NAME_SIZE = 0x18;

export const crmDescriptor: FormatDescriptor = {
	id: "circus-crm",
	name: "Circus image archive",
	extensions: [],
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
			source: "ArcFormats/Circus/ArcCRM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `CrmOpener.TryOpen`. The index only stores data offsets; GARbro sorts them and derives
 * every size from the neighbouring offset, with the last entry running to the end of the file.
 * Entries that share an offset keep the size of the record that was seen last.
 */
async function readCrmIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	const byOffset = new Map<bigint, number>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const name = decodeCStringField(index, record + NAME_OFFSET, NAME_SIZE);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: 0n,
			}),
		);
		byOffset.set(offset, id);
	}

	const offsets = [...byOffset.keys()].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	for (const [position, offset] of offsets.entries()) {
		const id = byOffset.get(offset);
		if (id === undefined) continue;
		const entry = entries[id];
		if (!entry) continue;
		const next = offsets[position + 1] ?? source.size;
		const size = next - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries[id] = { ...entry, size, packedSize: size };
	}
	return entries;
}

export const crmFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crmDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCrmIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCrmIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Circus CRM layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
