// Format reference: GARbro ArcFormats/Software House Parsley/ArcPAC.cs
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

const SIGNATURE = Buffer.from("PAC0", "ascii");
const HEADER_SIZE = 8;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const OFFSET_OFFSET = 0x20;
const SIZE_OFFSET = 0x24;

export const parsleyPacDescriptor: FormatDescriptor = {
	id: "parsley-pac",
	name: "Software House Parsley CG archive",
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
			source: "ArcFormats/Software House Parsley/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(4);
	return isSaneCount(count) ? count : undefined;
}

async function readParsleyPac(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley PAC signature");
	}
	const indexSize = count * RECORD_SIZE;
	if (BigInt(HEADER_SIZE + indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Parsley PAC index is truncated");
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Parsley PAC entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Parsley PAC entry points outside the archive: ${name}`,
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

export const parsleyPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: parsleyPacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const count = await parseHeader(source);
		return (
			count !== undefined &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	},
	read: readParsleyPac,
});
