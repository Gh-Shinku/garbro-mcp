// Format reference: GARbro Legacy/Mmfass/ArcSDA.cs
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

const SIGNATURE = Buffer.from("SA", "ascii");
const DATA_OFFSET_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x14;
const RECORD_SIZE = 0x1c;
const OFFSET_OFFSET = 0x14;
const SIZE_OFFSET = 0x18;

export const sdaDescriptor: FormatDescriptor = {
	id: "mmfass-sda",
	name: "MMFass engine resource archive",
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
			source: "Legacy/Mmfass/ArcSDA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface SdaHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<SdaHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	if (dataOffset <= 8n || dataOffset >= source.size) return undefined;
	const count = Number((dataOffset - 8n) / BigInt(RECORD_SIZE));
	if (!isSaneCount(count) || (dataOffset - 8n) % BigInt(RECORD_SIZE) !== 0n)
		return undefined;
	return { count, dataOffset };
}

async function readSda(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid MMFass SDA layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		).trim();
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MMFass SDA entry has an empty name",
			);
		}
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`MMFass SDA entry points outside the archive: ${name}`,
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

export const sdaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sdaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSda,
});
