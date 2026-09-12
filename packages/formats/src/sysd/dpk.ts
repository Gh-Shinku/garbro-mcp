// Format reference: GARbro ArcFormats/SysD/ArcDPK.cs
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

const SIGNATURE = Buffer.from("PA", "ascii");
const HEADER_SIZE = 8;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x14;
const SIZE_OFFSET = 0x10;

export const dpkDescriptor: FormatDescriptor = {
	id: "sysd-dpk",
	name: "SYSD engine resource archive",
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
			source: "ArcFormats/SysD/ArcDPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function parseHeader(header: Buffer): number | undefined {
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readUInt16LE(2);
	return isSaneCount(count) ? count : undefined;
}

async function readDpk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "SYSD DPK header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = parseHeader(header);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid SYSD DPK signature");
	}
	if (BigInt(header.readUInt32LE(4)) !== source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"SYSD DPK declared size does not match the file",
		);
	}
	const indexSize = count * RECORD_SIZE;
	if (BigInt(HEADER_SIZE + indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "SYSD DPK index is truncated");
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: FixedEntry[] = [];
	let offset = BigInt(HEADER_SIZE + indexSize);
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"SYSD DPK entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`SYSD DPK entry points outside the archive: ${name}`,
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

export const dpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = parseHeader(header);
		if (count === undefined) return false;
		return (
			BigInt(header.readUInt32LE(4)) === source.size &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	},
	read: readDpk,
});
