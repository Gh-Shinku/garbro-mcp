// Format reference: GARbro Legacy/Gsx/ArcK3.cs
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

const SIGNATURE = Buffer.from("K3", "ascii");
const COUNT_OFFSET = 2;
const INDEX_OFFSET = 6;
const NAME_OFFSET = 0x20;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x40;

export const k3Descriptor: FormatDescriptor = {
	id: "gsx-k3",
	name: "Toyo GSX resource archive",
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
			source: "Legacy/Gsx/ArcK3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface K3Header {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<K3Header | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	return { count, dataOffset };
}

async function readK3(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Toyo GSX K3 layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = dataOffset + BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		const name = decodeCStringField(
			index,
			recordOffset + NAME_OFFSET,
			NAME_SIZE,
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Toyo GSX K3 entry has an empty name",
			);
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Toyo GSX K3 entry points outside the archive: ${name}`,
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

export const k3Format: ArchiveFormat = defineFixedArchive({
	descriptor: k3Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readK3,
});
