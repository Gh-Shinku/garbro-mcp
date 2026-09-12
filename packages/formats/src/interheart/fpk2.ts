// Format reference: GARbro ArcFormats/Interheart/ArcFPK2.cs
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

const SIGNATURE = Buffer.from("FPK ", "ascii");
const VERSION_TAG = Buffer.from("2.00", "ascii");
const COUNT_OFFSET = 0x1c;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x20;
const NAME_OFFSET = 8;
const NAME_SIZE = 0x18;

export const fpk2Descriptor: FormatDescriptor = {
	id: "interheart-fpk2",
	name: "Interheart resource archive",
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
			source: "ArcFormats/Interheart/ArcFPK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!header.subarray(4, 4 + VERSION_TAG.length).equals(VERSION_TAG))
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readFpk2(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Interheart FPK 2.00 layout",
		);
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(
			index,
			recordOffset + NAME_OFFSET,
			NAME_SIZE,
		);
		if (name.startsWith("/")) continue;
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Interheart FPK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Interheart FPK entry points outside the archive: ${name}`,
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
	return { entries, metadata: { entryCount: entries.length } };
}

export const fpk2Format: ArchiveFormat = defineFixedArchive({
	descriptor: fpk2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readFpk2,
});
