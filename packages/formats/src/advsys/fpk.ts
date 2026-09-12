// Format reference: GARbro ArcFormats/AdvSys/ArcAdvSysT.cs
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

const SIGNATURE = Buffer.from("MFWY", "ascii");
const COUNT_OFFSET = 4;
const DATA_OFFSET_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x18;
const SIZE_OFFSET = 0x18;
const OFFSET_OFFSET = 0x1c;

export const advSysFpkDescriptor: FormatDescriptor = {
	id: "advsys-fpk",
	name: "AdvSys_T engine resource archive",
	extensions: ["fpk"],
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
			source: "ArcFormats/AdvSys/ArcAdvSysT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface FpkHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<FpkHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	if (dataOffset < BigInt(0x10 + count * RECORD_SIZE)) return undefined;
	if (dataOffset > source.size) return undefined;
	return { count, dataOffset };
}

async function readAdvSysFpk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AdvSys FPK signature");
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
				"AdvSys FPK entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (offset < dataOffset || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`AdvSys FPK entry points outside the archive: ${name}`,
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
	return { entries, metadata: { entryCount: count, dataOffset } };
}

export const advSysFpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advSysFpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAdvSysFpk,
});
