// Format reference: GARbro Legacy/Unknown/ArcAQA.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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

const SIGNATURE = Buffer.from("AQA ", "ascii");
const KEY_OFFSET = 8;
const COUNT_OFFSET = 12;
const INDEX_OFFSET = 0x18;
const NAME_SIZE = 0x80;
const RECORD_SIZE = 0x90;
const SIZE_OFFSET = 0x80;
const OFFSET_OFFSET = 0x88;

export const aqaDescriptor: FormatDescriptor = {
	id: "aqa",
	name: "'Unknown' resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Unknown/ArcAQA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AqaHeader {
	count: number;
	key: number;
}

async function parseHeader(source: ByteSource): Promise<AqaHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const key =
		(((101 * header.readUInt32LE(KEY_OFFSET) + 777) & 0xffff) + 1) & 0xffff;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return { count, key };
}

async function readAqa(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AQA signature");
	}
	const { count, key } = header;
	const indexSize = count * RECORD_SIZE;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	for (let position = 0; position + 1 < index.length; position += 2) {
		index[position] = (index[position] ?? 0) ^ (key & 0xff);
		index[position + 1] = (index[position + 1] ?? 0) ^ (key >> 8);
	}
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const field = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "AQA entry has an empty name");
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`AQA entry points outside the archive: ${name}`,
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

export const aqaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aqaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAqa,
});
