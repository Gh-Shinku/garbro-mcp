// Format reference: GARbro ArcFormats/Succubus/ArcARC.cs
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

const SIGNATURE = Buffer.from("ARC1", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const SIZE_OFFSET = 0x10;
const DATA_OFFSET_OFFSET = 0x14;

export const succubusArcDescriptor: FormatDescriptor = {
	id: "succubus-arc",
	name: "Succubus resource archive",
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
			source: "ArcFormats/Succubus/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface SuccubusHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<SuccubusHeader | undefined> {
	if (source.size < 16n) return undefined;
	const header = await source.readAt(0n, 16);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET));
	if (indexOffset < 0x10n || indexOffset >= source.size) return undefined;
	return { count, indexOffset };
}

async function readSuccubusArc(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Succubus ARC1 signature");
	}
	const { count, indexOffset } = header;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Succubus ARC index is truncated");
	}
	const index = await source.readAt(indexOffset, indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Succubus ARC entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(
			index.readUInt32LE(recordOffset + DATA_OFFSET_OFFSET),
		);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Succubus ARC entry points outside the archive: ${name}`,
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

export const succubusArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: succubusArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSuccubusArc,
});
