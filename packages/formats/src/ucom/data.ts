// Format reference: GARBro ArcFormats/Ucom/ArcDATA.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
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

const DATA_SIGNATURE = Buffer.from("PF", "ascii");
const DATA_NAME = "data02";
const INDEX_NAME = "data01";
const INDEX_SIGNATURE = Buffer.from("IF", "ascii");
const COUNT_OFFSET = 2;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const OFFSET_OFFSET = 0x10;
const SIZE_OFFSET = 0x14;
/** Every fifth payload byte is stored in the clear; the rest are XORed with this key. */
const XOR_KEY = 0x45;
const XOR_STRIDE = 5;

export const ucomDataDescriptor: FormatDescriptor = {
	id: "ucom-data",
	name: "For/Ucom scripts archive",
	extensions: [""],
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
			source: "ArcFormats/Ucom/ArcDATA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DataOpener.TryOpen`. The payload file must be named `data02` and start with `PF`; the
 * companion file `data01` holds the index: an `IF` signature, a 16-bit record count, and 0x18-byte
 * records with a 0x10-byte name, the data offset at +0x10, and the size at +0x14.
 */
async function readUcomIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() !== DATA_NAME) return undefined;
	if (source.size < BigInt(DATA_SIGNATURE.length)) return undefined;
	const signature = await source.readAt(0n, DATA_SIGNATURE.length);
	if (!signature.equals(DATA_SIGNATURE)) return undefined;
	const companion = await readCompanionFile(sourcePath, INDEX_NAME);
	if (!companion) return undefined;
	if (companion.length < 4) return undefined;
	if (!companion.subarray(0, INDEX_SIGNATURE.length).equals(INDEX_SIGNATURE))
		return undefined;
	const count = companion.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (4 + indexSize > companion.length) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = 4 + id * RECORD_SIZE;
		const name = decodeCStringField(companion, record, NAME_SIZE);
		const offset = BigInt(companion.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(companion.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
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
	return entries;
}

/** GARbro `DataOpener.OpenEntry`: four of every five bytes are XORed with 0x45. */
const ucomEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1) {
		if (position % XOR_STRIDE === 0) continue;
		payload[position] = (payload[position] ?? 0) ^ XOR_KEY;
	}
	return Readable.from([payload]);
};

export const ucomDataFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ucomDataDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readUcomIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readUcomIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Ucom data layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ucomEntryOpener,
});
