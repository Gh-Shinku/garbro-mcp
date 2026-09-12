// Format reference: GARbro ArcFormats/Circus/ArcPCK.cs
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
const NAME_SIZE = 0x38;
const RECORD_SIZE = 0x40;
const OFFSET_OFFSET = 0x38;
const SIZE_OFFSET = 0x3c;

export const circusPckDescriptor: FormatDescriptor = {
	id: "circus-pck",
	name: "Circus resource archive",
	extensions: ["pck", "dat"],
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
			source: "ArcFormats/Circus/ArcPCK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PckHeader {
	count: number;
	indexOffset: number;
}

async function parseHeader(source: ByteSource): Promise<PckHeader | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, 8);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = BigInt(header.readUInt32LE(4));
	const indexSize = BigInt(count * RECORD_SIZE + 4);
	if (firstOffset < indexSize || firstOffset >= source.size) return undefined;
	const indexOffset = 4 + count * 8;
	if (BigInt(indexOffset) + BigInt(count) * 0x40n > source.size)
		return undefined;
	return { count, indexOffset };
}

async function readCircusPck(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Circus PCK layout");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(BigInt(indexOffset), count * RECORD_SIZE);
	if (BigInt(index.readUInt32LE(OFFSET_OFFSET)) !== BigInt(4 + count * 0x48)) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Circus PCK first offset does not follow the index",
		);
	}
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Circus PCK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Circus PCK entry points outside the archive: ${name}`,
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

export const circusPckFormat: ArchiveFormat = defineFixedArchive({
	descriptor: circusPckDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCircusPck,
});
