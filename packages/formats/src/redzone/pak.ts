// Format reference: GARbro Legacy/RedZone/ArcPAK.cs
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

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x44;
const RECORD_SIZE = 0x54;

export const redzonePakDescriptor: FormatDescriptor = {
	id: "redzone-pak",
	name: "RED-ZONE resource archive",
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
			source: "Legacy/RedZone/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface RedzoneHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<RedzoneHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (dataOffset >= source.size) return undefined;
	return { count, dataOffset };
}

async function readRedzonePak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid RED-ZONE PAK layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"RED-ZONE PAK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE + 4));
		if (offset < dataOffset || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`RED-ZONE PAK entry points outside the archive: ${name}`,
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

export const redzonePakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: redzonePakDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readRedzonePak,
});
