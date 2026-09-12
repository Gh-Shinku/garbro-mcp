// Format reference: GARbro Legacy/HyperWorks/ArcPAK.cs
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

const SIGNATURE = Buffer.from("PACK", "ascii");
const INDEX_SIZE_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x18;
const NAME_OFFSET = 9;
const MAXIMUM_NAME_LENGTH = 15;

export const hyperworksPakDescriptor: FormatDescriptor = {
	id: "hyperworks-pak",
	name: "HyperWorks resource archive",
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
			source: "Legacy/HyperWorks/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface HyperworksHeader {
	count: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<HyperworksHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexSize = header.readInt32LE(INDEX_SIZE_OFFSET);
	if (indexSize <= 0 || BigInt(indexSize) >= source.size - 4n) return undefined;
	if (indexSize % RECORD_SIZE !== 0) return undefined;
	const count = indexSize / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	return { count };
}

async function readHyperworksPak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid HyperWorks PACK layout");
	}
	const { count } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameLength = index[recordOffset + 8] ?? 0;
		if (nameLength === 0 || nameLength > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"HyperWorks PACK entry name length is invalid",
			);
		}
		const name = decodeCStringField(
			index,
			recordOffset + NAME_OFFSET,
			nameLength,
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"HyperWorks PACK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`HyperWorks PACK entry points outside the archive: ${name}`,
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

export const hyperworksPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hyperworksPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readHyperworksPak,
});
