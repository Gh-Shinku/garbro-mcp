// Format reference: GARbro Legacy/Brownie/ArcNAF.cs
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

const SIGNATURE = Buffer.from("1.BROWNIE", "ascii");
const COUNT_OFFSET = 0x30;
const INDEX_POINTER_OFFSET = 0x34;
const NAME_SIZE = 0x10;
const EXT_SIZE = 4;
const RECORD_SIZE = 0x20;

export const nafDescriptor: FormatDescriptor = {
	id: "brownie-naf",
	name: "Brownie/NenGollo resource archive",
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
			source: "Legacy/Brownie/ArcNAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface NafHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<NafHeader | undefined> {
	if (source.size < BigInt(INDEX_POINTER_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_POINTER_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset };
}

async function readNaf(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Brownie NAF signature");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const baseName = decodeCStringField(index, recordOffset, NAME_SIZE);
		const extension = decodeCStringField(
			index,
			recordOffset + NAME_SIZE,
			EXT_SIZE,
		);
		if (baseName.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Brownie NAF entry has an empty name",
			);
		}
		const path =
			extension.length > 0
				? `${baseName.slice(0, baseName.length - extname(baseName).length)}.${extension}`
				: baseName;
		const offset = BigInt(index.readUInt32LE(recordOffset + 0x14));
		const size = BigInt(index.readUInt32LE(recordOffset + 0x18));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Brownie NAF entry points outside the archive: ${path}`,
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

export const nafFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nafDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readNaf,
});
