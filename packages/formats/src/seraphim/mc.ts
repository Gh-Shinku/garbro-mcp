// Format reference: GARbro ArcFormats/Seraphim/ArcMC.cs
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

const TAG = Buffer.from("MC", "ascii");
const COUNT_OFFSET = 8;
const DATA_SIZE_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const RECORD_HEADER_SIZE = 4;

export const seraphimMcDescriptor: FormatDescriptor = {
	id: "seraphim-mc",
	name: "Seraphim engine animation resource",
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
			source: "ArcFormats/Seraphim/ArcMC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readInt32LE(0) !== 0) return undefined;
	if (!header.subarray(4, 4 + TAG.length).equals(TAG)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (
		BigInt(header.readUInt32LE(DATA_SIZE_OFFSET)) + BigInt(INDEX_OFFSET) !==
		source.size
	)
		return undefined;
	return count;
}

async function readSeraphimMc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim MC layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (offset + BigInt(RECORD_HEADER_SIZE) > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Seraphim MC index is truncated",
			);
		}
		const size = BigInt(
			(await source.readAt(offset, RECORD_HEADER_SIZE)).readUInt32LE(0),
		);
		const dataOffset = offset + BigInt(RECORD_HEADER_SIZE);
		if (!checkPlacement(dataOffset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Seraphim MC entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(4, "0")}.cb`,
				offset: dataOffset,
				size,
			}),
		);
		offset = dataOffset + size;
	}
	return { entries, metadata: { entryCount: count } };
}

export const seraphimMcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: seraphimMcDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSeraphimMc,
});
