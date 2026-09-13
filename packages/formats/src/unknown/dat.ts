// Format reference: GARbro Legacy/Unknown/ArcDAT.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 12;
/** A record needs all three words and GARbro caps the stride at 0x10. */
const MIN_RECORD_SIZE = 12;
const MAX_RECORD_SIZE = 0x10;
const ID_FIELD = 0;
const SIZE_FIELD = 4;
const OFFSET_FIELD = 8;

export const unknownDatDescriptor: FormatDescriptor = {
	id: "unknown-dat",
	name: "'Unknown' resource archive",
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
			source: "Legacy/Unknown/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `Binary.RotByteR (data[i], 4)`: the two nibbles swap, which is its own inverse. */
export function rotateNibbles(data: Buffer): Buffer {
	const output = Buffer.alloc(data.length);
	for (let index = 0; index < data.length; index += 1) {
		const value = data[index] ?? 0;
		output[index] = ((value >> 4) | (value << 4)) & 0xff;
	}
	return output;
}

/**
 * GARbro `DatOpener.TryOpen`. The header holds a signed entry count, a record stride and the payload
 * offset; the stride must be at most 0x10 and the index must end exactly where the payload starts.
 * The index bytes are nibble-swapped before use, and every payload offset must sit at or behind the
 * payload start. Entries are named `<archive>#<id padded to 4>`. GARbro's catalog type detection is
 * not reproduced.
 */
async function readUnknownDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readInt32LE(0);
	const recordSize = header.readInt32LE(4);
	const dataOffset = header.readInt32LE(8);
	if (!isSaneCount(count)) return undefined;
	if (recordSize < MIN_RECORD_SIZE || recordSize > MAX_RECORD_SIZE)
		return undefined;
	const indexSize = count * recordSize;
	if (indexSize + HEADER_SIZE !== dataOffset) return undefined;
	if (BigInt(dataOffset) > source.size) return undefined;
	const index = rotateNibbles(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);

	const name = basename(sourcePath);
	const extension = extname(name);
	const baseName =
		extension.length > 0 ? name.slice(0, -extension.length) : name;
	const entries: FixedEntry[] = [];
	for (let position = 0; position < count; position += 1) {
		const record = position * recordSize;
		const id = index.readInt32LE(record + ID_FIELD);
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (offset < BigInt(dataOffset)) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: position,
				path: `${baseName}#${String(id).padStart(4, "0")}`,
				offset,
				size,
			}),
		);
	}
	return entries;
}

/** GARbro `DatOpener.OpenEntry`: payloads are nibble-swapped as well. */
const unknownDatEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Unknown DAT entry"),
	);
	return Readable.from([rotateNibbles(stored)]);
};

export const unknownDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unknownDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readUnknownDatIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readUnknownDatIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Unknown DAT layout");
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				encryption: "nibble-rotation",
			},
		};
	},
	openEntry: unknownDatEntryOpener,
});
