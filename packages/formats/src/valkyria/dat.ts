// Format reference: GARbro ArcFormats/Valkyria/ArcDAT.cs
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

const HEADER_SIZE = 4;
const NAME_SIZE = 0x104;
const RECORD_SIZE = 0x10c;
const OFFSET_OFFSET = 0x104;
const SIZE_OFFSET = 0x108;

export const valkyriaDatDescriptor: FormatDescriptor = {
	id: "valkyria-dat",
	name: "Valkyria resource archive",
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
			source: "ArcFormats/Valkyria/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ValkyriaHeader {
	count: number;
	indexSize: number;
	dataOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<ValkyriaHeader | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const indexSize = header.readUInt32LE(0);
	if (indexSize === 0 || BigInt(indexSize) >= source.size) return undefined;
	if (indexSize % RECORD_SIZE !== 0) return undefined;
	const count = indexSize / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(HEADER_SIZE + indexSize);
	if (dataOffset >= source.size) return undefined;
	return { count, indexSize, dataOffset };
}

async function readValkyriaDat(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Valkyria DAT index layout",
		);
	}
	const { count, indexSize, dataOffset } = header;
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Valkyria DAT entry has an empty name",
			);
		}
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Valkyria DAT entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const valkyriaDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: valkyriaDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readValkyriaDat,
});
