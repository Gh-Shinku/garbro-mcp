// Format reference: GARbro Legacy/Witch/ArcDAT.cs
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

const SIGNATURE = 0x00144b4d;
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_LENGTH_SIZE = 4;
/** Image metadata that follows the name: width, height, size, and offset. */
const RECORD_TAIL_SIZE = 16;
const SIZE_OFFSET = 8;
const OFFSET_OFFSET = 12;

export const witchDatDescriptor: FormatDescriptor = {
	id: "witch-dat",
	name: "Witch resource archive",
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
			source: "Legacy/Witch/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DatOpener.TryOpen`. Records start at 8 with a 32-bit name length, the name, and a 16-byte
 * tail that holds the image dimensions, the stored size, and the data offset. A zero name length is
 * rejected.
 */
async function readWitchIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(NAME_LENGTH_SIZE) > source.size) return undefined;
		const nameLength = (
			await source.readAt(position, NAME_LENGTH_SIZE)
		).readUInt32LE(0);
		if (nameLength === 0) return undefined;
		position += BigInt(NAME_LENGTH_SIZE);
		const recordSize = BigInt(nameLength) + BigInt(RECORD_TAIL_SIZE);
		if (position + recordSize > source.size) return undefined;
		const record = await source.readAt(position, Number(recordSize));
		const name = decodeCStringField(record, 0, nameLength);
		const offset = BigInt(record.readUInt32LE(nameLength + OFFSET_OFFSET));
		const size = BigInt(record.readUInt32LE(nameLength + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: {
					width: record.readUInt32LE(nameLength),
					height: record.readUInt32LE(nameLength + 4),
					bpp: 8,
				},
			}),
		);
		position += recordSize;
	}
	return entries;
}

export const witchDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: witchDatDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("MK\x14\0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWitchIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWitchIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Witch DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
