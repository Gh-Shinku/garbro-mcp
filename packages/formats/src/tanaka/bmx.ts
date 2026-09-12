// Format reference: GARbro ArcFormats/Tanaka/ArcBMX.cs
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

const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x1c;
const RECORD_SIZE = 0x20;

export const bmxDescriptor: FormatDescriptor = {
	id: "tanaka-bmx",
	name: "Tanaka Tatsuhiro's engine resource archive",
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
			source: "ArcFormats/Tanaka/ArcBMX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (BigInt(header.readUInt32LE(0)) !== source.size) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readBmx(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka BMX layout");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const records: { path: string; rawPath?: string; offset: bigint }[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) break;
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		if (offset >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Tanaka BMX entry points outside the archive: ${name}`,
			);
		}
		records.push({ ...normalizeEntryPath(name), offset });
	}
	if (records.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Tanaka BMX archive is empty");
	}
	const entries: FixedEntry[] = records.map((record, id) => {
		const nextOffset = records[id + 1]?.offset ?? source.size;
		const size = nextOffset - record.offset;
		if (!checkPlacement(record.offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Tanaka BMX entry points outside the archive: ${record.path}`,
			);
		}
		return createFixedEntry({
			id,
			path: record.path,
			...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
			offset: record.offset,
			size,
		});
	});
	return { entries, metadata: { entryCount: entries.length } };
}

export const bmxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bmxDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readBmx,
});
