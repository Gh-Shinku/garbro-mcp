// Format reference: GARBro Legacy/Electriciteit/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x2c;
const NAME_SIZE = 0x10;
const OFFSET_OFFSET = 0x24;
const SIZE_OFFSET = 0x28;
/** Archive names starting with `b` hold bitmaps. */
const BITMAP_PREFIX = "b";

export const electriciteitDatDescriptor: FormatDescriptor = {
	id: "electriciteit-dat",
	name: "Electriciteit resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Electriciteit/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `DatOpener.TryOpen`. The record count sits at 0 and records start at 4 with a 0x2c-byte
 * stride: a 0x10-byte CP932 name, the data offset at +0x24, and the stored size at +0x28. GARbro
 * rejects blank or rooted names and requires every payload to start behind the index.
 *
 * Archives whose name starts with `b` are flagged as image containers; the port records that flag in
 * the entry metadata.
 */
async function readElectriciteitIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const firstOffset = BigInt(INDEX_OFFSET + indexSize);
	if (firstOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const isBitmap = basename(sourcePath).toLowerCase().startsWith(BITMAP_PREFIX);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (
			name.trim().length === 0 ||
			/^[\\/]/.test(name) ||
			/^[A-Za-z]:/.test(name)
		)
			return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (offset < firstOffset) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
		});
		if (isBitmap) entry.metadata = { image: true };
		entries.push(entry);
	}
	return entries;
}

export const electriciteitDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: electriciteitDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readElectriciteitIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readElectriciteitIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Electriciteit DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
