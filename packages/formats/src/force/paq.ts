// Format reference: GARbro Legacy/Force/ArcPAQ.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const COUNT_OFFSET = 0;
const RECORD_SIZE = 8;
const FIRST_RECORD_OFFSET = 4;
const SIZE_OFFSET = 4;

export const paqDescriptor: FormatDescriptor = {
	id: "force-paq",
	name: "Force resource archive",
	extensions: ["paq"],
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
			source: "Legacy/Force/ArcPAQ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PaqHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<PaqHeader | undefined> {
	if (sourceExtension(sourcePath) !== "paq") return undefined;
	if (source.size < BigInt(FIRST_RECORD_OFFSET)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(FIRST_RECORD_OFFSET + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	return { count, dataOffset };
}

async function readPaq(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Force PAQ layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(
		BigInt(FIRST_RECORD_OFFSET),
		count * RECORD_SIZE,
	);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = dataOffset;
	for (let id = 0; id < count; id += 1) {
		const size = BigInt(index.readUInt32LE(id * RECORD_SIZE + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Force PAQ entry points outside the archive",
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
		offset += size;
	}
	return { entries, metadata: { entryCount: count } };
}

export const paqFormat: ArchiveFormat = defineFixedArchive({
	descriptor: paqDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readPaq,
});
