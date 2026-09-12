// Format reference: GARbro Legacy/Pearl/ArcARY.cs
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
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;

export const aryDescriptor: FormatDescriptor = {
	id: "pearl-ary",
	name: "Pearl Soft resource archive",
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
			source: "Legacy/Pearl/ArcARY.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AryHeader {
	count: number;
	indexSize: number;
}

async function parseHeader(source: ByteSource): Promise<AryHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * 4 + 8;
	if (BigInt(indexSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(INDEX_OFFSET), indexSize - 4);
	if (BigInt(table.readUInt32LE(0)) !== BigInt(indexSize)) return undefined;
	if (BigInt(table.readUInt32LE(indexSize - 8)) !== source.size)
		return undefined;
	return { count, indexSize };
}

async function readAry(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Pearl ARY layout");
	}
	const { count, indexSize } = header;
	const table = await source.readAt(BigInt(INDEX_OFFSET), indexSize - 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * 4));
		const nextOffset = BigInt(table.readUInt32LE((id + 1) * 4));
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Pearl ARY entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(4, "0")}`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const aryFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aryDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAry,
});
