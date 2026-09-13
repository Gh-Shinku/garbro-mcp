// Format reference: GARbro ArcFormats/Mixwill/ArcARC0.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ARC0", "ascii");
const COUNT_OFFSET = 0x10004;
const INDEX_OFFSET = 0x10008;
const NAME_SIZE = 0x100;
const RECORD_SIZE = NAME_SIZE + 8;

export const arc0Descriptor: FormatDescriptor = {
	id: "mixwill-arc0",
	name: "Mixwill soft resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Mixwill/ArcARC0.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `Arc0Opener.TryOpen`: every name byte is XORed with its position in the 0x100 field. */
function decodeName(field: Buffer): string | undefined {
	for (let position = 0; position < field.length; position += 1) {
		const value = (field[position] ?? 0) ^ (position & 0xff);
		field[position] = value;
		if (value !== 0) continue;
		if (position === 0) return undefined;
		return decodeCp932(field.subarray(0, position));
	}
	return decodeCp932(field);
}

async function readArc0Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeName(index.subarray(record, record + NAME_SIZE));
		if (name === undefined) return undefined;
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	return entries;
}

export const arc0Format: ArchiveFormat = defineFixedArchive({
	descriptor: arc0Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArc0Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readArc0Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mixwill ARC0 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
