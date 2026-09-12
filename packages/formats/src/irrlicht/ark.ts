// Format reference: GARbro ArcFormats/Irrlicht/ArcARK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x104;
const RECORD_SIZE = 0x10c;
const OFFSET_OFFSET = 0x104;
const SIZE_OFFSET = 0x108;

export const irrlichtArkDescriptor: FormatDescriptor = {
	id: "irrlicht-ark",
	name: "Irrlicht engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Irrlicht/ArcARK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function decodeName(field: Buffer): string | undefined {
	let length = 0;
	while (length < field.length && (field[length] ?? 0) !== 0xff) {
		field[length] = (field[length] ?? 0) ^ 0xff;
		length += 1;
	}
	if (length === 0) return undefined;
	return decodeCp932(field.subarray(0, length));
}

const irrlichtArkEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (data[position] ?? 0) ^ 0xff;
	}
	return Readable.from([data]);
};

interface ArkHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<ArkHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	const firstRecord = await source.readAt(
		BigInt(INDEX_OFFSET),
		OFFSET_OFFSET + 4,
	);
	if (BigInt(firstRecord.readUInt32LE(OFFSET_OFFSET)) !== dataOffset)
		return undefined;
	return { count, dataOffset };
}

async function readIrrlichtArk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Irrlicht ARK layout");
	}
	const { count } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = Buffer.from(
			index.subarray(recordOffset, recordOffset + NAME_SIZE),
		);
		const name = decodeName(nameField);
		if (name === undefined) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Irrlicht ARK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Irrlicht ARK entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const irrlichtArkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: irrlichtArkDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readIrrlichtArk,
	openEntry: irrlichtArkEntryOpener,
});
