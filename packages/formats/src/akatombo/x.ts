// Format reference: GARbro Legacy/Akatombo/ArcX.cs
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
const INDEX_OFFSET = 2;

export const akatomboXDescriptor: FormatDescriptor = {
	id: "akatombo-x",
	name: "Akatombo resource archive",
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
			source: "Legacy/Akatombo/ArcX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface XHeader {
	count: number;
}

async function parseHeader(source: ByteSource): Promise<XHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + 4);
	const count = header.readUInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = BigInt(header.readUInt32LE(INDEX_OFFSET));
	if (firstOffset !== BigInt(count * 4 + 6)) return undefined;
	if (firstOffset > source.size) return undefined;
	return { count };
}

async function readAkatomboX(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Akatombo X layout");
	}
	const { count } = header;
	const table = await source.readAt(BigInt(INDEX_OFFSET), count * 4 + 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * 4));
		const nextOffset = BigInt(table.readUInt32LE((id + 1) * 4));
		if (nextOffset < offset || nextOffset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Akatombo X offset table is not monotonic",
			);
		}
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Akatombo X entry points outside the archive",
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
	if (BigInt(table.readUInt32LE(count * 4)) !== source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Akatombo X final offset does not match the file size",
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const akatomboXFormat: ArchiveFormat = defineFixedArchive({
	descriptor: akatomboXDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAkatomboX,
});
