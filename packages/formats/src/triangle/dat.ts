// Format reference: GARbro ArcFormats/Triangle/ArcDAT.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const FIRST_OFFSET_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x0d;
const RECORD_SIZE = 0x11;

export const triangleDatDescriptor: FormatDescriptor = {
	id: "triangle-dat",
	name: "Triangle resource archive",
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
			source: "ArcFormats/Triangle/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface TriangleHeader {
	entryCount: number;
	firstOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<TriangleHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 1 || count - 1 >= 0x40000) return undefined;
	const firstOffset = BigInt(header.readUInt32LE(FIRST_OFFSET_OFFSET));
	if (firstOffset !== BigInt(4 + count * RECORD_SIZE)) return undefined;
	if (firstOffset >= source.size) return undefined;
	if (BigInt(INDEX_OFFSET + (count - 1) * RECORD_SIZE) > source.size)
		return undefined;
	return { entryCount: count - 1, firstOffset };
}

async function readTriangleDat(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Triangle DAT layout");
	}
	const { entryCount, firstOffset } = header;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		entryCount * RECORD_SIZE,
	);
	const entries: FixedEntry[] = [];
	let nextOffset = firstOffset;
	for (let id = 0; id < entryCount; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Triangle DAT entry has an empty name",
			);
		}
		const offset = nextOffset;
		nextOffset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Triangle DAT entry points outside the archive: ${name}`,
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
	return { entries, metadata: { entryCount } };
}

export const triangleDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: triangleDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readTriangleDat,
});
