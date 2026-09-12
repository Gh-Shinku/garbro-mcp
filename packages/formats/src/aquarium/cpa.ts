// Format reference: GARbro Legacy/Aquarium/ArcCPA.cs
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

const SIGNATURE = Buffer.from("CPA\0", "binary");
const DATA_OFFSET_OFFSET = 8;
const COUNT_OFFSET = 12;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;
const OFFSET_OFFSET = 0x10;
const SIZE_OFFSET = 0x14;

export const cpaDescriptor: FormatDescriptor = {
	id: "aquarium-cpa",
	name: "Aquarium resource archive",
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
			source: "Legacy/Aquarium/ArcCPA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface CpaHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<CpaHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	if (dataOffset >= source.size) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return { count, dataOffset };
}

async function readCpa(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Aquarium CPA signature");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		if ((index[recordOffset] ?? 0) === 0) continue;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Aquarium CPA entry has an empty name",
			);
		}
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Aquarium CPA entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const cpaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cpaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCpa,
});
