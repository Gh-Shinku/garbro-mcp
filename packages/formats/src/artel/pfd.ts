// Format reference: GARbro Legacy/Artel/ArcPFD.cs
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
import { extname } from "node:path";

const HEADER_SIZE = 4;
const NAME_SIZE = 0x15;
const EXT_SIZE = 3;
const RECORD_SIZE = 0x20;
const OFFSET_OFFSET = 0x18;
const SIZE_OFFSET = 0x1c;

export const pfdDescriptor: FormatDescriptor = {
	id: "artel-pfd",
	name: "Artel ADVG engine resource archive",
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
			source: "Legacy/Artel/ArcPFD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PfdHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<PfdHeader | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const count = (await source.readAt(0n, HEADER_SIZE)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(HEADER_SIZE + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	return { count, dataOffset };
}

async function readPfd(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Artel PFD layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(HEADER_SIZE), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const baseName = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (baseName.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Artel PFD entry has an empty name",
			);
		}
		const extension = decodeCStringField(
			index,
			recordOffset + NAME_SIZE,
			EXT_SIZE,
		);
		const path =
			extension.length > 0
				? `${baseName.slice(0, baseName.length - extname(baseName).length)}.${extension}`
				: baseName;
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (offset < dataOffset || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Artel PFD entry points outside the archive: ${path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(path),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const pfdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pfdDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readPfd,
});
