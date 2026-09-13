// Format reference: GARbro ArcFormats/Leaf/ArcAM.cs, class `AmOpener`.
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'am00' */
const SIGNATURE = Buffer.from("am00", "latin1");
const INDEX_SIZE_FIELD = 4;
const KEY_FIELD = 8;
const INDEX_START = 9;
/** A record's offset and stored size follow its name. */
const RECORD_TAIL_SIZE = 8;

/**
 * GARbro `AmOpener.TryOpen`. The index size is a 32-bit word at 0x04 and a key byte at 0x08 masks the
 * whole index. Records are NUL-terminated CP932 names followed by an offset relative to the end of the
 * index and a stored size; the walk runs to the end of the index, so a trailing partial record rejects
 * the archive.
 */
async function readLeafAmIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const indexSize = header.readUInt32LE(INDEX_SIZE_FIELD);
	const key = header[KEY_FIELD] ?? 0;
	if (BigInt(INDEX_START + indexSize) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_START), indexSize),
	);
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ key;

	const baseOffset = BigInt(INDEX_START + indexSize);
	const entries: FixedEntry[] = [];
	let indexOffset = 0;
	while (indexOffset < index.length) {
		const nameEnd = index.indexOf(0, indexOffset);
		// A missing terminator or an empty name rejects the archive.
		if (nameEnd === -1 || nameEnd === indexOffset) return undefined;
		const name = decodeCStringField(index, indexOffset, nameEnd - indexOffset);
		indexOffset = nameEnd + 1;
		if (indexOffset + RECORD_TAIL_SIZE > index.length) return undefined;
		const offset = baseOffset + BigInt(index.readUInt32LE(indexOffset));
		const storedSize = BigInt(index.readUInt32LE(indexOffset + 4));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
		indexOffset += RECORD_TAIL_SIZE;
	}
	return entries;
}

export const leafAmDescriptor: FormatDescriptor = {
	id: "leaf-am",
	name: "Leaf video resources archive",
	extensions: ["am"],
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
			source: "ArcFormats/Leaf/ArcAM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafAmFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafAmDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLeafAmIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLeafAmIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf AM layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
