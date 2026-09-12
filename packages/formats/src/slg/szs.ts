// Format reference: GARbro ArcFormats/Slg/ArcSZS.cs
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

const SIGNATURE = Buffer.from("SZS1", "ascii");
const VERSION_OFFSET = 4;
const PLATFORM_TAG = Buffer.from("0__", "ascii");
const COUNT_OFFSET = 0x0c;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x100;
const OFFSET_OFFSET = 0x100;
const SIZE_OFFSET = 0x108;
const RECORD_SIZE = 0x110;
const XOR_KEY = 0x90;

export const szsDescriptor: FormatDescriptor = {
	id: "slg-szs",
	name: "SLG system resource archive",
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
			source: "ArcFormats/Slg/ArcSZS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const szsEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (data[position] ?? 0) ^ XOR_KEY;
	}
	return Readable.from([data]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = (header[VERSION_OFFSET] ?? 0) - 0x30;
	if (version < 0 || version > 9) return undefined;
	if (!header.subarray(5, 5 + PLATFORM_TAG.length).equals(PLATFORM_TAG))
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readSzs(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG SZS layout");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"SLG SZS entry has an empty name",
			);
		}
		const offset = index.readBigInt64LE(recordOffset + OFFSET_OFFSET);
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`SLG SZS entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name.replaceAll(";", "/")),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const szsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: szsDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSzs,
	openEntry: szsEntryOpener,
});
