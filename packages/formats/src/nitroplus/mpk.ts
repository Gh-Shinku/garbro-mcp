// Format reference: GARbro ArcFormats/NitroPlus/ArcMPK.cs
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

const SIGNATURE = Buffer.from("MPK\0", "binary");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x48;
const NAME_SIZE = 0xe0;
const RECORD_SIZE = 0x100;
const OFFSET_OFFSET = 0x00;
const SIZE_OFFSET = 0x08;
const UNPACKED_SIZE_OFFSET = 0x10;
const NAME_OFFSET = 0x18;

export const mpkDescriptor: FormatDescriptor = {
	id: "nitroplus-mpk",
	name: "MAGES engine resource archive",
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
			source: "ArcFormats/NitroPlus/ArcMPK.cs",
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

async function readMpk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid MAGES MPK signature");
	}
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "MAGES MPK index is truncated");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(
			index,
			recordOffset + NAME_OFFSET,
			NAME_SIZE,
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MAGES MPK entry has an empty name",
			);
		}
		const offset = index.readBigUInt64LE(recordOffset + OFFSET_OFFSET);
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`MAGES MPK entry points outside the archive: ${name}`,
			);
		}
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
	return { entries, metadata: { entryCount: count } };
}

export const mpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const count = await parseHeader(source);
		return (
			count !== undefined &&
			BigInt(INDEX_OFFSET + count * RECORD_SIZE) <= source.size
		);
	},
	read: readMpk,
});
