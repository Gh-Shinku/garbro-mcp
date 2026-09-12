// Format reference: GARbro ArcFormats/MangaGamer/ArcSHA.cs
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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("SHA_", "ascii");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x0c;
const NAME_FIELD_SIZE = 0x40;
const RECORD_SIZE = 0x50;
const OFFSET_OFFSET = 0x40;
const SIZE_OFFSET = 0x44;

export const shaDescriptor: FormatDescriptor = {
	id: "mg-sha",
	name: "MG resource archive",
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
			source: "ArcFormats/MangaGamer/ArcSHA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	return isSaneCount(count) ? count : undefined;
}

async function readSha(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid MG SHA signature");
	}
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "MG SHA index is truncated");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameLength = index[recordOffset] ?? 0;
		if (nameLength === 0 || nameLength >= NAME_FIELD_SIZE) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MG SHA entry name length is invalid",
			);
		}
		const name = index
			.subarray(recordOffset + 1, recordOffset + 1 + nameLength)
			.toString("utf8");
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MG SHA entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`MG SHA entry points outside the archive: ${name}`,
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

export const shaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: shaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const count = await parseHeader(source);
		return (
			count !== undefined &&
			BigInt(INDEX_OFFSET + count * RECORD_SIZE) <= source.size
		);
	},
	read: readSha,
});
