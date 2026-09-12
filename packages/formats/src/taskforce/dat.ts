// Format reference: GARbro ArcFormats/Taskforce/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("tskf", "ascii");
const SECOND_TAG = Buffer.from("orce", "ascii");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x0c;
const NAME_SIZE = 0x100;
const RECORD_SIZE = 0x10c;
const OFFSET_OFFSET = 0x100;
const UNPACKED_SIZE_OFFSET = 0x104;
const SIZE_OFFSET = 0x108;

export const taskforceDatDescriptor: FormatDescriptor = {
	id: "taskforce-dat",
	name: "Taskforce engine resource archive",
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
			source: "ArcFormats/Taskforce/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

const taskforceEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const declared = entry.metadata?.unpackedSize;
	const unpackedSize = Number(
		typeof declared === "string" ? declared : entry.size,
	);
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Taskforce entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([
		inflateLzss(compressed, { outputLength: unpackedSize }),
	]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!header.subarray(4, 4 + SECOND_TAG.length).equals(SECOND_TAG))
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readTaskforceDat(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Taskforce tskforce layout",
		);
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Taskforce entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Taskforce entry points outside the archive: ${name}`,
			);
		}
		const packed = unpackedSize !== size;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: packed,
				metadata: { packed, unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const taskforceDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: taskforceDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readTaskforceDat,
	openEntry: taskforceEntryOpener,
});
