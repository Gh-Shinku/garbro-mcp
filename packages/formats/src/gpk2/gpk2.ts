// Format reference: GARbro ArcFormats/Gpk2/ArcGPK2.cs
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

const SIGNATURE = Buffer.from("GPK2", "ascii");
const INDEX_POINTER_OFFSET = 4;
const NAME_SIZE = 0x80;
const RECORD_SIZE = 0x88;

export const gpk2Descriptor: FormatDescriptor = {
	id: "gpk2",
	name: "GPK2 resource archive",
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
			source: "ArcFormats/Gpk2/ArcGPK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Gpk2Header {
	indexOffset: bigint;
	count: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<Gpk2Header | undefined> {
	if (source.size < 8n) return undefined;
	const header = await source.readAt(0n, 8);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size || indexOffset + 4n > source.size)
		return undefined;
	const count = (await source.readAt(indexOffset, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	return { indexOffset, count };
}

async function readGpk2(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid GPK2 signature");
	}
	const { indexOffset, count } = header;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + 4n + BigInt(indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "GPK2 index is truncated");
	}
	const index = await source.readAt(indexOffset + 4n, indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		const name = decodeCStringField(index, recordOffset + 8, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "GPK2 entry has an empty name");
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`GPK2 entry points outside the archive: ${name}`,
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

export const gpk2Format: ArchiveFormat = defineFixedArchive({
	descriptor: gpk2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const header = await parseHeader(source);
		if (!header) return false;
		return (
			header.indexOffset + 4n + BigInt(header.count * RECORD_SIZE) <=
			source.size
		);
	},
	read: readGpk2,
});
