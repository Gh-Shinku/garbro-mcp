// Format reference: GARbro ArcFormats/BellDa/ArcDAT.cs
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

const SIGNATURE = Buffer.from("BLD0", "ascii");
const VERSION_OFFSET = 4;
const VERSION_SIZE = 4;
const COUNT_OFFSET = 8;
const INDEX_POINTER_OFFSET = 0x0a;
const NAME_SIZE = 0x0c;
const RECORD_SIZE = 0x10;
const DATA_OFFSET = 0x10;
const VALID_VERSIONS = new Set(["0", "1", "12", "3"]);

export const bldDescriptor: FormatDescriptor = {
	id: "bellda-bld",
	name: "BELL-DA resource archive",
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
			source: "ArcFormats/BellDa/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface BldHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<BldHeader | undefined> {
	if (source.size < BigInt(INDEX_POINTER_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_POINTER_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const rawVersion = decodeCStringField(header, VERSION_OFFSET, VERSION_SIZE);
	const version = rawVersion.replaceAll("\u001a", "").trim();
	if (!VALID_VERSIONS.has(version)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset };
}

async function readBld(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid BELL-DA BLD0 layout");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	let offset = BigInt(DATA_OFFSET);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"BELL-DA BLD entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`BELL-DA BLD entry points outside the archive: ${name}`,
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
		offset += size;
	}
	return { entries, metadata: { entryCount: count } };
}

export const bldFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bldDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readBld,
});
