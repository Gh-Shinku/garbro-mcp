// Format reference: GARbro ArcFormats/EntExec/ArcCAB.cs
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

const SIGNATURE = Buffer.from("Pack", "ascii");
const FORMAT_MARKER = Buffer.from("Dat3", "ascii");
const MARKER_OFFSET = 4;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x0c;
const NAME_SIZE = 0x100;
const RECORD_SIZE = NAME_SIZE + 12;

export const cabDescriptor: FormatDescriptor = {
	id: "entexec-cab",
	name: "Entertainment Executive PackDat3 archive",
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
			source: "ArcFormats/EntExec/ArcCAB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `CabOpener.TryOpen`. The opener keeps entries as raw byte ranges: the third integer of
 * each record is a declared unpacked size that the reference implementation never decodes.
 */
async function readCabIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header
			.subarray(MARKER_OFFSET, MARKER_OFFSET + FORMAT_MARKER.length)
			.equals(FORMAT_MARKER)
	)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		const unpackedSize = BigInt(index.readUInt32LE(record + NAME_SIZE + 8));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: { unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return entries;
}

export const cabFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cabDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCabIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCabIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid PackDat3 archive layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
