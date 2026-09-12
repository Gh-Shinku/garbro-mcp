// Format reference: GARbro Legacy/Mina/ArcML2.cs
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

const SIGNATURE = Buffer.from("ML200", "ascii");
const DATA_OFFSET_OFFSET = 6;
const COUNT_OFFSET = 8;
const INDEX_SIZE_OFFSET = 0x0c;
const INDEX_POINTER_OFFSET = 0x10;
const ABSENT_SIZE = 0xffffffffn;

export const ml2Descriptor: FormatDescriptor = {
	id: "mina-ml2",
	name: "Mina resource archive",
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
			source: "Legacy/Mina/ArcML2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Ml2Header {
	count: number;
	dataOffset: bigint;
	indexSize: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<Ml2Header | undefined> {
	if (source.size < BigInt(INDEX_POINTER_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_POINTER_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt16LE(DATA_OFFSET_OFFSET));
	const indexSize = header.readUInt32LE(INDEX_SIZE_OFFSET);
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	return { count, dataOffset, indexSize, indexOffset };
}

async function readMl2(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Mina ML200 layout");
	}
	const { count, indexSize, indexOffset } = header;
	const index = await source.readAt(indexOffset, indexSize);
	let dataOffset = header.dataOffset;
	let position = 0;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + 5 > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Mina ML2 index is truncated");
		}
		const size = BigInt(index.readUInt32LE(position));
		if (size === ABSENT_SIZE) break;
		const nameLength = index[position + 4] ?? 0;
		if (nameLength === 0 || position + 5 + nameLength > index.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Mina ML2 entry name is invalid",
			);
		}
		const name = decodeCp932(
			index.subarray(position + 5, position + 5 + nameLength),
		);
		position += 5 + nameLength;
		if (!checkPlacement(dataOffset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Mina ML2 entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		dataOffset += size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Mina ML2 archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const ml2Format: ArchiveFormat = defineFixedArchive({
	descriptor: ml2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readMl2,
});
