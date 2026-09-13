// Format reference: GARbro ArcFormats/Tanaka/ArcVPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [
	Buffer.from("VPK0", "ascii"),
	Buffer.from("VPK1", "ascii"),
] as const;
const DATA_SIZE_OFFSET = 4;
const COUNT_OFFSET = 8;
const INDEX_SIZE_OFFSET = 0x0c;
const INDEX_OFFSET = 0x20;
const VERSION_OFFSET = 3;

export const tanakaVpkDescriptor: FormatDescriptor = {
	id: "will-vpk1",
	name: "Tanaka Tatsuhiro engine audio archive",
	extensions: ["vpk"],
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
			source: "ArcFormats/Tanaka/ArcVPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface VpkRecord {
	name: string;
	offset: number;
	size: number;
}

/**
 * GARbro `VpkOpener.TryOpen`. The stored data and index sizes must add up to the file size. The
 * version digit at offset 3 selects the record layout and the name field width, and GARbro composes
 * a `.wav` name from the stored stem and the numeric fields of every record.
 */
async function parseVpk(source: ByteSource): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!SIGNATURES.some((signature) => header.subarray(0, 4).equals(signature)))
		return undefined;
	const dataSize = BigInt(header.readUInt32LE(DATA_SIZE_OFFSET));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_OFFSET));
	if (dataSize + indexSize !== source.size) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET) + indexSize;
	if (dataOffset >= source.size) return undefined;
	const version = (header[VERSION_OFFSET] ?? 0) - 0x30;
	const nameLength = version > 0 ? 4 : 2;
	if (BigInt(indexSize) > source.size - BigInt(INDEX_OFFSET)) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), Number(indexSize));
	const records: VpkRecord[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + nameLength > index.length) return undefined;
		const field = index.subarray(position, position + nameLength);
		const terminator = field.indexOf(0);
		const stem = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (stem.length === 0) return undefined;
		position += nameLength;
		const recordSize = version > 0 ? 20 : 16;
		if (position + recordSize > index.length) return undefined;
		let name: string;
		if (version > 0) {
			const n1 = index.readUInt16LE(position);
			const n2 = index.readUInt16LE(position + 2);
			const n3 = index.readUInt32LE(position + 4);
			name = `${stem}_${String(n1).padStart(2, "0")}_${n2}_${String(n3).padStart(3, "0")}.wav`;
		} else {
			const n1 = index.readUInt16LE(position);
			const n2 = index.readUInt32LE(position + 2);
			name = `${stem}_${String(n1).padStart(2, "0")}_${String(n2).padStart(3, "0")}.wav`;
		}
		const offset = index.readUInt32LE(position + (version > 0 ? 8 : 6));
		const size = index.readUInt32LE(position + (version > 0 ? 12 : 10));
		records.push({ name, offset, size });
		position += recordSize;
	}

	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		const offset = BigInt(record.offset);
		const size = BigInt(record.size);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const tanakaVpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tanakaVpkDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseVpk(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await parseVpk(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka VPK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
